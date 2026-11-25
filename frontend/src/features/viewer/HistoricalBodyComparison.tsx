import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useWorkspace} from "../../app/providers/WorkspaceProvider";
import {dateTime,ErrorState,LoadingState} from "../../components/ui/States";
import type {Measurement} from "../../services/api/records";
import type {createAnatomyScene,LayerOpacity} from "./AnatomyScene";
import {MIN_REFERENCE_KG,MAX_REFERENCE_KG} from "./bodyVolume";
import {MIN_HEIGHT_CM,MAX_HEIGHT_CM} from "./bodyStature";

const opacity:LayerOpacity={skin:1,muscles:1,skeleton:1,arteries:1,veins:1,nerves:1};
const day=(date:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(date));
const usable=(rows:Measurement[]|undefined,id:string,code:string,unit:string)=> (rows??[]).filter(r=>r.profile_id===id&&r.metric_code===code&&r.unit===unit&&r.is_current&&Number.isFinite(r.value)&&r.value>0).sort((a,b)=>Date.parse(a.measured_at)-Date.parse(b.measured_at));
const fmt=(v:number)=>v.toLocaleString("es-PE",{maximumFractionDigits:2});
const signed=(v:number)=>new Intl.NumberFormat("es-PE",{maximumFractionDigits:2,signDisplay:"exceptZero"}).format(v);
type View="front"|"back"|"left"|"right";
function Model({weight,height,view,mesh}:{weight:number;height:number;view:View;mesh:boolean}){
 const host=useRef<HTMLDivElement>(null),controller=useRef<ReturnType<typeof createAnatomyScene>|null>(null);
 const [status,setStatus]=useState<"loading"|"ready"|"error">("loading");
 const [attempt,setAttempt]=useState(0);
 const values=useRef({weight,height,view,mesh});values.current={weight,height,view,mesh};
 useEffect(()=>{let live=true;setStatus("loading");void import("./AnatomyScene").then(({createAnatomyScene})=>{
   if(!live||!host.current)return;
   const c=createAnatomyScene(host.current,()=>{},()=>{},(layer,state)=>{if(live&&layer==="skin")setStatus(state);},()=>{if(live)setStatus("error");});
   controller.current=c;c.setQuality("fluida");c.setAutoRotate(false);c.setRenderMode(values.current.mesh?"holograma":"realista");c.setWeightVariation(0,values.current.weight);c.setStature(values.current.height);c.update(new Set(["skin"]),opacity);c.view(values.current.view);
 }).catch(()=>{if(live)setStatus("error");});return()=>{live=false;controller.current?.dispose();controller.current=null;};},[attempt]);
 useEffect(()=>{const c=controller.current;if(c){c.setWeightVariation(0,weight);c.setStature(height);c.setRenderMode(mesh?"holograma":"realista");c.view(view);}},[weight,height,view,mesh,status]);
 return <div className="bv-history-canvas"><div ref={host} style={{position:"absolute",inset:0}}/>{status!=="ready"&&<div className="bv-history-canvas-status" role={status==="error"?"alert":"status"}>{status==="loading"?"Cargando atlas…":<><span>Modelo no disponible</span><button type="button" onClick={()=>setAttempt(n=>n+1)}>Reintentar</button></>}</div>}</div>;
}
export function HistoricalBodyComparison({profileId}:{profileId:string}){
 const {id,api}=useWorkspace();
 const [open,setOpen]=useState(false),[from,setFrom]=useState(""),[to,setTo]=useState(""),[view,setView]=useState<View>("front"),[mesh,setMesh]=useState(false);
 const weights=useQuery({queryKey:["series",id,profileId,"weight","1a"],queryFn:()=>api.series(profileId,"weight","1a"),enabled:open});
 const heights=useQuery({queryKey:["series",id,profileId,"height","1a"],queryFn:()=>api.series(profileId,"height","1a"),enabled:open});
 const fats=useQuery({queryKey:["series",id,profileId,"body_fat_pct","1a"],queryFn:()=>api.series(profileId,"body_fat_pct","1a"),enabled:open});
 const ws=usable(weights.data,profileId,"weight","kg"),hs=usable(heights.data,profileId,"height","cm"),fs=usable(fats.data,profileId,"body_fat_pct","%").filter(r=>r.method==="device"&&!!r.instrument?.trim()&&r.value>=2&&r.value<=70);
 const first=ws.find(r=>r.id===from)??ws[0],last=ws.find(r=>r.id===to)??ws[ws.length-1];
 const heightFor=(r:Measurement)=>hs.filter(h=>Date.parse(h.measured_at)<=Date.parse(r.measured_at)).at(-1);
 const fatFor=(r:Measurement)=>fs.filter(f=>day(f.measured_at)===day(r.measured_at)).at(-1);
 const ha=first&&heightFor(first),hb=last&&heightFor(last),fa=first&&fatFor(first),fb=last&&fatFor(last);
 const comparable=!!first&&!!last&&first.id!==last.id&&Date.parse(first.measured_at)<Date.parse(last.measured_at)&&first.method===last.method&&(first.method!=="device"||first.instrument===last.instrument);
 const rangeOk=(w:Measurement,h:Measurement|undefined)=>!!h&&w.value>=MIN_REFERENCE_KG&&w.value<=MAX_REFERENCE_KG&&h.value>=MIN_HEIGHT_CM&&h.value<=MAX_HEIGHT_CM;
 const fatComparable=fa&&fb&&fa.instrument===fb.instrument;
 const failed=[weights,heights,fats].find(q=>q.isError);
 return <section className="panel bv-history-section"><h2>Comparación corporal 3D</h2>
 {!open?<button type="button" className="primary-button" onClick={()=>setOpen(true)}>Comparar evaluaciones</button>:<><button type="button" onClick={()=>setOpen(false)}>Cerrar comparación</button>
 {failed?<ErrorState error={failed.error} retry={()=>{void weights.refetch();void heights.refetch();void fats.refetch();}}/>:weights.isPending||heights.isPending||fats.isPending?<LoadingState/>:ws.length<2?<p>Registra al menos dos pesos en el último año para comparar.</p>:<>
 <div className="bv-history-controls"><label>Evaluación inicial<select value={first?.id??""} onChange={e=>setFrom(e.target.value)}>{ws.map(r=><option key={r.id} value={r.id}>{dateTime(r.measured_at)} · {fmt(r.value)} kg</option>)}</select></label><label>Evaluación reciente<select value={last?.id??""} onChange={e=>setTo(e.target.value)}>{ws.map(r=><option key={r.id} value={r.id}>{dateTime(r.measured_at)} · {fmt(r.value)} kg</option>)}</select></label></div>
 {!comparable?<p role="status">Selecciona fechas distintas en orden cronológico y pesos del mismo método e instrumento.</p>:<>
 <div className="bv-history-diff"><div><small>Cambio de peso</small><strong>{signed(last.value-first.value)} kg</strong></div><div><small>Cambio de grasa corporal</small><strong>{fatComparable?signed(fb.value-fa.value)+" pp":"—"}</strong></div></div>
 <div className="bv-history-actions">{(["front","back","left","right"] as View[]).map((v,i)=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)}>{["Frontal","Posterior","Izquierda","Derecha"][i]}</button>)}<button type="button" aria-pressed={mesh} onClick={()=>setMesh(v=>!v)}>Malla</button></div>
 <div className="bv-history-models">{[{row:first,height:ha,fat:fa,label:"Evaluación inicial"},{row:last,height:hb,fat:fb,label:"Evaluación reciente"}].map(({row,height,fat,label})=><article key={label} className="bv-history-model"><h3>{label}</h3>{rangeOk(row,height)?<Model weight={row.value} height={height!.value} view={view} mesh={mesh}/>:<p>Falta estatura registrada previa o las medidas están fuera del rango del atlas.</p>}<p><strong>{fmt(row.value)} kg</strong> · {fat?fmt(fat.value)+" % grasa":"Sin grasa del mismo día"}</p><p>{height?fmt(height.value)+" cm · "+dateTime(height.measured_at):"Sin estatura"}</p></article>)}</div>
 <small>Mismo atlas, formas ilustrativas según peso y estatura. La grasa es una medición total, no una distribución reconstruida. Vistas predefinidas sincronizadas. Registros disponibles del último año.</small>
 </>}</>}</>}
 </section>;
}
