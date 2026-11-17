"""Build a demo GLB from pinned CC0 MPFB mesh/targets and a CC0 skin.

Usage: python scripts/build_body_asset.py INPUT_DIRECTORY
Inputs and exact upstream references are recorded in docs/3d/ASSET.md.
Only data is imported; no MPFB application code is copied.
"""
import array
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / "frontend/public/models/bodyvision"
out.mkdir(parents=True, exist_ok=True)
positions, uvs, faces, eye_vertices = [], [], [], {}
group = ""
for line in (source / "base.obj").read_text().splitlines():
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "v":
        positions.append(list(map(float, parts[1:4])))
    elif parts[0] == "vt":
        uvs.append(list(map(float, parts[1:3])))
    elif parts[0] == "g":
        group = parts[1]
    elif parts[0] == "f":
        corners = [(int(v.split('/')[0])-1, int(v.split('/')[1])-1) for v in parts[1:]]
        if group == "body":
            faces.append(corners)
        elif group in {"joint-l-eye", "joint-r-eye"}:
            eye_vertices.setdefault(group, set()).update(v[0] for v in corners)

def target(name):
    result = [[0.0]*3 for _ in positions]
    for line in gzip.decompress((source / (name+".target.gz")).read_bytes()).decode().splitlines():
        fields = line.split()
        if fields and not fields[0].startswith('#'):
            result[int(fields[0])] = list(map(float, fields[1:4]))
    return result

adult = target("caucasian-male-young")
base = [[v[i]+adult[n][i] for i in range(3)] for n,v in enumerate(positions)]
used = sorted({v for face in faces for v,_ in face})
bottom = min(base[i][1] for i in used)
scale = 1.75/(max(base[i][1] for i in used)-bottom)
base = [[v[0]*scale,(v[1]-bottom)*scale,v[2]*scale] for v in base]
targets = [target("universal-male-young-"+n) for n in [
    "averagemuscle-maxweight", "averagemuscle-minweight", "maxmuscle-averageweight"]]
deltas = [[[v*scale for v in row] for row in t] for t in targets]
triangles=[]
for face in faces:
    for k in range(1,len(face)-1):
        triangles.append([face[0],face[k],face[k+1]])

def normals(vertices):
    values = [[0.0]*3 for _ in vertices]
    for tri in triangles:
        a,b,c=[vertices[x[0]] for x in tri]
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        for idx,_ in tri:
            for i in range(3):values[idx][i]+=n[i]
    return [[x/(math.sqrt(sum(v*v for v in row)) or 1) for x in row] for row in values]

base_normals=normals(base)
morph_normals=[normals([[v[i]+d[n][i] for i in range(3)] for n,v in enumerate(base)]) for d in deltas]
lookup={}; mapping=[];skin=[];clothes=[]
for tri in triangles:
    center=[sum(base[v][i] for v,_ in tri)/3 for i in range(3)]
    # Fitted athletic shorts cover the pelvis and upper thighs; no anatomical claim.
    clothing=0.54<center[1]<0.97
    dest=clothes if clothing else skin
    for corner in tri:
        if corner not in lookup:
            lookup[corner]=len(mapping);mapping.append(corner)
        dest.append(lookup[corner])

binary=bytearray();views=[];accessors=[]
def data(values,component,kind,bounds=False):
    flat=[x for row in values for x in row] if kind!='SCALAR' else values
    buf=array.array('f' if component==5126 else 'H',flat)
    if sys.byteorder!='little':buf.byteswap()
    while len(binary)%4:binary.append(0)
    offset=len(binary);binary.extend(buf.tobytes());views.append({'buffer':0,'byteOffset':offset,'byteLength':len(buf)*buf.itemsize})
    a={'bufferView':len(views)-1,'componentType':component,'count':len(values),'type':kind}
    if bounds:a.update(min=[min(row[i] for row in values) for i in range(3)],max=[max(row[i] for row in values) for i in range(3)])
    accessors.append(a);return len(accessors)-1

attrs={'POSITION':data([base[v] for v,_ in mapping],5126,'VEC3',True),
       'NORMAL':data([base_normals[v] for v,_ in mapping],5126,'VEC3'),
       'TEXCOORD_0':data([[uvs[t][0],1-uvs[t][1]] for _,t in mapping],5126,'VEC2')}
morphs=[{'POSITION':data([d[v] for v,_ in mapping],5126,'VEC3',True),
         'NORMAL':data([[mn[v][i]-base_normals[v][i] for i in range(3)] for v,_ in mapping],5126,'VEC3')} for d,mn in zip(deltas,morph_normals)]
primitives=[{'attributes':attrs,'indices':data(idx,5123,'SCALAR'),'material':mat,'targets':morphs} for mat,idx in enumerate([skin,clothes])]
eyes={name:[sum(base[i][axis] for i in ids)/len(ids) for axis in range(3)] for name,ids in eye_vertices.items()}
gltf={'asset':{'version':'2.0','generator':'BODYVISION CC0 asset builder 1.0','copyright':'CC0 MakeHuman Community; skin Mindfront'},
 'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':'Adult demonstration body'}],
 'meshes':[{'primitives':primitives,'weights':[0,0,0],'extras':{'targetNames':['VolumePlus','VolumeMinus','Definition']}}],
 'materials':[{'name':'Skin','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':0.65}},
              {'name':'Athletic shorts','pbrMetallicRoughness':{'baseColorFactor':[0.025,0.048,0.082,1],'metallicFactor':0,'roughnessFactor':0.92}}],
 'extensionsUsed':['EXT_texture_webp'],'extensionsRequired':['EXT_texture_webp'],
 'textures':[{'extensions':{'EXT_texture_webp':{'source':0}}}],'images':[{'uri':'skin.webp','mimeType':'image/webp'}],
 'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors,
 'extras':{'heightMeters':1.75,'eyes':eyes,'source_type':'DEMO','license':'CC0-1.0','rig_id':None}}
j=json.dumps(gltf,separators=(',',':')).encode()
j+=b' '*((-len(j))%4);binary+=b'\0'*((-len(binary))%4)
glb=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
# gzip is a delivery envelope; decoded bytes are an ordinary glTF 2.0 GLB.
compressed=gzip.compress(glb,compresslevel=9,mtime=0)
(out/'adult-demo.glb.gz').write_bytes(compressed)
manifest={'id':'bodyvision-mpfb-adult-1','version':'1.0.0','source_type':'DEMO','license':'CC0-1.0',
 'license_ref':'MakeHuman/MPFB CC0-1.0','license_evidence_key':'/models/bodyvision/LICENSE.ASSETS.md',
 'url':'/models/bodyvision/adult-demo.glb.gz','sha256':hashlib.sha256(compressed).hexdigest(),
 'decoded_sha256':hashlib.sha256(glb).hexdigest(),'triangles':len(triangles),'vertices':len(mapping),
 'height_meters':1.75,'rig_id':None,'layers':['surface','wireframe'],'created_at':'2026-11-17',
 'upstream_commit':'9de0707fdc88438d7c53a1a2ac7937d9221e2431','eyes':eyes}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'glb_bytes':len(glb),'gzip_bytes':len(compressed),'triangles':len(triangles),'vertices':len(mapping),'sha256':manifest['sha256']}))
