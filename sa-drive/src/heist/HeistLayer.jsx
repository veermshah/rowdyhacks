import { useEffect } from 'react';
import { car } from '../car/state.js';
import { game } from '../game/runtime.js';
import { connectHeist, disconnectHeist, getHeist, openRiverwalk, useHeist } from '../game/heist.js';
import {
  HEIST_DEV_TOOLS, MAX_WANTED_LEVEL, RIVERWALK_EXIT_RADIUS, RIVERWALK_POINT, RIVERWALK_TRIGGER_RADIUS,
} from '../config/heistConfig.js';
import RiverwalkChallenge from './RiverwalkChallenge.jsx';
import './heist.css';

const money = (n) => `$${(n || 0).toLocaleString()}`;

function HeistHud({ cash, wantedLevel, connected }) {
  return (
    <div className="heist-hud" aria-live="polite">
      <div className="heist-hud-row">
        <span className="heist-hud-label">LOOT</span>
        {/* key restarts the flash animation whenever the amount changes */}
        <strong key={cash} className="heist-cash">{money(cash)}</strong>
        <span className={`heist-conn ${connected ? 'ok' : ''}`} title={connected ? 'Heist server connected' : 'Heist server offline'} />
      </div>
      <div className="heist-hud-row">
        <span className="heist-hud-label">WANTED</span>
        <span key={wantedLevel} className="heist-stars" aria-label={`Wanted level ${wantedLevel} of ${MAX_WANTED_LEVEL}`}>
          {Array.from({ length: MAX_WANTED_LEVEL }, (_, i) => <span key={i} className={i < wantedLevel ? 'on' : ''}>★</span>)}
        </span>
      </div>
    </div>
  );
}

// Opens the Riverwalk popup when the car drives up to the checkpoint. It fires
// once per visit: the car must leave the exit radius before it can trigger again.
function useRiverwalkTrigger() {
  useEffect(() => {
    let inside = false;
    const id = setInterval(() => {
      const d = Math.hypot(car.x - RIVERWALK_POINT.x, car.z - RIVERWALK_POINT.z);
      const wasInside = inside;
      inside = d < (inside ? RIVERWALK_EXIT_RADIUS : RIVERWALK_TRIGGER_RADIUS);
      if (inside && !wasInside && game.started && !game.caught && !getHeist().riverwalkCleared) {
        openRiverwalk('arrived');
      }
    }, 200);
    return () => clearInterval(id);
  }, []);
}

export default function HeistLayer({ videoRef }) {
  const heist = useHeist();

  useEffect(() => {
    connectHeist();
    return disconnectHeist;
  }, []);
  useRiverwalkTrigger();

  return (
    <>
      <HeistHud cash={heist.cash} wantedLevel={heist.wantedLevel} connected={heist.connected} />
      {HEIST_DEV_TOOLS && !heist.riverwalkOpen && (
        <button className="heist-dev-open" onClick={() => openRiverwalk('dev')}>
          DEV: Force Open Riverwalk Challenge
        </button>
      )}
      {heist.riverwalkOpen && <RiverwalkChallenge videoRef={videoRef} />}
    </>
  );
}
