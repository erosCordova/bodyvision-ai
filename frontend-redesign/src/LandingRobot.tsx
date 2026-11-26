import {useEffect,useId,useRef} from "react";

const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/** Original hierarchical vector rig. No external animation assets or runtime license. */
export default function LandingRobot(){
 const uid=useId().replace(/[^a-zA-Z0-9_-]/g,"");
 const ref=useRef<SVGSVGElement>(null);
 const root=useRef<SVGGElement>(null),torso=useRef<SVGGElement>(null),head=useRef<SVGGElement>(null),face=useRef<SVGGElement>(null),eyes=useRef<SVGGElement>(null);
 const left=useRef<SVGGElement>(null),right=useRef<SVGGElement>(null),leftElbow=useRef<SVGGElement>(null),rightElbow=useRef<SVGGElement>(null),leftLeg=useRef<SVGGElement>(null),rightLeg=useRef<SVGGElement>(null),shadow=useRef<SVGEllipseElement>(null);
 const gradient=(id:string)=>"url(#"+uid+id+")";
 useEffect(()=>{
  const svg=ref.current;if(!svg)return;
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
  let targetX=0,targetY=0,x=0,y=0,raf=0,last=0,elapsed=0,visible=true;
  const reset=()=>{targetX=0;targetY=0;};
  const move=(e:PointerEvent)=>{if(e.pointerType==="touch")return;const b=svg.getBoundingClientRect();if(!b.width||!b.height)return;targetX=clamp((e.clientX-b.left-b.width/2)/(Math.max(b.width*.65,180)),-1,1);targetY=clamp((e.clientY-b.top-b.height*.35)/(Math.max(b.height*.65,180)),-1,1);};
  const set=(el:SVGGElement|null,value:string)=>el?.setAttribute("transform",value);
  const tick=(now:number)=>{raf=0;if(!visible||document.hidden||motion.matches)return;const dt=last?Math.min(50,now-last):16;last=now;elapsed+=dt/1000;const k=1-Math.exp(-dt/115);x+=(targetX-x)*k;y+=(targetY-y)*k;
   const idle=Math.sin(elapsed*1.9),float=idle*4;
   set(root.current,"translate("+(x*9).toFixed(2)+" "+(float+y*3).toFixed(2)+")");
   set(torso.current,"rotate("+(-x*5).toFixed(2)+" 250 292)");
   set(head.current,"translate("+(x*6).toFixed(2)+" "+(y*5).toFixed(2)+") rotate("+(-x*9).toFixed(2)+" 250 192)");
   set(face.current,"translate("+(x*10).toFixed(2)+" "+(y*5).toFixed(2)+")");
   const blink=elapsed%5.7;const sy=blink>5.48?Math.max(.12,Math.abs(blink-5.59)/.11):1;
   set(eyes.current,"translate("+(x*4).toFixed(2)+" "+(y*2.5).toFixed(2)+") translate(250 151) scale(1 "+sy.toFixed(2)+") translate(-250 -151)");
   set(left.current,"rotate("+(x*13-y*6+idle*2).toFixed(2)+" 170 240)");
   set(right.current,"rotate("+(x*13+y*6-idle*2).toFixed(2)+" 330 240)");
   set(leftElbow.current,"rotate("+(-7-x*11-y*8).toFixed(2)+" 143 300)");
   set(rightElbow.current,"rotate("+(7-x*11+y*8).toFixed(2)+" 357 300)");
   set(leftLeg.current,"rotate("+(x*3+idle).toFixed(2)+" 220 346)");
   set(rightLeg.current,"rotate("+(x*3-idle).toFixed(2)+" 280 346)");
   shadow.current?.setAttribute("rx",String(105-float*.8));
   shadow.current?.setAttribute("opacity",String(.53-float*.015));
   raf=requestAnimationFrame(tick);
  };
  const restart=()=>{if(raf)cancelAnimationFrame(raf);raf=0;last=0;if(visible&&!document.hidden&&!motion.matches)raf=requestAnimationFrame(tick);else if(motion.matches){[root,torso,head,face,eyes,left,right,leftElbow,rightElbow,leftLeg,rightLeg].forEach(r=>r.current?.removeAttribute("transform"));}};
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;restart();});observer.observe(svg);
  window.addEventListener("pointermove",move,{passive:true});window.addEventListener("blur",reset);document.documentElement.addEventListener("pointerleave",reset);
  document.addEventListener("visibilitychange",restart);motion.addEventListener("change",restart);restart();
  return()=>{cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener("pointermove",move);window.removeEventListener("blur",reset);document.documentElement.removeEventListener("pointerleave",reset);document.removeEventListener("visibilitychange",restart);motion.removeEventListener("change",restart);};
 },[]);
 return <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
 <svg ref={ref} viewBox="0 0 500 520" className="h-full w-full max-w-[560px]" role="img" aria-label="Robot articulado de BodyVision que sigue el cursor">
 <defs>
 <linearGradient id={uid+"shell"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f1fbff"/><stop offset=".36" stopColor="#a9c9dc"/><stop offset=".7" stopColor="#516e88"/><stop offset="1" stopColor="#253b52"/></linearGradient>
 <linearGradient id={uid+"edge"} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#5de8ff"/><stop offset=".45" stopColor="#2b6b86"/><stop offset="1" stopColor="#152538"/></linearGradient>
 <linearGradient id={uid+"visor"} x1="0" y1="0" x2=".2" y2="1"><stop stopColor="#1e5064"/><stop offset=".36" stopColor="#091d2d"/><stop offset="1" stopColor="#030b18"/></linearGradient>
 <linearGradient id={uid+"joint"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#324b60"/><stop offset=".5" stopColor="#0c1a2c"/><stop offset="1" stopColor="#5e90a7"/></linearGradient>
 <radialGradient id={uid+"halo"}><stop stopColor="#22d3ee" stopOpacity=".19"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></radialGradient>
 <radialGradient id={uid+"core"}><stop stopColor="#e7fcff"/><stop offset=".4" stopColor="#67e8f9"/><stop offset="1" stopColor="#0891b2"/></radialGradient>
 <radialGradient id={uid+"ground"}><stop stopColor="#22d3ee" stopOpacity=".5"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></radialGradient>
 <filter id={uid+"glow"} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <clipPath id={uid+"faceClip"}><rect x="182" y="111" width="136" height="78" rx="32"/></clipPath>
 </defs>
 <circle cx="250" cy="235" r="231" fill={gradient("halo")}/>
 <g fill="none" stroke="#5ecde6" opacity=".2">
 <circle cx="250" cy="232" r="185" strokeDasharray="2 10"/><circle cx="250" cy="232" r="208" strokeDasharray="45 15 2 15"/><path d="M40 232H78M422 232H460M250 22V51M250 413V442"/>
 </g>
 <ellipse cx="250" cy="461" rx="148" ry="29" fill={gradient("ground")}/>
 <ellipse ref={shadow} cx="250" cy="461" rx="105" ry="14" fill="#061725" opacity=".53"/>
 <g fill="none" stroke="#22d3ee" opacity=".36"><ellipse cx="250" cy="463" rx="132" ry="23"/><ellipse cx="250" cy="463" rx="151" ry="33" strokeDasharray="35 8 2 8"/></g>
 <g ref={root} strokeLinejoin="round" strokeLinecap="round">
 <g ref={leftLeg}>
 <circle cx="220" cy="346" r="19" fill={gradient("joint")} stroke="#5a8295" strokeWidth="2"/>
 <path d="M202 350 Q220 340 236 350 L236 398 Q218 409 201 397Z" fill={gradient("shell")} stroke="#263e55" strokeWidth="2"/>
 <circle cx="219" cy="402" r="15" fill={gradient("joint")} stroke="#6996a9" strokeWidth="2"/>
 <path d="M201 409 Q218 402 234 409 L237 442 Q224 454 201 444Z" fill={gradient("shell")} stroke="#2a455d" strokeWidth="2"/>
 <path d="M200 438 Q222 431 236 443 L240 450 Q239 458 226 459H193Q183 458 185 449Z" fill={gradient("edge")} stroke="#72cfdf" strokeWidth="1.5"/>
 <path d="M210 420V435" stroke="#baf8ff" strokeWidth="3"/>
 </g>
 <g ref={rightLeg}>
 <circle cx="280" cy="346" r="19" fill={gradient("joint")} stroke="#5a8295" strokeWidth="2"/>
 <path d="M264 350 Q282 340 298 350 L299 397 Q282 409 264 398Z" fill={gradient("shell")} stroke="#263e55" strokeWidth="2"/>
 <circle cx="281" cy="402" r="15" fill={gradient("joint")} stroke="#6996a9" strokeWidth="2"/>
 <path d="M265 409 Q282 402 299 409 L300 444 Q277 454 263 442Z" fill={gradient("shell")} stroke="#2a455d" strokeWidth="2"/>
 <path d="M264 443 Q278 431 300 438 L315 449 Q317 458 307 459H274Q261 458 260 450Z" fill={gradient("edge")} stroke="#72cfdf" strokeWidth="1.5"/>
 <path d="M290 420V435" stroke="#baf8ff" strokeWidth="3"/>
 </g>
 <g ref={torso}>
 <path d="M204 316Q250 307 296 316L289 349Q250 365 211 349Z" fill={gradient("joint")} stroke="#41677e" strokeWidth="2"/>
 <path d="M218 338H282" stroke="#24cbe9" strokeWidth="2" opacity=".75"/>
 <g ref={left}>
 <circle cx="170" cy="240" r="23" fill={gradient("joint")} stroke="#74bdd1" strokeWidth="2"/>
 <path d="M157 221Q135 225 132 247L131 284Q139 297 158 294L178 252Q183 231 157 221Z" fill={gradient("shell")} stroke="#29465b" strokeWidth="2"/>
 <path d="M143 244L137 275" stroke="#e3f7ff" strokeWidth="2.5" opacity=".7"/>
 <g ref={leftElbow}>
 <circle cx="143" cy="300" r="15" fill={gradient("joint")} stroke="#74bdd1" strokeWidth="2"/>
 <path d="M128 303Q142 296 157 309L153 346Q142 359 124 347L118 326Z" fill={gradient("shell")} stroke="#29465b" strokeWidth="2"/>
 <path d="M124 350Q141 345 153 354L151 372Q142 383 129 376L120 365Z" fill={gradient("joint")} stroke="#668b9d" strokeWidth="2"/>
 <path d="M129 359L131 370M138 357L140 373M146 357L146 370" stroke="#7294a7" strokeWidth="1.8"/>
 <path d="M129 316L128 334" stroke="#67e8f9" strokeWidth="3"/>
 </g></g>
 <g ref={right}>
 <circle cx="330" cy="240" r="23" fill={gradient("joint")} stroke="#74bdd1" strokeWidth="2"/>
 <path d="M343 221Q365 225 368 247L369 284Q361 297 342 294L322 252Q317 231 343 221Z" fill={gradient("shell")} stroke="#29465b" strokeWidth="2"/>
 <path d="M357 244L363 275" stroke="#e3f7ff" strokeWidth="2.5" opacity=".7"/>
 <g ref={rightElbow}>
 <circle cx="357" cy="300" r="15" fill={gradient("joint")} stroke="#74bdd1" strokeWidth="2"/>
 <path d="M372 303Q358 296 343 309L347 346Q358 359 376 347L382 326Z" fill={gradient("shell")} stroke="#29465b" strokeWidth="2"/>
 <path d="M376 350Q359 345 347 354L349 372Q358 383 371 376L380 365Z" fill={gradient("joint")} stroke="#668b9d" strokeWidth="2"/>
 <path d="M371 359L369 370M362 357L360 373M354 357L354 370" stroke="#7294a7" strokeWidth="1.8"/>
 <path d="M371 316L372 334" stroke="#67e8f9" strokeWidth="3"/>
 </g></g>
 <path d="M190 224Q209 206 250 208Q291 206 310 224L316 276Q310 315 285 330H215Q190 315 184 276Z" fill={gradient("shell")} stroke="#315065" strokeWidth="3"/>
 <path d="M190 240Q250 216 310 240L298 289Q250 313 202 289Z" fill={gradient("edge")} stroke="#4b90aa" strokeWidth="2"/>
 <path d="M201 245Q250 230 299 245L291 282Q250 301 209 282Z" fill={gradient("visor")} stroke="#6b9fb4" strokeWidth="1.5"/>
 <circle cx="250" cy="266" r="27" fill="#0c2b40" stroke="#4ac8dc" strokeWidth="1.5"/>
 <circle cx="250" cy="266" r="20" fill="none" stroke="#56e3f6" strokeWidth="2" strokeDasharray="13 6"/>
 <circle cx="250" cy="266" r="12" fill={gradient("core")} filter={gradient("glow")}/>
 <path d="M215 309H285M220 316H280" stroke="#21394d" strokeWidth="2"/>
 <path d="M198 229Q219 215 235 217M265 217Q281 215 302 229" fill="none" stroke="#e5f8ff" strokeWidth="3" opacity=".65"/>
 <rect x="233" y="193" width="34" height="23" rx="9" fill={gradient("joint")} stroke="#518399" strokeWidth="2"/>
 <g ref={head}>
 <path d="M250 83V62" stroke="#8eb6ca" strokeWidth="6"/>
 <circle cx="250" cy="59" r="6" fill="#84f1ff" filter={gradient("glow")}/>
 <rect x="152" y="126" width="25" height="49" rx="11" fill={gradient("joint")} stroke="#73adbf" strokeWidth="2"/>
 <rect x="323" y="126" width="25" height="49" rx="11" fill={gradient("joint")} stroke="#73adbf" strokeWidth="2"/>
 <path d="M158 141V159M342 141V159" stroke="#67e8f9" strokeWidth="3"/>
 <rect x="165" y="80" width="170" height="126" rx="50" fill={gradient("shell")} stroke="#304c63" strokeWidth="3"/>
 <path d="M185 103Q207 85 236 87H264Q293 85 315 103" fill="none" stroke="#f2fcff" strokeWidth="3" opacity=".8"/>
 <rect x="178" y="107" width="144" height="86" rx="35" fill={gradient("edge")} stroke="#83c6d8" strokeWidth="1.5"/>
 <rect x="182" y="111" width="136" height="78" rx="32" fill={gradient("visor")}/>
 <g clipPath={gradient("faceClip")}>
 <path d="M186 121Q250 110 314 121" fill="none" stroke="#6ebed1" strokeWidth="2" opacity=".38"/>
 <g ref={face}>
 <g ref={eyes} fill="#90f3ff" filter={gradient("glow")}><rect x="204" y="139" width="31" height="23" rx="11"/><rect x="265" y="139" width="31" height="23" rx="11"/></g>
 <path d="M239 174Q250 181 261 174" stroke="#67e8f9" strokeWidth="3" fill="none"/>
 </g></g>
 <path d="M229 197H271" stroke="#3a5a70" strokeWidth="2"/>
 </g></g></g>
 </svg></div>;
}
