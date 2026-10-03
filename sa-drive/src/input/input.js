/** Shared input state — all control systems write here, car physics only reads */
export const input = {
  rawAngle: 0,
  filteredAngle: 0,

  steer: 0,       // normalized -1..1

  gearReset: 0,
  reverse: false, // gear request, independent of wheel rotation
  gas: 0,          // 0..1
  brake: 0,        // 0..1

  handsVisible: false,

  zeroAngle: 0,    // calibration offset

  mode: 'keyboard', // 'keyboard' | 'hands'

  leftPalm: null,
  rightPalm: null,

  inferenceMs: 0,
  inferenceFps: 0,
};
