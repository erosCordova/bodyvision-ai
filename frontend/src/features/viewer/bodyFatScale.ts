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
