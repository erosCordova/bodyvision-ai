import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { ErrorState, LoadingState } from "../../components/ui/States";
import type { Measurement, Profile } from "../../services/api/records";

type Page = { items: unknown[]; total: number; limit: number; offset: number };

function Pagination({ page, onChange, label }: { page: Page; onChange: (offset: number) => void; label: string }) {
  const start = page.items.length ? page.offset + 1 : 0;
  const end = page.items.length ? page.offset + page.items.length : 0;
  return <nav className="pagination module-pagination" aria-label={label}>
    <button type="button" disabled={page.offset === 0} onClick={() => onChange(Math.max(0,page.offset-page.limit))}>Anterior</button>
    <span role="status">{start}–{end} de {page.total}</span>
    <button type="button" disabled={page.offset+page.limit>=page.total} onClick={() => onChange(page.offset+page.limit)}>Siguiente</button>
  </nav>;
}

function Picker({ selected, selectedId, onChange }: { selected: Profile|null; selectedId: string; onChange: (id:string)=>void }) {
  const { id, api } = useWorkspace();
  const [search,setSearch] = useState("");
  const [offset,setOffset] = useState(0);
  const profiles = useQuery({queryKey:["module-profile-picker",id,search,offset],queryFn:()=>api.profiles(search,offset)});
  const items=profiles.data?.items ?? [];
  return <div className="module-profile-picker">
    {(search||!profiles.data||profiles.data.total>profiles.data.limit)&&<label>Buscar<input placeholder="Nombre o código" value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setOffset(0);}} /></label>}
    {profiles.isError ? <ErrorState error={profiles.error} retry={()=>void profiles.refetch()}/> : profiles.isPending ? <LoadingState/> : null}
    <label>Expediente<select value={selectedId} onChange={e=>onChange(e.target.value)}>
      <option value="">Seleccionar expediente</option>
      {selectedId && !items.some(p=>p.id===selectedId) && <option value={selectedId}>{selected?.display_name||selected?.display_code||"Expediente seleccionado"}</option>}
      {items.map(p=><option key={p.id} value={p.id}>{p.display_name||p.display_code} · {p.display_code}</option>)}
    </select></label>
    {profiles.data && <>{(profiles.data.total>profiles.data.limit||offset>0)&&<Pagination page={profiles.data} onChange={setOffset} label="Páginas de expedientes del informe"/>}
      {items.length===0 && <p className="enterprise-hint">No hay expedientes para esta búsqueda.</p>}</>}
  </div>;
}
export const ProfilePicker = Object.assign(Picker,{Pagination});

export function csvPreview(rows: Measurement[]): string {
  // Spreadsheet formulas are never evaluated as formulas in exported text.
  const escape = (value: string) => {
    const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value) ? "'"+value : value;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  const header = ["fecha","metrica","valor","unidad","metodo","responsable","tipo"];
  return "\uFEFF"+[header,...rows.map(m=>[m.measured_at,m.metric_code,String(m.value),m.unit,m.method,m.responsible,m.data_type])]
    .map(row=>row.map(escape).join(",")).join("\r\n");
}
