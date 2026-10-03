import { useEffect, useState, useRef } from 'react';
import { input } from '../input/input.js';
import { initHandTracker, startTracking, startCalibration, getCalibrationProgress, isCalibrating } from '../input/HandTracker.js';

const STATES = {
  INIT: 'init',
  WAITING_CAMERA: 'waiting_camera',
  LOADING_MODEL: 'loading_model',
  CALIBRATING: 'calibrating',
  READY: 'ready',
  FAILED: 'failed',
  KEYBOARD: 'keyboard',
};

export default function Calibrate({ videoRef, onReady }) {
  const [state, setState] = useState(STATES.INIT);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const rafRef = useRef(null);

  async function startHands() {
    try {
      // Request webcam
      setState(STATES.WAITING_CAMERA);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: false,
      });

      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      // Load MediaPipe model
      setState(STATES.LOADING_MODEL);
      await initHandTracker(video);

      // Start tracking loop
      startTracking();

      // Start calibration
      setState(STATES.CALIBRATING);
      await startCalibration();

      // Done
      input.mode = 'hands';
      setState(STATES.READY);
      setTimeout(() => onReady(), 800);

    } catch (err) {
      console.error('Hand tracking setup failed:', err);
      setError(err.message || 'Unknown error');
      setState(STATES.FAILED);
    }
  }

  function useKeyboard() {
    input.mode = 'keyboard';
    setState(STATES.KEYBOARD);
    onReady();
  }

  // Poll calibration progress
  useEffect(() => {
    if (state !== STATES.CALIBRATING) return;
    function poll() {
      setProgress(getCalibrationProgress());
      if (isCalibrating()) {
        rafRef.current = requestAnimationFrame(poll);
      }
    }
    poll();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [state]);

  if (state === STATES.READY || state === STATES.KEYBOARD) return null;

  const overlay = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    zIndex: 100,
    gap: 16,
  };

  const btn = {
    padding: '12px 28px',
    fontSize: 18,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
  };

  return (
    <div style={overlay}>
      <h1 style={{ fontSize: 42, marginBottom: 8 }}>SA Drive</h1>
      <p style={{ color: '#aaa', fontSize: 16, marginBottom: 24 }}>
        Follow the glowing road route. Stay ahead of the police.
      </p>

      <p style={{fontSize:12,color:'#a9c4d6'}}>Turn your hands like a wheel. Open both hands to reverse; curl fingers to drive forward.</p>
      {state === STATES.INIT && (
        <>
          <button style={{ ...btn, background: '#3b82f6', color: '#fff' }} onClick={startHands}>
            Use Hand Steering
          </button>
          <button style={{ ...btn, background: '#444', color: '#ccc' }} onClick={useKeyboard}>
            Use Keyboard (WASD)
          </button>
        </>
      )}

      {state === STATES.WAITING_CAMERA && (
        <p style={{ fontSize: 20 }}>Requesting camera access...</p>
      )}

      {state === STATES.LOADING_MODEL && (
        <p style={{ fontSize: 20 }}>Loading hand tracking model...</p>
      )}

      {state === STATES.CALIBRATING && (
        <>
          <p style={{ fontSize: 22, maxWidth: 500, textAlign: 'center', lineHeight: 1.5 }}>
            Hold your hands naturally like a steering wheel
          </p>
          <div style={{
            width: 300, height: 12, background: '#333', borderRadius: 6, overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress * 100}%`, height: '100%', background: '#3b82f6',
              transition: 'width 0.1s',
            }} />
          </div>
          <p style={{ color: '#888', fontSize: 14 }}>
            {(progress * 100).toFixed(0)}% — keep hands steady
          </p>
        </>
      )}

      {state === STATES.FAILED && (
        <>
          <p style={{ color: '#f66', fontSize: 18 }}>
            Hand tracking failed: {error}
          </p>
          <button style={{ ...btn, background: '#444', color: '#ccc' }} onClick={useKeyboard}>
            Continue with Keyboard
          </button>
        </>
      )}
    </div>
  );
}
