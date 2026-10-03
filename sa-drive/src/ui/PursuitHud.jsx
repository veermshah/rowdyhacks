import { useEffect,useState } from 'react';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { game,restartGame } from '../game/runtime.js';
export default function PursuitHud(){
  const [state,setState]=useState({caught:false,reverse:false,gap:80,distance:0});
  useEffect(()=>{
    const key=e=>{if(e.code==='KeyR'&&!e.repeat){restartGame();}};
    window.addEventListener('keydown',key);
    const timer=setInterval(()=>setState({caught:game.caught,reverse:input.reverse||car.v<-.1,gap:game.police?Math.round(Math.hypot(car.x-game.police.x,car.z-game.police.z)):0,distance:game.distance}),100);
    return()=>{clearInterval(timer);window.removeEventListener('keydown',key);};
  },[]);
  return <>
    <div className="pursuit-status"><span className="police-dot"/> POLICE <strong>{state.gap} m</strong>{state.reverse&&<span className="reverse-badge">R / REVERSE</span>}</div>
    <div className="drive-hint">Open both hands to reverse / X on keyboard</div>
    {state.caught&&<div className="caught-overlay" role="dialog" aria-modal="true" aria-labelledby="caught-title"><div className="caught-card">
      <div className="nav-eyebrow">SAN ANTONIO / NIGHT DRIVE</div><h1 id="caught-title">CAUGHT</h1><p>The police caught you.</p>
      <p>Distance driven: <strong>{(state.distance/1609.344).toFixed(2)} mi</strong></p>
      <button onClick={restartGame}>Press R to restart</button>
    </div></div>}
  </>;
}
