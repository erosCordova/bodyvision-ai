import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const models = join(base, "public", "models", "zanatomy");
const decoder = join(base, "public", "draco");
const source = "https://raw.githubusercontent.com/SeemaBansal1/3d-human-body-anatomy/28912432581accd7a1c62129d55f0e9758221d48/web/public/models/";
const assets = [
  ["skeleton",1195788,"89c8d305f3727f31688abcfda2860d2b6d628832"],
  ["muscles",1911456,"31f87dff1bde2d2cdd6328c99e2155154c738bd0"],
  ["organs",1416940,"a01fa5da10068bcc6f26feb63d582175ea89ca9e"],
  ["arteries",1580300,"f6c58d2ec31025d80fe55df1fe2b1f5e184d8627"],
  ["veins",1039368,"4579313f2659fa9e8864b4bbcc09329d6d1af42a"],
  ["nerves",1020216,"965ac854bd18d12f959f4e7bc34444a1a6032c03"],
  ["skin",770296,"1000d249050112ea014651647d3145e0bde127f8"],
];
function valid(bytes, size, sha) {
  return bytes.length === size && bytes.toString("ascii",0,4) === "glTF"
    && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === size
    && createHash("sha1").update("blob "+size+"\0").update(bytes).digest("hex") === sha;
}
await mkdir(models, {recursive:true});
await mkdir(decoder, {recursive:true});
await Promise.all(assets.map(async ([name,size,sha])=>{
  const file=join(models,name+".glb");
  try { if(valid(await readFile(file),size,sha)) return; } catch {}
  let error;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(source+name+".glb",{signal:AbortSignal.timeout(60000)});
      if(!response.ok) throw Error("HTTP "+response.status);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(!valid(bytes,size,sha)) throw Error("GLB integrity mismatch: "+name);
      await writeFile(file+".tmp",bytes); await rename(file+".tmp",file);
      console.log("Verified Z-Anatomy:",name,size);
      return;
    }catch(e){error=e;}
  }
  throw error;
}));
for(const file of ["draco_decoder.js","draco_wasm_wrapper.js","draco_decoder.wasm"]){
  await copyFile(join(base,"node_modules","three","examples","jsm","libs","draco","gltf",file),join(decoder,file));
}
await writeFile(join(models,"CREDITS.txt"),"Z-Anatomy, derived from BodyParts3D © DBCLS. Web export by SeemaBansal1/3d-human-body-anatomy. CC BY-SA 4.0; kidney by Lissie Cowley CC BY-NC 4.0 (noncommercial educational use only).\n"+source+"\nhttps://creativecommons.org/licenses/by-sa/4.0/\nhttps://creativecommons.org/licenses/by-nc/4.0/\n");
