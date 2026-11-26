export type ReportTable={title:string;patient:string;code:string;date:string;columns:string[];rows:string[][]};
const clean=(s:string)=>Array.from(s.normalize("NFC")).map(c=>{const n=c.charCodeAt(0);return n>=32&&n<=255?c:"-";}).join("");
const literal=(s:string)=>"("+Array.from(clean(s)).map(c=>{const n=c.charCodeAt(0);return n>126?"\\"+n.toString(8).padStart(3,"0"):"\\()".includes(c)?"\\"+c:c;}).join("")+")";
const truncate=(s:string,n:number)=>s.length>n?s.slice(0,n-3)+"...":s;
export function reportPdf(r:ReportTable):Uint8Array{
 const objs:string[]=["","<< /Type /Catalog /Pages 2 0 R >>","","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
 const wide=r.columns.length>4;const pageWidth=wide?842:595,pageHeight=wide?595:842,tableWidth=pageWidth-72;const weights=wide?[.25,.17,.14,.11,.11,.11,.11]:[.44,.17,.16,.23];const widths=r.columns.map((_,i)=>tableWidth*(weights[i]||1/r.columns.length));const x=widths.map((_,i)=>36+widths.slice(0,i).reduce((a,b)=>a+b,0)+4);const limits=widths.map(w=>Math.max(6,Math.floor((w-8)/5.2)));const perPage=wide?17:29;const pages:number[]=[];const count=Math.max(1,Math.ceil(r.rows.length/perPage));
 const text=(x:number,y:number,value:string,size=10,bold=false,color="0.09 0.15 0.22")=>"BT /"+(bold?"F2":"F1")+" "+size+" Tf "+color+" rg 1 0 0 1 "+x+" "+y+" Tm "+literal(value)+" Tj ET\n";
 for(let i=0;i<count;i++){
  const top=pageHeight-196;let stream="0.035 0.12 0.20 rg 0 "+(pageHeight-104)+" "+pageWidth+" 104 re f\n"+text(36,pageHeight-35,"BODYVISION AI",19,true,"0.8 0.95 1")+text(36,pageHeight-63,truncate(r.title,70),14,true,"1 1 1")+text(36,pageHeight-124,"Paciente: "+r.patient,11,true)+text(36,pageHeight-142,"Expediente: "+r.code,10)+text(36,pageHeight-159,"Emitido: "+r.date,10);
  stream+="0.88 0.93 0.96 rg 36 "+top+" "+tableWidth+" 25 re f\n";
  r.columns.forEach((c,j)=>{stream+=text(x[j],top+8,truncate(c,limits[j]),10,true);});
  r.rows.slice(i*perPage,(i+1)*perPage).forEach((row,k)=>{const y=top-16-k*20;if(k%2===1)stream+="0.96 0.97 0.98 rg 36 "+(y-6)+" "+tableWidth+" 20 re f\n";row.forEach((cell,j)=>{stream+=text(x[j],y,truncate(cell,limits[j]),10);});});
  if(!r.rows.length)stream+=text(36,top-26,"Sin mediciones registradas.");
  stream+=text(36,32,"Registros del expediente - no constituye diagnostico.",9)+text(pageWidth-117,32,"Pagina "+(i+1)+"/"+count,9);
  const page=objs.length,content=page+1;pages.push(page);
  objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pageWidth+" "+pageHeight+"] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents "+content+" 0 R >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"endstream");
 }
 objs[2]="<< /Type /Pages /Count "+pages.length+" /Kids ["+pages.map(p=>p+" 0 R").join(" ")+"] >>";
 let out="%PDF-1.4\n";const offsets=[0];for(let i=1;i<objs.length;i++){offsets.push(out.length);out+=i+" 0 obj\n"+objs[i]+"\nendobj\n";}
 const xref=out.length;out+="xref\n0 "+objs.length+"\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+objs.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
 return new TextEncoder().encode(out);
}
export function downloadReportPdf(r:ReportTable,name:string){const bytes=reportPdf(r);const blob=new Blob([bytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
