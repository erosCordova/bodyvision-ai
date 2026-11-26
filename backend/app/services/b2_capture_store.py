"""Private Backblaze B2 object storage. Only opaque UUID names and encrypted bytes."""
import base64
import hashlib
import json
import os
import re
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

class B2Error(RuntimeError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def object_name(identifier):
    return "captures/"+str(identifier)+".fernet"

class B2Store:
    def __init__(self):
        self.bucket=os.environ.get("B2_BUCKET_ID","")
        access=os.environ.get("B2_KEY_ID","")
        secret=os.environ.get("B2_APPLICATION_KEY","")
        if not self.bucket or not access or not secret:
            raise B2Error("B2 configuration incomplete")
        self.opener=build_opener(NoRedirect())
        basic=base64.b64encode((access+":"+secret).encode()).decode("ascii")
        result=self._json("https://api.backblazeb2.com/b2api/v4/b2_authorize_account","Basic "+basic)
        info=result["apiInfo"]["storageApi"]
        allowed=info["allowed"]
        buckets=allowed.get("buckets") or []
        if len(buckets)!=1 or buckets[0]["id"]!=self.bucket or not {"readFiles","writeFiles","deleteFiles"}.issubset(allowed["capabilities"]):
            raise B2Error("B2 key must be limited to configured bucket with file access")
        self.api=info["apiUrl"]
        self.download=info["downloadUrl"]
        self.token=result["authorizationToken"]

    def _request(self,url,headers,data=None,limit=350000,allow_missing=False):
        parsed=urlsplit(url)
        if parsed.scheme!="https" or not parsed.hostname or not parsed.hostname.endswith(".backblazeb2.com") or parsed.username or parsed.password:
            raise B2Error("Unexpected B2 host")
        try:
            with self.opener.open(Request(url,data=data,headers=headers),timeout=15) as response:
                body=response.read(limit+1)
                if len(body)>limit:
                    raise B2Error("B2 response exceeds size limit")
                return body
        except HTTPError as exc:
            code="unknown"
            try:
                candidate=json.loads(exc.read(8192)).get("code","unknown")
                if isinstance(candidate,str) and re.fullmatch(r"[a-zA-Z0-9_]{1,64}",candidate):
                    code=candidate
            except (ValueError, OSError):
                pass
            if allow_missing and exc.code in (400,404) and code in ("file_not_present","not_found","no_such_file"):
                return b"{}"
            # Log only allowlisted operation names and provider error code, never URL or tokens.
            operation=next((op for op in ("b2_authorize_account","b2_get_upload_url","b2_upload_file","b2_download_file_by_id","b2_delete_file_version") if op in parsed.path),"request")
            raise B2Error(operation+" HTTP "+str(exc.code)+" "+code) from None
        except (URLError,TimeoutError,OSError):
            raise B2Error("B2 unavailable") from None

    def _json(self,url,token,payload=None,allow_missing=False):
        data=json.dumps(payload).encode() if payload is not None else None
        try:
            return json.loads(self._request(url,{"Authorization":token,"Content-Type":"application/json"},data,65536,allow_missing))
        except ValueError:
            raise B2Error("Invalid B2 response") from None

    def put(self,name,data):
        upload=self._json(self.api+"/b2api/v4/b2_get_upload_url",self.token,{"bucketId":self.bucket})
        sha=hashlib.sha1(data).hexdigest()
        result=json.loads(self._request(upload["uploadUrl"],{"Authorization":upload["authorizationToken"],"X-Bz-File-Name":quote(name,safe="/"),"Content-Type":"application/octet-stream","X-Bz-Content-Sha1":sha},data,65536))
        file_id=result.get("fileId")
        if not file_id:
            raise B2Error("B2 upload did not return file ID")
        if result.get("fileName")!=name or result.get("contentSha1")!=sha:
            self.delete(name,file_id)
            raise B2Error("B2 upload integrity mismatch")
        return file_id

    def get(self,file_id):
        return self._request(self.download+"/b2api/v4/b2_download_file_by_id?"+urlencode({"fileId":file_id}),{"Authorization":self.token})

    def delete(self,name,file_id):
        self._json(self.api+"/b2api/v4/b2_delete_file_version",self.token,{"fileName":name,"fileId":file_id},allow_missing=True)

    def verified_put(self,name,data):
        file_id=self.put(name,data)
        try:
            if self.get(file_id)!=data:
                raise B2Error("B2 readback verification failed")
        except Exception:
            try:
                self.delete(name,file_id)
            except B2Error:
                pass
            raise
        return file_id
