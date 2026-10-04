// Fires the story narration at fixed points in a run and shows the caption:
//   intro           - the drive starts (after Start / Use Keyboard), once per run
//   <stop>-arrive   - the car reaches the Alamo / River Walk / Tower and its popup opens
//   <stop>-done     - that vault gets cleared during play
//   caught / alarm  - the police catch you / a challenge alarm trips
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { car } from '../car/state.js';
import { game } from '../game/runtime.js';
import { getHeist, useHeist } from '../game/heist.js';
import { destinations, navigation } from '../config/navigation.js';
import {
  ALAMO_POINT, ALAMO_TRIGGER_RADIUS, RIVERWALK_POINT, RIVERWALK_TRIGGER_RADIUS, TOWER_POINT, TOWER_TRIGGER_RADIUS,
} from '../config/heistConfig.js';
import { APPROACH_LEAD_M, SHOW_TEXT_WITH_AUDIO } from '../config/storyLines.js';
import { currentNarration, narrate, resetNarration, subscribeNarration } from './narrator.js';

// `dest` is the stop's key in config/navigation.js (the route's current destination).
const STOPS = [
  { key: 'alamo', dest: 'alamo', open: 'alamoOpen', cleared: 'alamoCleared', point: ALAMO_POINT, radius: ALAMO_TRIGGER_RADIUS },
  { key: 'riverwalk', dest: 'riverWalk', open: 'riverwalkOpen', cleared: 'riverwalkCleared', point: RIVERWALK_POINT, radius: RIVERWALK_TRIGGER_RADIUS },
  { key: 'tower', dest: 'towerOfAmericas', open: 'towerOpen', cleared: 'towerCleared', point: TOWER_POINT, radius: TOWER_TRIGGER_RADIUS },
];

export default function StoryNarrator() {
  const heist = useHeist();
  const line = useSyncExternalStore(subscribeNarration, currentNarration);
  const lastCleared = useRef(null);

  // Run-level moments come from the driving game's own state.
  useEffect(() => {
    let epoch = game.epoch;
    let started = false;
    let caught = false;
    const id = setInterval(() => {
      if (game.epoch !== epoch) {
        // epoch 0 -> 1 is the initial map load; later changes are restarts (R / after caught).
        if (epoch > 0) resetNarration();
        epoch = game.epoch;
        started = false;
        caught = false;
      }
      if (game.started && !started) {
        started = true;
        narrate('intro');
      }
      if (game.caught && !caught) narrate('caught', { interrupt: true });
      caught = game.caught;

      // Approaching the stop you're routed to: start its "reach" line a little
      // before the challenge triggers, so it lands as you pull up.
      if (game.started && !game.caught) {
        const destKey = destinations[navigation.selected]?.key;
        const heist = getHeist();
        for (const s of STOPS) {
          if (s.dest !== destKey || heist[s.cleared]) continue;
          if (Math.hypot(car.x - s.point.x, car.z - s.point.z) < s.radius + APPROACH_LEAD_M) narrate(`${s.key}-arrive`);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Fallback: the stop's popup opened without the approach line having played
  // (e.g. a dev skip button). Already-played lines are ignored by narrate().
  const openKey = STOPS.map((s) => (heist[s.open] && !heist[s.cleared] ? 1 : 0)).join('');
  useEffect(() => {
    STOPS.forEach((s, i) => { if (openKey[i] === '1') narrate(`${s.key}-arrive`); });
  }, [openKey]);

  // Clearing a vault during play (not the server's initial sync before the drive starts).
  const clearedKey = STOPS.map((s) => (heist[s.cleared] ? 1 : 0)).join('');
  useEffect(() => {
    const before = lastCleared.current;
    lastCleared.current = clearedKey;
    if (before == null || !game.started) return;
    STOPS.forEach((s, i) => { if (before[i] === '0' && clearedKey[i] === '1') narrate(`${s.key}-done`); });
  }, [clearedKey]);

  useEffect(() => { if (heist.alarm) narrate('alarm'); }, [heist.alarm]);

  if (!line) return null;
  // A playing clip gets just a speaker badge (its words may differ from the script);
  // a missing clip shows the script text instead.
  if (line.hasAudio && !SHOW_TEXT_WITH_AUDIO) {
    return <div className="story-caption story-caption-badge" role="status" aria-label="Handler speaking">🔊 HANDLER</div>;
  }
  return (
    <div className="story-caption" role="status" aria-live="polite">
      <span className="story-caption-who">HANDLER</span>
      {line.text}
    </div>
  );
}
