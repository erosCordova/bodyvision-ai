import {useEffect,useId,useRef} from "react";

const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/** Original hierarchical vector rig. No external animation assets or runtime license. */
export default function LandingAthlete(){
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
   const idle=Math.sin(elapsed*1.7),float=idle*.55;
   set(root.current,"translate("+(x*2).toFixed(2)+" "+float.toFixed(2)+")");
   set(torso.current,"rotate("+(-x*3.5).toFixed(2)+" 250 303)");
   set(head.current,"translate("+(x*3).toFixed(2)+" "+(y*2).toFixed(2)+") rotate("+(-x*7).toFixed(2)+" 250 153)");
   set(face.current,"translate("+(x*3).toFixed(2)+" "+(y*1.6).toFixed(2)+")");
   const blink=elapsed%5.7;const sy=blink>5.48?Math.max(.12,Math.abs(blink-5.59)/.11):1;
   set(eyes.current,"translate("+(x*1.8).toFixed(2)+" "+(y*1.2).toFixed(2)+") translate(250 105) scale(1 "+sy.toFixed(2)+") translate(-250 -105)");
   set(left.current,"rotate("+(x*8-y*3+idle*1.1).toFixed(2)+" 191 177)");
   set(right.current,"rotate("+(x*8+y*3-idle*1.1).toFixed(2)+" 309 177)");
   set(leftElbow.current,"rotate("+(-2-x*6-y*4).toFixed(2)+" 173 245)");
   set(rightElbow.current,"rotate("+(2-x*6+y*4).toFixed(2)+" 327 245)");
   set(leftLeg.current,"rotate("+(x*.9+idle*.25).toFixed(2)+" 229 321)");
   set(rightLeg.current,"rotate("+(x*.9-idle*.25).toFixed(2)+" 271 321)");
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
 <svg ref={ref} viewBox="0 0 500 520" className="h-full w-full max-w-[560px]" role="img" aria-label="Personaje deportivo articulado que sigue el cursor">
 <defs>
 <linearGradient id={uid+"skin"} x1="0" y1=".15" x2="1" y2=".85"><stop stopColor="#eac09e"/><stop offset=".48" stopColor="#c48a69"/><stop offset="1" stopColor="#89563e"/></linearGradient>
 <linearGradient id={uid+"skinLight"} x1=".15" y1="0" x2=".8" y2="1"><stop stopColor="#f1c8a8"/><stop offset=".64" stopColor="#d39a78"/><stop offset="1" stopColor="#9b614b"/></linearGradient>
 <linearGradient id={uid+"shirt"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#416273"/><stop offset=".4" stopColor="#233d4b"/><stop offset="1" stopColor="#101f2d"/></linearGradient>
 <linearGradient id={uid+"shorts"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#233849"/><stop offset=".6" stopColor="#132534"/><stop offset="1" stopColor="#0a1420"/></linearGradient>
 <linearGradient id={uid+"hair"} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#473c36"/><stop offset=".55" stopColor="#29272a"/><stop offset="1" stopColor="#181b22"/></linearGradient>
 <linearGradient id={uid+"shoe"} x1="0" y1="0" x2=".9" y2="1"><stop stopColor="#edf5f6"/><stop offset=".7" stopColor="#afc3cc"/><stop offset="1" stopColor="#738998"/></linearGradient>
 <radialGradient id={uid+"halo"}><stop stopColor="#22d3ee" stopOpacity=".15"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></radialGradient>
 <radialGradient id={uid+"ground"}><stop stopColor="#22d3ee" stopOpacity=".28"/><stop offset="1" stopColor="#22d3ee" stopOpacity="0"/></radialGradient>
 </defs>
 <circle cx="250" cy="245" r="228" fill={gradient("halo")}/>
 <g fill="none" stroke="#5ecde6" opacity=".16"><circle cx="250" cy="245" r="194" strokeDasharray="2 10"/><circle cx="250" cy="245" r="216" strokeDasharray="40 14 2 14"/><path d="M28 245H58M442 245H472M250 20V43M250 450V474"/></g>
 <ellipse cx="250" cy="485" rx="139" ry="26" fill={gradient("ground")}/>
 <ellipse ref={shadow} cx="250" cy="483" rx="105" ry="11" fill="#061725" opacity=".53"/>
 <ellipse cx="250" cy="483" rx="128" ry="19" stroke="#22d3ee" strokeOpacity=".26" fill="none"/>
 <g ref={root} strokeLinejoin="round" strokeLinecap="round">
 <g ref={leftLeg}>
 <path d="M205 308Q222 303 247 312L241 366Q238 387 236 405L232 450Q228 460 216 456L207 417Q202 397 207 375L199 329Z" fill={gradient("skin")} stroke="#86553f" strokeWidth="1.2"/>
 <path d="M217 371Q228 379 237 371M215 397Q210 415 218 434" fill="none" stroke="#986447" opacity=".65" strokeWidth="2"/>
 <path d="M198 302Q221 300 249 310L242 367Q223 375 202 365L194 320Z" fill={gradient("shorts")} stroke="#0e1d2a" strokeWidth="1.7"/>
 <path d="M201 316L205 357M204 363Q222 369 240 363" stroke="#4f8393" strokeWidth="1.4" fill="none"/>
 <path d="M211 439Q222 444 233 440L233 460L215 465L209 458Z" fill="#dbe7e9" stroke="#8096a1" strokeWidth="1"/>
 <path d="M211 455Q222 460 233 454L237 468Q236 478 225 480H191Q180 477 185 469L202 460Z" fill={gradient("shoe")} stroke="#597280" strokeWidth="1.5"/>
 <path d="M186 474Q210 477 236 471L236 479Q211 484 188 480Z" fill="#e2ebed"/><path d="M202 464L216 466M207 460L220 462" stroke="#4b6675" strokeWidth="1.8"/><path d="M192 472L206 469" stroke="#26b6ca" strokeWidth="2.5"/>
 </g>
 <g ref={rightLeg}>
 <path d="M253 312Q278 303 295 308L301 329L293 375Q298 397 293 417L284 456Q272 460 268 450L264 405Q262 387 259 366Z" fill={gradient("skinLight")} stroke="#86553f" strokeWidth="1.2"/>
 <path d="M263 371Q272 379 283 371M285 397Q290 415 282 434" fill="none" stroke="#986447" opacity=".65" strokeWidth="2"/>
 <path d="M251 310Q279 300 302 302L306 320L298 365Q277 375 258 367Z" fill={gradient("shorts")} stroke="#0e1d2a" strokeWidth="1.7"/>
 <path d="M299 316L295 357M260 363Q278 369 296 363" stroke="#4f8393" strokeWidth="1.4" fill="none"/>
 <path d="M267 440Q278 444 289 439L291 458L285 465L267 460Z" fill="#dbe7e9" stroke="#8096a1" strokeWidth="1"/>
 <path d="M267 454Q278 460 289 455L298 460L315 469Q320 477 309 480H275Q264 478 263 468Z" fill={gradient("shoe")} stroke="#597280" strokeWidth="1.5"/>
 <path d="M264 471Q290 477 314 474L312 480Q289 484 264 479Z" fill="#e2ebed"/><path d="M284 466L298 464M280 462L293 460" stroke="#4b6675" strokeWidth="1.8"/><path d="M294 469L308 472" stroke="#26b6ca" strokeWidth="2.5"/>
 </g>
 <g ref={torso}>
 <path d="M196 286Q250 275 304 286L303 324Q250 339 197 324Z" fill={gradient("shorts")} stroke="#142432" strokeWidth="1.8"/>
 <path d="M199 310Q250 319 301 310" fill="none" stroke="#627e8c" strokeWidth="1.4"/>
 <path d="M250 316L245 330M250 316L256 330" stroke="#9eb1ba" strokeWidth="1.6"/>
 <g ref={left}>
 <path d="M192 164Q176 163 169 185L163 220Q160 237 166 251L180 252Q189 238 189 220L204 186Q208 171 192 164Z" fill={gradient("skin")} stroke="#8a5743" strokeWidth="1.1"/>
 <path d="M175 193Q165 216 170 230M184 202L180 224" fill="none" stroke="#966044" strokeWidth="1.6" opacity=".75"/>
 <g ref={leftElbow}>
 <path d="M166 241Q173 237 183 244L178 266Q172 285 169 307L155 307Q151 287 154 269L158 252Z" fill={gradient("skinLight")} stroke="#8a5743" strokeWidth="1.1"/>
 <path d="M161 261Q158 282 161 297" fill="none" stroke="#a57156" strokeWidth="1.4"/>
 <path d="M154 305Q162 302 170 307L174 319L172 329Q169 333 166 329L164 322L163 337Q160 342 157 336L156 324L155 336Q151 339 149 334L147 321L148 312Z" fill={gradient("skin")} stroke="#926149" strokeWidth="1.1"/>
 <path d="M151 317L154 325M158 316L160 324" stroke="#8c5b45" strokeWidth=".9"/>
 <rect x="153" y="297" width="18" height="7" rx="2" fill="#101f2c"/><rect x="155" y="295" width="9" height="10" rx="2" fill="#314f60" stroke="#81a9b3" strokeWidth=".8"/>
 </g></g>
 <g ref={right}>
 <path d="M308 164Q324 163 331 185L337 220Q340 237 334 251L320 252Q311 238 311 220L296 186Q292 171 308 164Z" fill={gradient("skinLight")} stroke="#8a5743" strokeWidth="1.1"/>
 <path d="M325 193Q335 216 330 230M316 202L320 224" fill="none" stroke="#966044" strokeWidth="1.6" opacity=".7"/>
 <g ref={rightElbow}>
 <path d="M334 241Q327 237 317 244L322 266Q328 285 331 307L345 307Q349 287 346 269L342 252Z" fill={gradient("skin")} stroke="#8a5743" strokeWidth="1.1"/>
 <path d="M339 261Q342 282 339 297" fill="none" stroke="#a57156" strokeWidth="1.4"/>
 <path d="M346 305Q338 302 330 307L326 319L328 329Q331 333 334 329L336 322L337 337Q340 342 343 336L344 324L345 336Q349 339 351 334L353 321L352 312Z" fill={gradient("skinLight")} stroke="#926149" strokeWidth="1.1"/>
 <path d="M349 317L346 325M342 316L340 324" stroke="#8c5b45" strokeWidth=".9"/>
 </g></g>
 <path d="M232 131L229 154L216 162Q250 183 284 162L271 154L268 131Z" fill={gradient("skin")} stroke="#86553f" strokeWidth="1.1"/>
 <path d="M229 153Q203 156 189 167Q182 172 177 191L198 203L205 190Q210 218 203 244L196 298Q250 314 304 298L297 244Q290 218 295 190L302 203L323 191Q318 172 311 167Q297 156 271 153Q267 169 250 172Q233 169 229 153Z" fill={gradient("shirt")} stroke="#172f3f" strokeWidth="1.8"/>
 <path d="M230 155Q234 172 250 175Q266 172 270 155" fill="none" stroke="#91aab4" strokeWidth="2"/>
 <path d="M192 172Q204 166 219 165M308 172Q296 166 281 165" fill="none" stroke="#7794a1" strokeWidth="1.6"/>
 <path d="M205 196Q217 205 241 205M295 196Q283 205 259 205M206 250Q223 241 239 246M294 250Q277 241 261 246M203 292Q250 300 297 292" fill="none" stroke="#7595a4" strokeOpacity=".25" strokeWidth="1.6"/>
 <path d="M201 206Q205 236 200 270M299 206Q295 236 300 270" fill="none" stroke="#1ca8b9" strokeOpacity=".7" strokeWidth="2"/>
 <path d="M277 184L283 180L289 184L283 188Z" fill="#67e8f9"/><path d="M278 190H288" stroke="#67e8f9" strokeWidth="1.1"/>
 <g ref={head}>
 <path d="M221 95Q211 88 210 101Q210 116 222 119M279 95Q289 88 290 101Q290 116 278 119" fill={gradient("skin")} stroke="#86553f" strokeWidth="1.1"/>
 <path d="M219 80Q224 60 250 57Q276 60 281 80L282 113Q279 133 265 143Q250 153 235 143Q221 133 218 113Z" fill={gradient("skinLight")} stroke="#81523f" strokeWidth="1.2"/>
 <path d="M217 97Q211 77 220 65Q230 48 255 50Q276 49 285 66Q290 79 282 98L278 80Q269 72 259 74Q238 80 223 74L222 94Z" fill={gradient("hair")} stroke="#25252b" strokeWidth="1.4"/>
 <path d="M224 65Q244 51 267 59M226 68Q245 58 259 64M268 64Q279 67 283 75" fill="none" stroke="#65534b" strokeOpacity=".65" strokeWidth="1.4"/>
 <path d="M218 112Q223 131 235 141M282 112Q277 131 265 141" fill="none" stroke="#a86b51" strokeWidth="1.3"/>
 <g ref={face}>
 <path d="M228 94Q235 91 242 94M258 94Q265 91 272 94" fill="none" stroke="#4f392e" strokeWidth="2.2"/>
 <g fill="#f3e9de" stroke="#8a5b47" strokeWidth=".7"><path d="M226 102Q234 97 242 102Q234 107 226 102Z"/><path d="M258 102Q266 97 274 102Q266 107 258 102Z"/></g>
 <g ref={eyes}><circle cx="234" cy="102" r="3" fill="#403b34"/><circle cx="266" cy="102" r="3" fill="#403b34"/><circle cx="235" cy="101" r=".8" fill="#fff"/><circle cx="267" cy="101" r=".8" fill="#fff"/></g>
 <path d="M250 102L247 115Q250 117 254 115" fill="none" stroke="#a26b52" strokeWidth="1.4"/>
 <path d="M240 127Q250 130 260 126" fill="none" stroke="#854c40" strokeWidth="1.8"/>
 <path d="M245 133Q250 134 255 132" fill="none" stroke="#ad7258" strokeWidth="1.1"/>
 </g>
 </g></g></g>
 </svg></div>;
}
