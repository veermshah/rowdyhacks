import { useEffect, useState, useRef } from 'react';
import NoirCity from './NoirCity.jsx';
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

  return (
    <main className="noir-home">
      <header className="noir-masthead"><span className="noir-monogram">HS</span><span>HACK STASH <i>/</i> SAN ANTONIO</span><span className="noir-edition">A getaway after dark.</span></header>
      <div className="noir-home-grid">
        <section className="noir-intro" aria-label="Start your getaway">
          <p className="noir-kicker">THE CITY SLEEPS. YOU DON'T.</p>
          <h1 aria-label="Hack Stash">HACK<br/><span>STASH.</span></h1>
          <p className="noir-deck">Three vaults. One getaway car.<br/>Give the police something to chase.</p>
          <div className="noir-start">
            {state === STATES.INIT && <>
              <p className="noir-section-label">CHOOSE YOUR CONTROLS</p>
              <button className="noir-start-button" onClick={startHands}><span>01</span><strong>Use Hand Steering</strong><b aria-hidden="true">&#8599;</b></button>
              <button className="noir-start-button secondary" onClick={useKeyboard}><span>02</span><strong>Use Keyboard (WASD)</strong><b aria-hidden="true">&#8599;</b></button>
              <p className="noir-camera-note">Hand steering uses your camera. Keyboard needs no setup.</p>
            </>}
            {(state === STATES.WAITING_CAMERA || state === STATES.LOADING_MODEL) && <div className="noir-setup" role="status"><span className="noir-section-label">PREPARING THE GETAWAY</span><p>{state === STATES.WAITING_CAMERA ? 'Allow camera access to use hand steering.' : 'Loading hand tracking...'}</p></div>}
            {state === STATES.CALIBRATING && <div className="noir-setup" role="status"><span className="noir-section-label">CHECK YOUR GRIP</span><p>Hold your hands naturally like a steering wheel.</p><div className="noir-progress" role="progressbar" aria-label="Hand calibration" aria-valuenow={Math.round(progress*100)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress*100}%`}}/></div><small>{Math.round(progress*100)}% &mdash; keep hands steady</small></div>}
            {state === STATES.FAILED && <div className="noir-setup"><p role="alert">Hand tracking failed: {error}</p><button className="noir-start-button" onClick={useKeyboard}>Continue with Keyboard <b aria-hidden="true">&#8599;</b></button></div>}
          </div>
        </section>
        <figure className="noir-art"><NoirCity/><figcaption><span>01 / THE GETAWAY</span><span>Downtown, San Antonio.</span></figcaption></figure>
      </div>
      <footer className="noir-home-footer"><div><span>BEHIND THE WHEEL</span><p>W / S &middot; accelerate / brake &nbsp; A / D &middot; steer &nbsp; X &middot; reverse</p></div><div><span>KEEP YOUR HANDS VISIBLE</span><p>Both open &middot; reverse &nbsp; Open + fist &middot; look behind</p></div><strong>STAY ONE TURN AHEAD.</strong></footer>
    </main>
  );
}
