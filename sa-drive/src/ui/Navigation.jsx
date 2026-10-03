import { guidance } from '../game/runtime.js';
import { useEffect, useRef, useState } from 'react';
import { car } from '../car/state.js';
import { destinations, navigation, bearingTo, shortestAngle } from '../config/navigation.js';
export default function Navigation() {
  const [selected,setSelected]=useState(navigation.selected);
  const [arrived,setArrived]=useState(false);
  const arrow=useRef(),distance=useRef(),caption=useRef();
  useEffect(()=>{
    const key=e=>{const n=Number(e.key)-1;if(n>=0&&n<3){navigation.selected=n;setSelected(n);setArrived(false);}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[]);
  useEffect(()=>{
    let raf,angle=0,last=performance.now(),reached=false;
    function tick(now){
      const target=guidance.lookahead,d=guidance.remaining;
      if(target&&!guidance.arrived) angle+=shortestAngle(bearingTo(car,target)-angle)*(1-Math.exp(-9*Math.min((now-last)/1000,.1)));last=now;
      arrow.current.style.opacity=!guidance.route||guidance.arrived?'.35':'1';
      arrow.current.style.transform=`rotate(${angle}rad)`;
      caption.current.textContent=guidance.status;
      distance.current.textContent=!guidance.route?'--':d<160?`${Math.round(d)} m`:`${(d/1609.344).toFixed(2)} mi`;
      if(guidance.arrived&&!reached){reached=true;setArrived(true);}else if(!guidance.arrived&&reached){reached=false;setArrived(false);}
      raf=requestAnimationFrame(tick);
    }
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  },[selected]);
  return <aside className="navigation" aria-label="Destination navigation">
    <div className="nav-eyebrow">SAN ANTONIO / NIGHT DRIVE</div>
    <div className="arrow-perspective"><svg ref={arrow} className="nav-arrow" viewBox="0 0 72 76" aria-label="Next road direction">
      <defs><linearGradient id="arrow-top" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f0ffff"/><stop offset=".45" stopColor="#73fff0"/><stop offset="1" stopColor="#159faa"/></linearGradient><linearGradient id="arrow-side"><stop stopColor="#0e526c"/><stop offset="1" stopColor="#28bac6"/></linearGradient></defs>
      <path d="M36 10 63 43 47 43 47 65 25 65 25 43 9 43Z" fill="url(#arrow-side)" stroke="#135467"/>
      <path d="M36 3 63 36 47 36 47 58 25 58 25 36 9 36Z" fill="url(#arrow-top)" stroke="#acfff5" strokeWidth="1.5"/>
      <path d="M36 5 36 30 25 56 25 36 11 36Z" fill="#fff" opacity=".2"/>
      <path d="M47 36 63 36 63 43 47 43M47 58 47 65 25 65 25 58" fill="#0c8193"/>
    </svg></div>
    <div className="nav-name">{destinations[selected].name}</div>
    <div className="nav-distance" ref={distance}/><span className="nav-caption" ref={caption}>REMAINING ROAD DISTANCE</span>
    <div className="nav-options">{destinations.map((d,i)=><button key={d.key} aria-pressed={i===selected} onClick={()=>{navigation.selected=i;setSelected(i);setArrived(false);}}>{i+1} / {['Alamo','River Walk','Tower'][i]}</button>)}</div>
    {arrived&&<div className="arrival" role="status">You reached {destinations[selected].name} road access!</div>}
  </aside>;
}
