/**
 * Palm center calculation and hand identity tracking.
 */

const PALM_IDS = [0, 5, 9, 13, 17];

/** Calculate stable palm center from 5 landmarks */
export function palmCenter(landmarks) {
  let x = 0, y = 0;
  for (let i = 0; i < PALM_IDS.length; i++) {
    x += landmarks[PALM_IDS[i]].x;
    y += landmarks[PALM_IDS[i]].y;
  }
  return { x: x / PALM_IDS.length, y: y / PALM_IDS.length };
}

/** Mirror X coordinate (webcam mirror) */
export function mirrorPalm(palm) {
  return { x: 1 - palm.x, y: palm.y };
}

/**
 * Euclidean distance between two palm positions.
 */
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Maintain stable left/right hand identity across frames.
 *
 * On first detection: assign by mirrored X position.
 * On subsequent frames: assign by proximity to previous positions.
 */
let prevLeft = null;
let prevRight = null;
let lostFrames = 0;
const RESET_THRESHOLD = 30; // frames without 2 hands → reset identity

export function assignHands(palms) {
  // palms: array of { x, y } in mirrored coordinates
  if (palms.length < 2) {
    lostFrames++;
    if (lostFrames > RESET_THRESHOLD) {
      prevLeft = null;
      prevRight = null;
    }
    return null;
  }

  lostFrames = 0;

  let left, right;

  if (prevLeft === null || prevRight === null) {
    // Initial assignment: smaller mirrored X = left
    if (palms[0].x <= palms[1].x) {
      left = palms[0];
      right = palms[1];
    } else {
      left = palms[1];
      right = palms[0];
    }
  } else {
    // Proximity-based assignment
    const d00 = dist(palms[0], prevLeft);
    const d01 = dist(palms[1], prevLeft);

    if (d00 <= d01) {
      left = palms[0];
      right = palms[1];
    } else {
      left = palms[1];
      right = palms[0];
    }
  }

  prevLeft = left;
  prevRight = right;

  return { left, right };
}

export function resetHandIdentity() {
  prevLeft = null;
  prevRight = null;
  lostFrames = 0;
}

/**
 * Compute wheel angle from left/right palm positions.
 * Returns degrees. 0 = level. Positive = right turn.
 */
export function wheelAngle(left, right) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}
