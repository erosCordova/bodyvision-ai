"""Private Cloudflare R2 storage for encrypted sandbox captures (S3 Signature V4)."""
import hashlib
import hmac
import os
import re
from datetime import datetime, timezone
from urllib.parse import quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

class R2Error(RuntimeError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class R2Store:
    def __init__(self):
        account=os.environ.get("R2_ACCOUNT_ID","")
        self.bucket=os.environ.get("R2_BUCKET","")
        self.access=os.environ.get("R2_ACCESS_KEY_ID","")
        self.secret=os.environ.get("R2_SECRET_ACCESS_KEY","")
        if not re.fullmatch(r"[0-9a-f]{32}",account) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]",self.bucket) or not self.access or not self.secret:
            raise R2Error("Configuración de R2 incompleta.")
        self.host=account+".r2.cloudflarestorage.com"
        self.opener=build_opener(NoRedirect())

    def _request(self, method, key, data=b""):
        if not re.fullmatch(r"captures/[0-9a-f-]{36}\.fernet",key):
            raise R2Error("Identificador de objeto inválido.")
        now=datetime.now(timezone.utc)
        stamp=now.strftime("%Y%m%dT%H%M%SZ")
        day=stamp[:8]
        path="/"+quote(self.bucket,safe="")+"/"+quote(key,safe="/")
        digest=hashlib.sha256(data).hexdigest()
        headers={"host":self.host,"x-amz-content-sha256":digest,"x-amz-date":stamp}
        if method=="PUT":
            headers["content-type"]="application/octet-stream"
        signed=";".join(sorted(headers))
        canonical_headers="".join(k+":"+headers[k]+"\n" for k in sorted(headers))
        canonical="\n".join([method,path,"",canonical_headers,signed,digest])
        scope=day+"/auto/s3/aws4_request"
        string_to_sign="\n".join(["AWS4-HMAC-SHA256",stamp,scope,hashlib.sha256(canonical.encode()).hexdigest()])
        sign=lambda key,value:hmac.new(key,value.encode(),hashlib.sha256).digest()
        signing=sign(sign(sign(sign(("AWS4"+self.secret).encode(),day),"auto"),"s3"),"aws4_request")
        signature=hmac.new(signing,string_to_sign.encode(),hashlib.sha256).hexdigest()
        headers["Authorization"]="AWS4-HMAC-SHA256 Credential="+self.access+"/"+scope+", SignedHeaders="+signed+", Signature="+signature
        request=Request("https://"+self.host+path,data=data if method=="PUT" else None,headers=headers,method=method)
        try:
            with self.opener.open(request,timeout=15) as response:
                body=response.read(350001)
                if len(body)>350000:
                    raise R2Error("Objeto fuera del límite permitido.")
                return body
        except HTTPError as exc:
            if method=="DELETE" and exc.code==404:
                return b""
            raise R2Error("R2 respondió HTTP "+str(exc.code)) from None
        except (URLError,TimeoutError,OSError):
            raise R2Error("R2 no disponible.") from None

    def put(self,key,data):
        self._request("PUT",key,data)
    def get(self,key):
        return self._request("GET",key)
    def delete(self,key):
        self._request("DELETE",key)

def object_key(identifier):
    return "captures/"+str(identifier)+".fernet"
