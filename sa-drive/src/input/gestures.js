// Four fingers, independent of screen rotation or thumb pose. World landmarks
// use metric XYZ; normalized XYZ is a fallback when world data is unavailable.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
function straight(a,b,c) {
  const u=[a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)],v=[c.x-b.x,c.y-b.y,(c.z||0)-(b.z||0)];
  const len=Math.hypot(...u)*Math.hypot(...v);
  return len>1e-8 && u.reduce((s,n,i)=>s+n*v[i],0)/len < -.72;
}
export function isOpenHand(points) {
  if(!points || points.length<21)return false;
  let extended=0;
  for(const m of [5,9,13,17]) {
    const [base,pip,dip,tip]=points.slice(m,m+4);
    if(straight(base,pip,dip)&&straight(pip,dip,tip)&&distance(points[0],tip)>distance(points[0],pip)*1.12)extended++;
  }
  return extended>=4;
}

/** Fist: most fingers curled toward palm */
export function isFist(points) {
  if(!points || points.length<21)return false;
  let curled=0;
  for(const m of [5,9,13,17]) {
    const [base,pip,dip,tip]=points.slice(m,m+4);
    if(distance(points[0],tip)<distance(points[0],pip)*1.1 && !straight(base,pip,dip))curled++;
  }
  return curled>=3;
}

// --- Unified gesture state machine ---
// States: 'NORMAL' | 'REVERSE' | 'REAR_VIEW'
// Prevents flickering by requiring sustained detection before committing.

// Activation thresholds (ms)
const ENTER_REVERSE_MS = 280;
const LEAVE_REVERSE_MS = 350; // hysteresis: harder to leave reverse
const ENTER_REAR_MS = 220;
const LEAVE_REAR_MS = 180;
const ENTER_NORMAL_MS = 250;
// Max gap (ms) between inference frames before resetting pending state
const MAX_FRAME_GAP = 200;

export function createGestureState() {
  return {
    committed: 'NORMAL',  // current stable state
    pending: null,         // gesture being evaluated
    pendingSince: 0,       // when pending started
    lastFrame: null,       // timestamp of last inference frame
  };
}

/**
 * Detect which gesture two hands are performing.
 * Returns 'REVERSE' | 'REAR_VIEW' | 'NORMAL' | null (uncertain)
 */
function detectGesture(hands) {
  if (!hands || hands.length !== 2) return null; // uncertain

  const h0open = isOpenHand(hands[0]);
  const h1open = isOpenHand(hands[1]);
  const h0fist = isFist(hands[0]);
  const h1fist = isFist(hands[1]);

  // Both open → reverse
  if (h0open && h1open) return 'REVERSE';

  // One open + one fist → rear view
  if ((h0open && h1fist) || (h0fist && h1open)) return 'REAR_VIEW';

  // Both classified as something definite but not a special gesture → normal
  // If either hand is ambiguous (neither open nor fist), return null (uncertain)
  const h0known = h0open || h0fist;
  const h1known = h1open || h1fist;
  if (h0known && h1known) return 'NORMAL';

  return null; // uncertain — at least one hand in ambiguous state
}

/**
 * Get the required hold time to transition from current state to a new state.
 */
function transitionTime(from, to) {
  if (to === 'REVERSE') return from === 'REVERSE' ? 0 : ENTER_REVERSE_MS;
  if (to === 'REAR_VIEW') return from === 'REAR_VIEW' ? 0 : ENTER_REAR_MS;
  if (to === 'NORMAL') {
    if (from === 'REVERSE') return LEAVE_REVERSE_MS;
    if (from === 'REAR_VIEW') return LEAVE_REAR_MS;
    return 0;
  }
  return ENTER_NORMAL_MS;
}

/**
 * Update the gesture state machine. Call once per inference frame.
 * Returns { reverse: bool, rearView: bool }
 */
export function updateGestureState(state, hands, time) {
  // If too long between frames, reset pending (tracking was interrupted)
  if (state.lastFrame !== null && time - state.lastFrame > MAX_FRAME_GAP) {
    state.pending = null;
  }
  state.lastFrame = time;

  const detected = detectGesture(hands);

  if (detected === null) {
    // Uncertain classification — hold current committed state, don't advance pending.
    // But don't reset pending either — brief noise frames are ignored.
    return stateOutput(state);
  }

  if (detected === state.committed) {
    // Already in this state — clear any pending transition
    state.pending = null;
    return stateOutput(state);
  }

  if (detected !== state.pending) {
    // New pending gesture — start timer
    state.pending = detected;
    state.pendingSince = time;
    return stateOutput(state);
  }

  // Same pending gesture continues — check if held long enough
  const required = transitionTime(state.committed, detected);
  if (time - state.pendingSince >= required) {
    state.committed = detected;
    state.pending = null;
  }

  return stateOutput(state);
}

function stateOutput(state) {
  return {
    reverse: state.committed === 'REVERSE',
    rearView: state.committed === 'REAR_VIEW',
  };
}

export function resetGestureState(state) {
  state.committed = 'NORMAL';
  state.pending = null;
  state.pendingSince = 0;
  state.lastFrame = null;
}

// Keep rearViewActive for PursuitHud polling
export function rearViewActive(state, time) {
  return state.rearView && time - state.rearViewUpdatedAt < 300;
}
