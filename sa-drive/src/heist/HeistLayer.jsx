import { useEffect } from 'react';
import { car } from '../car/state.js';
import { game } from '../game/runtime.js';
import { connectHeist, disconnectHeist, getHeist, openRiverwalk, openAlamo, openTower, resetHeistRun, useHeist } from '../game/heist.js';
import {
  ALAMO_EXIT_RADIUS, ALAMO_POINT, ALAMO_TRIGGER_RADIUS, HEIST_DEV_TOOLS, MAX_WANTED_LEVEL,
  RIVERWALK_EXIT_RADIUS, RIVERWALK_POINT, RIVERWALK_TRIGGER_RADIUS,
  TOWER_EXIT_RADIUS, TOWER_POINT, TOWER_TRIGGER_RADIUS,
} from '../config/heistConfig.js';
import RiverwalkChallenge from './RiverwalkChallenge.jsx';
import AlamoChallenge from './AlamoChallenge.jsx';
import TowerChallenge from './TowerChallenge.jsx';
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
// Also starts a fresh heist whenever the game restarts (R / "restart" after being
// caught), so the vault can be robbed again on the next run.
function useRiverwalkTrigger() {
  useEffect(() => {
    let inside = false;
    let epoch = game.epoch;
    const id = setInterval(() => {
      if (game.epoch !== epoch) {
        // epoch 0 -> 1 is the initial map load, not a restart.
        if (epoch > 0) resetHeistRun();
        epoch = game.epoch;
        inside = false;
      }
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

// Same arrive/leave pattern as the Riverwalk, for Challenge 1 at the Alamo.
function useAlamoTrigger() {
  useEffect(() => {
    let inside = false;
    const id = setInterval(() => {
      const d = Math.hypot(car.x - ALAMO_POINT.x, car.z - ALAMO_POINT.z);
      const wasInside = inside;
      inside = d < (inside ? ALAMO_EXIT_RADIUS : ALAMO_TRIGGER_RADIUS);
      if (inside && !wasInside && game.started && !game.caught && !getHeist().alamoCleared) {
        openAlamo('arrived');
      }
    }, 200);
    return () => clearInterval(id);
  }, []);
}

// Same arrive/leave pattern again, for Challenge 3 at the Tower of the Americas.
function useTowerTrigger() {
  useEffect(() => {
    let inside = false;
    const id = setInterval(() => {
      const d = Math.hypot(car.x - TOWER_POINT.x, car.z - TOWER_POINT.z);
      const wasInside = inside;
      inside = d < (inside ? TOWER_EXIT_RADIUS : TOWER_TRIGGER_RADIUS);
      if (inside && !wasInside && game.started && !game.caught && !getHeist().towerCleared) {
        openTower('arrived');
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
  useAlamoTrigger();
  useTowerTrigger();

  return (
    <>
      <HeistHud cash={heist.cash} wantedLevel={heist.wantedLevel} connected={heist.connected} />
      {/* Testing shortcuts: only in `npm run dev` (or VITE_HEIST_DEV_TOOLS=true), never for players. */}
      {HEIST_DEV_TOOLS && !heist.riverwalkOpen && !heist.alamoOpen && !heist.towerOpen && (
        <button className="heist-dev-skip" onClick={() => openRiverwalk('dev')}>
          DEV: Skip to Riverwalk Challenge
        </button>
      )}
      {HEIST_DEV_TOOLS && !heist.alamoOpen && !heist.riverwalkOpen && !heist.towerOpen && (
        <button className="heist-dev-skip" style={{ top: 140 }} onClick={() => openAlamo('dev')}>
          DEV: Skip to Alamo Challenge
        </button>
      )}
      {HEIST_DEV_TOOLS && !heist.towerOpen && !heist.riverwalkOpen && !heist.alamoOpen && (
        <button className="heist-dev-skip" style={{ top: 176 }} onClick={() => openTower('dev')}>
          DEV: Skip to Tower Challenge
        </button>
      )}
      {heist.riverwalkOpen && <RiverwalkChallenge videoRef={videoRef} />}
      {heist.alamoOpen && <AlamoChallenge />}
      {heist.towerOpen && <TowerChallenge />}
    </>
  );
}
