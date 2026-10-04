import { useEffect, useRef } from 'react';

let ctx;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function tone(freq, duration, type = 'sine', gain = 0.15) {
  try {
    const c = audioCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g).connect(c.destination);
    const now = c.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // AudioContext unavailable (autoplay policy before a user gesture, test env, ...) - skip the sound.
  }
}

// One tone per joystick direction, so the sequence has a distinct sound even
// though the hacker never sees the word itself as a dedicated UI element.
const DIRECTION_TONES = { UP: 880, RIGHT: 660, DOWN: 440, LEFT: 550 };
const playDirection = (word) => DIRECTION_TONES[word] && tone(DIRECTION_TONES[word], 0.18, 'sine', 0.1);
const playBuzz = () => tone(140, 0.35, 'sawtooth', 0.12);
const playFanfare = () => {
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 110));
};

/**
 * Soft tone per direction while a sequence plays, buzz on a wrong move/code
 * or the camera being spotted, fanfare once on completion. Compares each
 * snapshot against the previous one; plays nothing on the first render.
 */
export default function useAlamoSound(snapshot) {
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = snapshot;
    if (!prev || !snapshot) return;

    if (snapshot.substage === 'ALAMO_SHOW') {
      const word = snapshot.currentLcdText?.[1];
      if (word && word !== prev.currentLcdText?.[1]) playDirection(word);
    }
    if (snapshot.mistakes > prev.mistakes) playBuzz();
    else if (prev.lightSensorCovered && !snapshot.lightSensorCovered) playBuzz();
    if (snapshot.substage === 'ALAMO_DONE' && prev.substage !== 'ALAMO_DONE') playFanfare();
  }, [snapshot]);
}
