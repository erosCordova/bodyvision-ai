/** Shared deterministic visual projection; not a trained predictive model. */
export function projectBody(weight:number,fat:number,dfat:number,dmus:number,weeks:number){
  if(![weight,fat,dfat,dmus,weeks].every(Number.isFinite)||!Number.isInteger(weeks)||weeks<1||weeks>520)throw Error("Parámetros de simulación no válidos");
  const pesoObj=+(weight+dfat*.9+dmus*.5).toFixed(1),grasaObj=+(fat+dfat).toFixed(1);
  const data=Array.from({length:weeks+1},(_,w)=>{const k=1-(1-w/weeks)**2;return {sem:w,peso:+(weight+(pesoObj-weight)*k).toFixed(1),grasa:+(fat+dfat*k).toFixed(1)};});
  return {pesoObj,grasaObj,data};
}
export function checkProjection(){
 const {pesoObj,grasaObj,data}=projectBody(80,25,-5,2,12);
 if(pesoObj!==76.5||grasaObj!==20||data.length!==13||data[0].peso!==80||data[12].peso!==pesoObj||data[12].grasa!==grasaObj||data.some((p,i)=>!Number.isFinite(p.peso)||!Number.isFinite(p.grasa)||(i>0&&p.peso>data[i-1].peso)))throw Error("La proyección no supera la comprobación");
}
