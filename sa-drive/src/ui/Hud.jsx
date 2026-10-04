import { useEffect, useRef } from 'react';
import { car } from '../car/state.js';
import { game } from '../game/runtime.js';
import { input } from '../input/input.js';

const dialPoint=(angle,r)=>[100+Math.sin(angle*Math.PI/180)*r,94-Math.cos(angle*Math.PI/180)*r];
const ticks=Array.from({length:21},(_,i)=>{const angle=-130+i*13;return {a:dialPoint(angle,i%4===0?65:70),b:dialPoint(angle,77),label:dialPoint(angle,53),speed:i*5};});

export default function Hud() {
  const speedRef = useRef();
  const needleRef=useRef(),gearRef=useRef(),meterRef=useRef();
  const distRef = useRef();
  const modeRef = useRef();


  useEffect(() => {
    let raf;
    function update() {
      const speed = Math.abs(car.v) * 2.2369362921;
      const mph = speed.toFixed(0);
      const miles = (game.distance / 1609.344).toFixed(2);

      if (speedRef.current) speedRef.current.textContent = mph.padStart(2,'0');
      if(needleRef.current)needleRef.current.setAttribute('transform',`rotate(${-130+Math.min(speed/100,1)*260} 100 94)`);
      if(gearRef.current)gearRef.current.textContent=car.v<-.1?'R':car.v>.1?'D':input.reverse?'R':'N';
      if(meterRef.current){meterRef.current.setAttribute('aria-valuenow',String(Math.min(100,Math.round(speed))));meterRef.current.setAttribute('aria-valuetext',`${mph} miles per hour${car.v<-.1?' in reverse':''}`);}
      if (distRef.current) distRef.current.textContent = `${miles} mi`;
      if (modeRef.current) {
        const modeText = input.mode === 'hands'
          ? (input.handsVisible ? 'HANDS \u25CF' : 'HANDS \u25CB')
          : 'KEYBOARD';
        modeRef.current.textContent = modeText;
      }

      raf = requestAnimationFrame(update);
    }
    update();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      padding: '16px 24px',
      pointerEvents: 'none',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      fontSize: '18px',
      zIndex: 10,
    }}>
      <span ref={distRef}>0.00 mi</span>
      <span ref={modeRef}>KEYBOARD</span>
      <div className="noir-speedometer" ref={meterRef} role="meter" aria-label="Vehicle speed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="0 miles per hour">
        <div className="speedometer-heading">HACK STASH <span>VELOCITY</span></div>
        <svg viewBox="0 0 200 160" aria-hidden="true">
          <path d="M41 143 A77 77 0 1 1 159 143" fill="none" stroke="#526067" strokeWidth="1"/>
          {ticks.map(t=><g key={t.speed}><line x1={t.a[0]} y1={t.a[1]} x2={t.b[0]} y2={t.b[1]} stroke={t.speed>=80?'#b9695b':'#ded8c9'} strokeWidth={t.speed%20===0?2:1}/>{t.speed%20===0&&<text x={t.label[0]} y={t.label[1]} textAnchor="middle" dominantBaseline="central">{t.speed}</text>}</g>)}
          <g ref={needleRef} transform="rotate(-130 100 94)"><path d="M98 104 100 29 102 104Z" fill="#c97d69"/></g>
          <circle cx="100" cy="94" r="5" fill="#ded8c9" stroke="#10171c" strokeWidth="2"/>
          <text className="speedometer-value" ref={speedRef} x="100" y="134" textAnchor="middle">00</text>
          <text x="100" y="151" textAnchor="middle" className="speedometer-unit">MPH</text>
          <text ref={gearRef} x="163" y="148" className="speedometer-gear">N</text>
        </svg>
      </div>
    </div>
  );
}
