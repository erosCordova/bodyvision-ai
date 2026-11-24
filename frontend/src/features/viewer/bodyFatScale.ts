import type { Measurement } from "../../services/api/records";

// A continuous, non-clinical color scale for a single global percentage.
// Never use this to claim a measured local distribution or classify health.
export function validFatPercentage(value: number): boolean {
  return Number.isFinite(value) && value >= 2 && value <= 70;
}
const colors = [[34,84,244],[22,198,216],[244,212,59],[241,113,50],[215,42,73]];
export function fatScaleColor(value: number): string {
  const n = Math.max(0,Math.min(100,Number.isFinite(value)?value:0))/25;
  const i = Math.min(3,Math.floor(n));
  const t = n-i;
  return "#"+colors[i].map((channel,j)=>Math.round(channel+(colors[i+1][j]-channel)*t).toString(16).padStart(2,"0")).join("");
}

const limaDay = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"});
export function pairedBodyComposition(fat: Measurement, weights: Measurement[]) {
  const time = Date.parse(fat.measured_at);
  if (!Number.isFinite(time) || !fat.is_current || fat.metric_code!=="body_fat_pct" || fat.unit!=="%" ||
      fat.method!=="device" || !fat.instrument?.trim() || !validFatPercentage(fat.value)) return null;
  const candidates = weights.filter(row=>{
    const t=Date.parse(row.measured_at);
    return row.profile_id===fat.profile_id && row.is_current && row.metric_code==="weight" && row.unit==="kg" &&
      Number.isFinite(row.value) && row.value>0 && Number.isFinite(t) && limaDay.format(t)===limaDay.format(time);
  }).sort((a,b)=>Math.abs(Date.parse(a.measured_at)-time)-Math.abs(Date.parse(b.measured_at)-time) ||
    Date.parse(b.measured_at)-Date.parse(a.measured_at) || a.id.localeCompare(b.id));
  const weight=candidates[0];
  if(!weight)return null;
  const fatKg=weight.value*fat.value/100;
  return {weight,fatKg,leanKg:weight.value-fatKg};
}
