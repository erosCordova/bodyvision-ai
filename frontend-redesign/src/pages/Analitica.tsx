import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PageHead, Panel, Segmented, chartTip } from "../ui";
import { imcOf, useStore } from "../store";
import {useConnection} from "../ConnectedProvider";



export default function Analitica() {
  const { patients } = useStore();
  const {records,busy,error}=useConnection();
  const [rango, setRango] = useState<"6m" | "3m" | "1m">("6m");
  const n = rango === "6m" ? 6 : rango === "3m" ? 3 : 1;
  const months=Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-(n-1-i));return {key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),mes:d.toLocaleDateString("es-PE",{month:"short"})};});
  const monthKey=(v:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Lima",year:"numeric",month:"2-digit"}).formatToParts(new Date(v)).filter(p=>p.type==="year"||p.type==="month").map(p=>p.value).join("-");
  const observations=records.flatMap(r=>r.observations).filter(o=>Number.isFinite(o.value));
  const act=months.map(m=>({mes:m.mes,mediciones:observations.filter(o=>monthKey(o.measured_at)===m.key).length,analisis:records.flatMap(r=>r.captures).filter(c=>monthKey(c.created_at)===m.key).length}));
  const avg=(values:number[])=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10:null;
  const monthly=(code:string,key:string)=>records.flatMap(r=>{const found=r.observations.find(o=>o.metric_code===code&&monthKey(o.measured_at)===key&&Number.isFinite(o.value));return found?[found.value]:[];});
  const evo=months.map(m=>({mes:m.mes,grasa:avg(monthly("body_fat_pct",m.key)),musculo:avg(monthly("muscle_mass_kg",m.key))}));
  const cats=["Bajo peso","Normal","Sobrepeso","Obesidad"];
  const dist=cats.map((c,i)=>({c,v:patients.filter(p=>{const x=imcOf(p.peso,p.altura);return p.edad>=18&&p.peso>0&&p.altura>0&&Number.isFinite(x)&&(i===0?x<18.5:i===1?x>=18.5&&x<25:i===2?x>=25&&x<30:x>=30);}).length}));
  const obj=[["active","Activo"],["restricted","Restringido"],["archived","Archivado"]].map(([id,name])=>({name,value:records.filter(r=>r.profile.status===id).length}));
  const col=["#22d3ee","#a78bfa","#f59e0b","#34d399"];
  const kpis=[["Expedientes",String(patients.length)],["Activos",String(patients.filter(p=>p.estado==="Activo").length)],["Mediciones",String(observations.length)],["Fotografías",String(records.reduce((a,r)=>a+r.captures.length,0))]];

  return (
    <div>
      <PageHead title="Analítica" sub="Indicadores calculados a partir de los expedientes registrados" actions={<Segmented value={rango} onChange={setRango} options={[{ id: "1m", label: "1 mes" }, { id: "3m", label: "3 meses" }, { id: "6m", label: "6 meses" }]} />} />
      {error&&<p className="mb-4 text-sm text-rose-300">{error}</p>}
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map(([l, v]) => (
          <div key={String(l)} className="panel p-4">
            <div className="text-xs text-slate-400">{l}</div>
            <div className="mt-1 font-display text-2xl font-bold text-white">{busy?"…":v}</div>

          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Actividad de la plataforma">
          {!act.some(m=>m.mediciones||m.analisis)?<div className="grid h-[260px] place-items-center text-sm text-slate-400">Sin actividad registrada en este período</div>:<div className="h-[260px]"><ResponsiveContainer><AreaChart data={act} margin={{ left: -18 }}>
            <defs><linearGradient id="a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity={0.5} /><stop offset="1" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#16314d" strokeDasharray="3 4" /><XAxis dataKey="mes" stroke="#5f7a99" fontSize={12} /><YAxis stroke="#5f7a99" fontSize={12} /><Tooltip {...chartTip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="mediciones" name="Mediciones" stroke="#22d3ee" fill="url(#a1)" strokeWidth={2.5} /><Area dataKey="analisis" name="Fotografías" stroke="#a78bfa" fill="#a78bfa22" strokeWidth={2.5} />
          </AreaChart></ResponsiveContainer></div>}
        </Panel>
        <Panel title="Composición corporal media mensual">
          {!evo.some(m=>m.grasa!==null||m.musculo!==null)?<div className="grid h-[260px] place-items-center text-sm text-slate-400">Sin mediciones de composición en este período</div>:<div className="h-[260px]"><ResponsiveContainer><LineChart data={evo} margin={{ left: -18 }}>
            <CartesianGrid stroke="#16314d" strokeDasharray="3 4" /><XAxis dataKey="mes" stroke="#5f7a99" fontSize={12} /><YAxis stroke="#5f7a99" fontSize={12} domain={["auto", "auto"]} /><Tooltip {...chartTip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="grasa" name="% Grasa" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} /><Line dataKey="musculo" name="Masa muscular (kg)" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart></ResponsiveContainer></div>}
          <p className="text-xs text-slate-400">Último valor registrado por paciente y mes; sin interpolar datos ausentes.</p>
        </Panel>
        <Panel title="Distribución por IMC">
          {!dist.some(m=>m.v)?<div className="grid h-[260px] place-items-center text-sm text-slate-400">Sin peso y estatura válidos de adultos</div>:<div className="h-[260px]"><ResponsiveContainer><BarChart data={dist} margin={{ left: -18 }}>
            <CartesianGrid stroke="#16314d" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="c" stroke="#5f7a99" fontSize={12} /><YAxis stroke="#5f7a99" fontSize={12} allowDecimals={false} /><Tooltip {...chartTip} />
            <Bar dataKey="v" name="Pacientes" radius={[8, 8, 0, 0]}>{dist.map((_, i) => <Cell key={i} fill={col[i]} />)}</Bar>
          </BarChart></ResponsiveContainer></div>}
          <p className="text-xs text-slate-400">Solo adultos con peso y estatura registrados. No es un diagnóstico.</p>
        </Panel>
        <Panel title="Estado de los expedientes">
          {!obj.some(m=>m.value)?<div className="grid h-[260px] place-items-center text-sm text-slate-400">Sin expedientes registrados</div>:<div className="flex h-[260px] items-center"><ResponsiveContainer><PieChart><Pie data={obj} dataKey="value" innerRadius={55} outerRadius={90} paddingAngle={3} stroke="none">{obj.map((_, i) => <Cell key={i} fill={col[i]} />)}</Pie><Tooltip {...chartTip} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>}
        </Panel>
      </div>
    </div>
  );
}
