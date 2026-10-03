import { createGearGesture, updateGearGesture } from './gestures.js';
const gearGesture=createGearGesture();
let gearReset=-1;
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HAND_CONFIG } from '../config/handConfig.js';
import { input } from './input.js';
import { palmCenter, mirrorPalm, assignHands, wheelAngle, resetHandIdentity } from './hands.js';
import { OneEuroFilter } from './OneEuroFilter.js';

let handLandmarker = null;
let video = null;
let running = false;
let steerFilter = null;

// Calibration state
let calibrating = false;
let calibrationSamples = [];
let onCalibrationDone = null;

// Lost-hand smoothing
let handsLostAt = null;
let lastValidSteer = 0;

// FPS tracking
let inferenceCount = 0;
let lastFpsTime = performance.now();

export async function initHandTracker(videoElement) {
  video = videoElement;

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: HAND_CONFIG.detectionConfidence,
    minHandPresenceConfidence: HAND_CONFIG.presenceConfidence,
    minTrackingConfidence: HAND_CONFIG.trackingConfidence,
  });

  steerFilter = new OneEuroFilter(
    30, // initial freq estimate
    HAND_CONFIG.oneEuro.minCutoff,
    HAND_CONFIG.oneEuro.beta,
    HAND_CONFIG.oneEuro.dCutoff
  );

  return handLandmarker;
}

export function startTracking() {
  if (running) return;
  running = true;
  trackLoop();
}

export function stopTracking() {
  running = false;
}

function trackLoop() {
  if (!running || !handLandmarker || !video || video.readyState < 2) {
    if (running) requestAnimationFrame(trackLoop);
    return;
  }

  const now = performance.now();

  // Run MediaPipe inference
  const t0 = performance.now();
  const results = handLandmarker.detectForVideo(video, now);
  const t1 = performance.now();

  input.inferenceMs = t1 - t0;

  // FPS tracking
  inferenceCount++;
  if (now - lastFpsTime >= 1000) {
    input.inferenceFps = inferenceCount * 1000 / (now - lastFpsTime);
    inferenceCount = 0;
    lastFpsTime = now;
  }

  processResults(results, now);

  requestAnimationFrame(trackLoop);
}

function processResults(results, timestamp) {
  if(gearReset!==input.gearReset){Object.assign(gearGesture,createGearGesture());gearReset=input.gearReset;}
  const landmarks = results.landmarks;

  if (!landmarks || landmarks.length < 2) {
    updateGearGesture(gearGesture,null,timestamp);
    // Hands lost
    input.handsVisible = false;
    input.leftPalm = null;
    input.rightPalm = null;

    if (handsLostAt === null) {
      handsLostAt = timestamp;
    }

    const lostDuration = timestamp - handsLostAt;

    if (input.mode === 'hands') {
      input.gas=0;input.brake=.6;
      if (lostDuration < HAND_CONFIG.lostHandCenterMs) {
        // Smooth toward center
        lastValidSteer *= 0.92;
        input.steer = lastValidSteer;
      } else if (lostDuration < HAND_CONFIG.lostHandPauseMs) {
        // Continue centering
        lastValidSteer *= 0.95;
        input.steer = lastValidSteer;
        input.gas = Math.max(0, input.gas - 0.02);
      } else {
        // Pause — hands gone too long
        input.steer = 0;
        input.gas = 0;
        input.brake = 0.3;
      }
    }
    return;
  }

  if(!calibrating && input.mode==='hands') {
    input.reverse=updateGearGesture(gearGesture,results.worldLandmarks?.length===2?results.worldLandmarks:landmarks,timestamp);
  }
  // Calculate mirrored palm centers
  const palms = landmarks.map(hand => mirrorPalm(palmCenter(hand)));

  const assigned = assignHands(palms);
  if (!assigned) return;

  const { left, right } = assigned;
  input.leftPalm = left;
  input.rightPalm = right;
  input.handsVisible = true;
  handsLostAt = null;

  // Check palm separation
  const separation = Math.abs(right.x - left.x);
  if (separation < HAND_CONFIG.minPalmSeparation) return;

  // Calculate raw angle
  const rawAngle = wheelAngle(left, right);
  input.rawAngle = rawAngle;

  // Calibration mode
  if (calibrating) {
    calibrationSamples.push(rawAngle);
    if (calibrationSamples.length >= HAND_CONFIG.calibrationSamples) {
      finishCalibration();
    }
    return;
  }

  // Apply calibration offset
  const calibrated = rawAngle - input.zeroAngle;

  // One Euro Filter
  const filtered = steerFilter.filter(calibrated, timestamp);
  input.filteredAngle = filtered;

  // Deadzone
  let angle = filtered;
  if (Math.abs(angle) < HAND_CONFIG.deadzone) {
    angle = 0;
  } else {
    angle = angle - Math.sign(angle) * HAND_CONFIG.deadzone;
  }

  // Normalize to -1..1
  const maxAngle = HAND_CONFIG.maxWheelAngle - HAND_CONFIG.deadzone;
  const normalized = Math.max(-1, Math.min(1, angle / maxAngle));

  if (input.mode === 'hands') input.steer = normalized;
  lastValidSteer = normalized;

  // In hands mode, default to some gas (player steers, auto-drive light)
  if (input.mode === 'hands') {
    input.gas = input.reverse ? 0.4 : 0.75;
    input.brake = 0;
  }
}

export function startCalibration() {
  return new Promise((resolve) => {
    calibrating = true;
    Object.assign(gearGesture,createGearGesture());input.reverse=false;
    calibrationSamples = [];
    onCalibrationDone = resolve;
    steerFilter?.reset();
    resetHandIdentity();
  });
}

function finishCalibration() {
  calibrating = false;
  // Median
  calibrationSamples.sort((a, b) => a - b);
  const median = calibrationSamples[Math.floor(calibrationSamples.length / 2)];
  input.zeroAngle = median;
  steerFilter?.reset();

  if (onCalibrationDone) {
    onCalibrationDone(median);
    onCalibrationDone = null;
  }
}

export function isCalibrating() {
  return calibrating;
}

export function getCalibrationProgress() {
  if (!calibrating) return 1;
  return calibrationSamples.length / HAND_CONFIG.calibrationSamples;
}
