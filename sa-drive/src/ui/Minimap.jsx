import { CAMPUS_BUILDINGS } from '../config/campus.js';
import { ROUTE_COLOR } from '../config/routeStyle.js';
import { guidance,game } from '../game/runtime.js';
import { useEffect, useRef, useState } from 'react';
import { destinations, navigation } from '../config/navigation.js';
import { car } from '../car/state.js';

const SIZE = 160;
const SCALE = 0.12; // pixels per meter

export default function Minimap({ roads, buildings = [], river }) {
  const [expanded,setExpanded]=useState(false);
  const [selected,setSelected]=useState(navigation.selected);
  const triggerRef=useRef(),closeRef=useRef();
  const size=expanded?560:SIZE,scale=expanded?.17:SCALE;
  const canvasRef = useRef();
  const roadCacheRef = useRef(null);
  function close(){setExpanded(false);requestAnimationFrame(()=>triggerRef.current?.focus());}
  function choose(index){navigation.selected=index;setSelected(index);}
  useEffect(()=>{
    if(!expanded)return;
    closeRef.current?.focus();
    const key=e=>{if(e.key==='Escape'){e.preventDefault();setExpanded(false);requestAnimationFrame(()=>triggerRef.current?.focus());}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[expanded]);

  // Pre-render road lines to an offscreen canvas
  useEffect(() => {
    if (!roads || roads.length === 0) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = SIZE * 8;
    offscreen.height = SIZE * 8;
    const ctx = offscreen.getContext('2d');

    ctx.strokeStyle = '#638897';
    ctx.lineWidth = 1;
    const cx = offscreen.width / 2;
    const cy = offscreen.height / 2;
    const s = SCALE * 4;

    for (const road of roads) {
      const pts = road.points;
      if (pts.length < 2) continue;
      ctx.lineWidth = Math.max(1.5, road.width * s);
      ctx.beginPath();
      ctx.moveTo(cx + pts[0].x * s, cy + pts[0].z * s);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(cx + pts[i].x * s, cy + pts[i].z * s);
      }
      ctx.stroke();
    }

    roadCacheRef.current = offscreen;
  }, [roads]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    function draw() {
      const SIZE=size,SCALE=scale;
      const center=expanded?{x:0,z:0}:car;
      if(navigation.selected!==selected)setSelected(navigation.selected);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Draw road cache centered on player
      if (roadCacheRef.current) {
        const src = roadCacheRef.current;
        const cacheScale=.12*4;
        const srcCx = src.width / 2 + center.x * cacheScale;
        const srcCz = src.height / 2 + center.z * cacheScale;
        const span=SIZE/SCALE*cacheScale;

        ctx.drawImage(
          src,
          srcCx - span/2, srcCz - span/2,
          span, span,
          0, 0,
          SIZE, SIZE
        );
      }

      // Campus footprints and the creek keep the spawn district recognizable.
      ctx.strokeStyle='#369b9a';ctx.lineWidth=expanded?3:2;
      for(const path of river?.paths||[]){ctx.beginPath();path.forEach((p,i)=>{const x=SIZE/2+(p.x-center.x)*SCALE,y=SIZE/2+(p.z-center.z)*SCALE;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();}
      for(const b of buildings){
        const config=CAMPUS_BUILDINGS[b.id];if(!config)continue;
        ctx.fillStyle='#ed722f';ctx.beginPath();b.points.forEach((p,i)=>{const x=SIZE/2+(p.x-center.x)*SCALE,y=SIZE/2+(p.z-center.z)*SCALE;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();ctx.fill();
        if(b.id===80475799||b.id===126457328)continue;
        const p=b.points[0],x=SIZE/2+(p.x-center.x)*SCALE,y=SIZE/2+(p.z-center.z)*SCALE;
        if(x<8||x>SIZE-30||y<16||y>SIZE-20||(!expanded&&config.name==='UTSA'))continue;
        ctx.font='bold 10px system-ui';ctx.fillStyle='#fff';ctx.fillText(config.name==='UTSA'?'DOWNTOWN CAMPUS':config.name,x-8,y+(config.name==='SP1'?17:-7));
      }
      const points=guidance.route?.points||[];
      if(points.length){ctx.strokeStyle=ROUTE_COLOR;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>{const x=SIZE/2+(p.x-center.x)*SCALE,y=SIZE/2+(p.z-center.z)*SCALE;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();}
      if(game.police){const x=SIZE/2+(game.police.x-center.x)*SCALE,y=SIZE/2+(game.police.z-center.z)*SCALE;ctx.fillStyle='#ff4e75';ctx.fillRect(x-4,y-3,4,6);ctx.fillStyle='#58aaff';ctx.fillRect(x,y-3,4,6);}
      const access=guidance.route?.endpoint;
      if(access){ctx.strokeStyle=ROUTE_COLOR;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(SIZE/2+(access.x-center.x)*SCALE,SIZE/2+(access.z-center.z)*SCALE,4,0,Math.PI*2);ctx.stroke();}
      const destination=destinations[navigation.selected];
      const dx=(destination.x-center.x)*SCALE,dz=(destination.z-center.z)*SCALE;
      const factor=Math.min(1,(SIZE/2-12)/Math.max(Math.abs(dx),Math.abs(dz),1));
      ctx.fillStyle='#ffc773';ctx.strokeStyle='#ffc773';
      ctx.beginPath();ctx.arc(SIZE/2+dx*factor,SIZE/2+dz*factor,5,0,Math.PI*2);ctx.fill();
      if(expanded)destinations.forEach((d,i)=>{
        const dx=(d.x-center.x)*SCALE,dz=(d.z-center.z)*SCALE;
        const f=Math.min(1,(SIZE/2-20)/Math.max(Math.abs(dx),Math.abs(dz),1));
        const x=SIZE/2+dx*f,y=SIZE/2+dz*f;
        ctx.fillStyle=i===navigation.selected?'#ffc773':'#9dbccb';
        ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#071523';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(String(i+1),x,y+4);ctx.textAlign='start';
      });
      ctx.fillStyle='#9dbccb';ctx.font='10px system-ui';ctx.fillText('N',8,14);
      // Player dot
      const px = SIZE / 2 + (car.x-center.x)*SCALE;
      const py = SIZE / 2 + (car.z-center.z)*SCALE;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI-car.yaw);

      // Arrow shape
      ctx.fillStyle = '#8ffff3';
      ctx.shadowColor = '#49f8ed';ctx.shadowBlur=6;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [size,scale,expanded,selected,buildings,river]);

  function pickOnMap(e){
    if(!expanded){setExpanded(true);return;}
    const rect=e.currentTarget.getBoundingClientRect();
    const x=(e.clientX-rect.left)*size/rect.width,y=(e.clientY-rect.top)*size/rect.height;
    let best=-1,dist=22;
    destinations.forEach((d,i)=>{const dx=d.x*scale,dz=d.z*scale,f=Math.min(1,(size/2-20)/Math.max(Math.abs(dx),Math.abs(dz),1));const n=Math.hypot(x-size/2-dx*f,y-size/2-dz*f);if(n<dist){best=i;dist=n;}});
    if(best>=0)choose(best);
  }
  return <section className={`city-map ${expanded?'expanded':''}`} aria-label={expanded?'City map and destination selection':'Minimap'}>
    {expanded&&<header><div><strong>HACK STASH</strong><span>San Antonio · Live pursuit map</span></div><button ref={closeRef} type="button" onClick={close} aria-label="Close city map">Close · Esc</button></header>}
    <button ref={triggerRef} className="map-canvas-button" type="button" onClick={pickOnMap} aria-expanded={expanded} aria-label={expanded?'Select a numbered destination on the map':'Expand map and choose destination'}>
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
    />
    </button>
    {expanded?<footer><div className="map-destinations">{destinations.map((d,i)=><button type="button" key={d.key} aria-pressed={selected===i} onClick={()=>choose(i)}><span>{i+1}</span>{d.name}</button>)}</div><p>Mint: route · Amber: destination · Red / blue: police</p><p>Live map — driving and pursuit continue.</p></footer>:<span className="map-expand-hint">MAP ↗</span>}
  </section>;
}
