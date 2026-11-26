import { useNavigate } from "react-router-dom";
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowRight, CheckCircle2, ClipboardList, FilePlus2, Ruler, Sparkles, Target } from "lucide-react";
import { Avatar, Badge, Btn, Panel, chartTip, estadoTone } from "../ui";
import { bodyParams, imcOf, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import {useConnection} from "../ConnectedProvider";

export default function Dashboard() {
  const nav = useNavigate();
  const { patient, patients, user, mediciones, reports, consents, select } = useStore();
  const {records}=useConnection();
  const validBody=!!patient&&patient.estado==="Activo"&&Number.isFinite(patient.peso)&&Number.isFinite(patient.altura);
  const composition=validBody&&Number.isFinite(patient.grasa);
  const data = patient?mediciones.filter(m=>m.patientId===patient.id&&(Number.isFinite(m.peso)||Number.isFinite(m.grasa))).slice().reverse().map((m,i)=>({mes:"M"+(i+1),peso:Number.isFinite(m.peso)?m.peso:null,imc:Number.isFinite(m.peso)&&Number.isFinite(patient.altura)?imcOf(m.peso,patient.altura):null,grasa:Number.isFinite(m.grasa)?m.grasa:null})):[];
  const STATS=[
    {icon:ClipboardList,value:String(patients.filter(p=>p.estado==="Activo").length),label:"Expedientes activos",c:"text-cyan-300 bg-cyan-400/10 border-cyan-400/30"},
    {icon:Ruler,value:String(records.reduce((n,r)=>n+r.observations.length,0)),label:"Mediciones",c:"text-emerald-300 bg-emerald-400/10 border-emerald-400/30"},
    {icon:Sparkles,value:String(records.reduce((n,r)=>n+r.captures.length,0)),label:"Fotografías registradas",c:"text-violet-300 bg-violet-400/10 border-violet-400/30"},
    {icon:Target,value:String(patients.length),label:"Expedientes totales",c:"text-amber-300 bg-amber-400/10 border-amber-400/30"},
  ];
  const ACT=[
    ...reports.slice(0,2).map(r=>({i:FilePlus2,t:r.title,s:r.date,c:"text-sky-300 bg-sky-400/15"})),
    ...mediciones.slice(0,2).map(m=>({i:Ruler,t:"Medición · "+m.paciente,s:m.fecha,c:"text-emerald-300 bg-emerald-400/15"})),
    ...patients.filter(p=>p.ultima==="Ahora").slice(0,2).map(p=>({i:CheckCircle2,t:"Expediente actualizado · "+p.nombre,s:p.ultima,c:"text-amber-300 bg-amber-400/15"})),
  ].slice(0,4);
  const { fat, mus } = patient?bodyParams(patient):{fat:0,mus:0};
  const magra = composition?+(100 - patient.grasa).toFixed(1):0;
  const pie = [
    { name: "Masa Magra", value: magra, c: "#22d3ee" },
    { name: "Grasa Corporal", value: composition?patient.grasa:0, c: "#f59e0b" },
  ];
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white md:text-3xl">Bienvenido, {user?.nombre || "Dr. Martínez"}</h1>
        <p className="mt-1 text-slate-400">Tu plataforma de análisis corporal inteligente</p>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="panel flex items-center gap-4 p-4">
            <div className={`grid h-12 w-12 place-items-center rounded-xl border ${s.c}`}>
              <s.icon size={22} />
            </div>
            <div>
              <div className="font-display text-2xl font-bold text-white md:text-[28px]">{s.value}</div>
              <div className="text-xs text-slate-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel title={patient?`Evolución Corporal · ${patient.nombre}`:"Evolución Corporal"} className="xl:col-span-5">
          <div className="h-[290px]">
            {data.length?<ResponsiveContainer>
              <LineChart data={data} margin={{ left: -14, right: -14, top: 10 }}>
                <CartesianGrid stroke="#16314d" strokeDasharray="3 4" />
                <XAxis dataKey="mes" stroke="#5f7a99" fontSize={12} />
                <YAxis yAxisId="l" stroke="#5f7a99" fontSize={12} domain={["auto", "auto"]} />
                <YAxis yAxisId="r" orientation="right" stroke="#5f7a99" fontSize={12} domain={["auto", "auto"]} />
                <Tooltip {...chartTip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="peso" name="Peso (kg)" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="imc" name="IMC" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="grasa" name="% Grasa" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>:<div className="grid h-full place-items-center text-sm text-slate-400">Sin mediciones registradas</div>}
          </div>
        </Panel>

        <Panel title="Gemelo digital" className="xl:col-span-3" pad={false}>
          <div className="p-3">
            <BodyScene className="h-[320px] rounded-xl" distance={5.2} sparkles={false} rotateSpeed={2}>
              <BodyModel sex={validBody?patient.sexo:"male"} heightCm={validBody?patient.altura:175} weightKg={validBody?patient.peso:undefined} ageYears={validBody?patient.edad:30} fat={validBody?fat:0} mus={validBody?mus:0} mode="holo" />
            </BodyScene>
            {!validBody&&<p className="mt-2 text-center text-xs text-slate-400">Atlas de referencia · sin datos corporales completos</p>}
            <Btn variant="outline" className="mt-3 w-full !py-2 text-xs" onClick={() => nav(validBody?"/app/vision-3d":"/app/expedientes")}>
              {validBody?"Abrir visor 3D":"Seleccionar expediente"} <ArrowRight size={14} />
            </Btn>
          </div>
        </Panel>

        <Panel title="Composición Corporal" className="xl:col-span-4">
          {composition?<><div className="relative h-[240px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={72} outerRadius={96} startAngle={90} endAngle={-270} stroke="none" paddingAngle={2}>
                  {pie.map((p) => (
                    <Cell key={p.name} fill={p.c} />
                  ))}
                </Pie>
                <Tooltip {...chartTip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="font-display text-3xl font-bold text-white">{magra}%</div>
                <div className="text-xs text-slate-400">Masa magra</div>
              </div>
            </div>
          </div>
          <div className="mt-2 space-y-2 text-sm">
            {pie.map((p) => (
              <div key={p.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.c }} />
                  {p.name}
                </span>
                <span className="font-semibold text-white">{p.value}%</span>
              </div>
            ))}
          </div>
        </>:<div className="grid h-[290px] place-items-center text-center text-sm text-slate-400">Sin composición corporal registrada</div>}
        </Panel>

        <Panel title="Actividad Reciente" className="xl:col-span-5" action={<button onClick={() => nav("/app/analitica")} className="text-xs text-cyan-300 hover:underline">Ver todas →</button>}>
          <ul className="space-y-3">
            {!ACT.length&&<li className="py-4 text-center text-sm text-slate-400">Sin registros recientes</li>}
            {ACT.map((a) => (
              <li key={a.t} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${a.c}`}>
                  <a.i size={17} />
                </span>
                <div className="flex-1 text-sm text-slate-200">{a.t}</div>
                <span className="text-xs text-slate-500">{a.s}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Expedientes recientes" className="xl:col-span-7" action={<button onClick={() => nav("/app/expedientes")} className="text-xs text-cyan-300 hover:underline">Ver todos →</button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Paciente</th>
                  <th className="pb-2 font-medium">IMC</th>
                  <th className="pb-2 font-medium">% Grasa</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {patients.slice(0, 5).map((p) => (
                  <tr key={p.id} onClick={() => {select(p.id);nav(`/app/expedientes/${p.id}`);}} className="cursor-pointer border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.nombre} size={32} photo={p.foto} />
                        <div>
                          <div className="font-medium text-white">{p.nombre}</div>
                          <div className="text-xs text-slate-500">{p.ultima}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-slate-300">{Number.isFinite(imcOf(p.peso,p.altura))?imcOf(p.peso,p.altura).toFixed(1):"—"}</td>
                    <td className="text-slate-300">{Number.isFinite(p.grasa)?p.grasa+"%":"—"}</td>
                    <td>
                      <Badge tone={estadoTone(p.estado)}>{p.estado}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
