export const HAND_CONFIG = {
  detectionConfidence: 0.55,
  presenceConfidence: 0.55,
  trackingConfidence: 0.60,

  maxWheelAngle: 55,   // degrees for full steering lock
  deadzone: 4.5,       // degrees — absorbs typical MediaPipe jitter

  minPalmSeparation: 0.10, // normalized webcam coords

  // One Euro Filter parameters
  oneEuro: {
    minCutoff: 0.4,
    beta: 0.007,
    dCutoff: 1.0,
  },

  // Calibration
  calibrationSamples: 50,

  // Lost hand behavior
  lostHandCenterMs: 300,
  lostHandPauseMs: 3000,
};
