import { useEffect, useRef, useState } from 'react';
import {
  closeRiverwalk, devResetCar, restartChallenge, sendFrame, simulate, submitNfc, useHeist,
} from '../game/heist.js';
import { HEIST_DEV_TOOLS, HEIST_SERVER_URL } from '../config/heistConfig.js';

const CLUE = 'Acknowledge the guard, signal twice, and look pleased.';
const CHECKLIST = [
  { key: 'face', label: 'Face detected' },
  { key: 'nod', label: 'Nod' },
  { key: 'blink', label: 'Two blinks' },
  { key: 'smile', label: 'Smile' },
];
const DEV_ACTIONS = [
  ['face', 'Simulate Face Detect'],
  ['nod', 'Simulate Nod'],
  ['blink', 'Simulate Blink'],
  ['smile', 'Simulate Smile'],
  ['fail', 'Simulate Fail'],
];
const FPS = 15;
const MAX_IN_FLIGHT = 2; // frames awaiting a server ack; extra frames are skipped, not queued
const CAPTURE_W = 320;
const CAPTURE_H = 240;

const money = (n) => `$${(n || 0).toLocaleString()}`;

// Webcam for the face check. Reuses the hand-tracking stream when the driver is
// already using hand controls; otherwise opens (and later releases) its own.
function useChallengeCamera(videoRef, sharedVideoRef) {
  const [camera, setCamera] = useState({ state: 'starting', error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let own = null;
    (async () => {
      setCamera({ state: 'starting', error: null });
      let stream = sharedVideoRef?.current?.srcObject;
      if (!stream?.active) {
        try {
          stream = own = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
            audio: false,
          });
        } catch (err) {
          if (!cancelled) {
            setCamera({ state: 'error', error: err.name === 'NotAllowedError' ? 'Camera permission denied.' : err.message });
          }
          return;
        }
      }
      if (cancelled) {
        own?.getTracks().forEach((t) => t.stop());
        return;
      }
      // Unplugged webcam / revoked permission: frames stop, so the server pauses progress.
      stream.getVideoTracks()[0]?.addEventListener('ended', () =>
        setCamera({ state: 'lost', error: 'Camera disconnected - progress paused.' })
      );
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
      if (!cancelled) setCamera({ state: 'on', error: null });
    })();
    return () => {
      cancelled = true;
      own?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, sharedVideoRef, attempt]);

  return [camera, () => setAttempt((n) => n + 1)];
}

function useFramePump(active, videoRef, canvasRef) {
  useEffect(() => {
    if (!active) return undefined;
    const ctx = canvasRef.current.getContext('2d');
    let inFlight = 0;
    let stopped = false;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || inFlight >= MAX_IN_FLIGHT) return;
      ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
      inFlight += 1;
      canvasRef.current.toBlob(async (blob) => {
        if (!blob || stopped) {
          inFlight -= 1;
          return;
        }
        sendFrame(await blob.arrayBuffer(), () => { inFlight -= 1; });
      }, 'image/jpeg', 0.7);
    }, 1000 / FPS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, videoRef, canvasRef]);
}

function NfcDeposit() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState(null);
  const [scanning, setScanning] = useState(false);
  // Web NFC only exists in Chrome on Android over HTTPS; elsewhere paste the tag text.
  const nfcSupported = 'NDEFReader' in window;

  const deposit = async (payload) => {
    if (!payload.trim()) return;
    setStatus({ text: 'Verifying tag...' });
    const res = await submitNfc(payload.trim());
    setStatus(res.ok ? { ok: true, text: `Deposited ${money(res.amount)} from tag ${res.tagId}` } : { ok: false, text: res.error });
    if (res.ok) setValue('');
  };

  const scan = async () => {
    try {
      const reader = new window.NDEFReader();
      const controller = new AbortController();
      setScanning(true);
      setStatus({ text: 'Hold your phone near the Riverwalk loot tag...' });
      await reader.scan({ signal: controller.signal });
      reader.onreadingerror = () => setStatus({ ok: false, text: 'Could not read tag - try again.' });
      reader.onreading = ({ message }) => {
        const record = message.records.find((r) => r.recordType === 'text');
        if (!record) return setStatus({ ok: false, text: 'Tag has no text record.' });
        controller.abort();
        setScanning(false);
        deposit(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      };
    } catch (err) {
      setScanning(false);
      setStatus({ ok: false, text: `NFC error: ${err.message}` });
    }
  };

  return (
    <div className="rw-nfc">
      <h3>Physical loot (NFC)</h3>
      {nfcSupported && (
        <button className="rw-btn rw-btn-wide" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Scan NFC tag'}
        </button>
      )}
      <form className="rw-nfc-form" onSubmit={(e) => { e.preventDefault(); deposit(value); }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="LOOTRUN|RIVERWALK|TAG01|5000"
          aria-label="NFC tag payload"
        />
        <button className="rw-btn" type="submit">Deposit</button>
      </form>
      {status && <p className={`rw-nfc-status ${status.ok ? 'ok' : status.ok === false ? 'err' : ''}`}>{status.text}</p>}
    </div>
  );
}

export default function RiverwalkChallenge({ videoRef: sharedVideoRef }) {
  const heist = useHeist();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const closeRef = useRef(null);
  const [showSensors, setShowSensors] = useState(false);
  const [camera, retryCamera] = useChallengeCamera(videoRef, sharedVideoRef);

  const ch = heist.challenge;
  const status = ch?.status ?? (heist.riverwalkCleared ? 'complete' : 'idle');
  const running = status === 'active' || status === 'paused';
  useFramePump(camera.state === 'on' && running, videoRef, canvasRef);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeRiverwalk(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const checklist = ch?.checklist ?? { face: false, nod: false, blink: false, smile: false };
  const done = status === 'complete';
  const paused = running && (status === 'paused' || camera.state === 'lost');
  const reward = heist.lastReward?.source === 'riverwalk_vault' ? heist.lastReward : null;

  return (
    <div className="rw-backdrop">
      {/* Stop key events here so typing doesn't steer the car or switch destinations. */}
      <div className="rw-modal" role="dialog" aria-modal="true" aria-labelledby="rw-title" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <header className="rw-head">
          <div>
            <div className="rw-eyebrow">CHALLENGE 2 · RIVERWALK SECURITY CHECKPOINT</div>
            <h2 id="rw-title">Face the Vault</h2>
          </div>
          <button ref={closeRef} className="rw-close" onClick={closeRiverwalk} aria-label="Close challenge">✕</button>
        </header>

        <blockquote className="rw-clue">
          <span className="rw-clue-label">CLUE</span>
          “{CLUE}”
        </blockquote>

        {!heist.connected && (
          <p className="rw-banner">Heist server offline at {HEIST_SERVER_URL}. Start it with <code>python app.py</code> in <code>/server</code>.</p>
        )}

        <div className="rw-body">
          <section className="rw-cam">
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} hidden />

            {camera.state === 'on' && running && (
              <>
                <div className={`rw-face-pill ${ch?.faceVisible ? 'ok' : ''}`}>{ch?.faceVisible ? 'FACE LOCKED' : 'NO FACE'}</div>
                {ch?.timeLeft != null && (
                  <div className="rw-timer"><div style={{ width: `${Math.min(100, (ch.timeLeft / ch.stepTimeout) * 100)}%` }} /></div>
                )}
              </>
            )}
            {(camera.state === 'starting' || camera.state === 'error') && (
              <div className="rw-cam-overlay">
                <p>{camera.state === 'starting' ? 'Starting camera...' : camera.error}</p>
                {camera.state === 'error' && <button className="rw-btn" onClick={retryCamera}>Retry camera</button>}
                {camera.state === 'error' && HEIST_DEV_TOOLS && <p className="rw-muted">Dev buttons still work without a camera.</p>}
              </div>
            )}
            {paused && (
              <div className="rw-cam-overlay rw-paused">
                <strong>TRACKING LOST</strong>
                <p>{camera.error || 'Get back in frame - progress is paused, not failed.'}</p>
                {camera.state === 'lost' && <button className="rw-btn" onClick={retryCamera}>Reconnect camera</button>}
              </div>
            )}
            {status === 'alarm' && (
              <div className="rw-cam-overlay rw-alarm">
                <strong>ALARM TRIPPED</strong>
                <p>{heist.alarm?.reason || 'Too many failed attempts.'} Cops have been alerted - wanted level raised!</p>
              </div>
            )}
            {done && (
              <div className="rw-cam-overlay rw-done">
                <strong>VAULT OPEN</strong>
                {reward ? (
                  <p className="rw-reward">
                    <span>+{money(reward.amount)} Riverwalk loot</span>
                    {reward.amount > 0 && <span className="rw-heat">Wanted level +1 ★</span>}
                  </p>
                ) : (
                  <p>This checkpoint is already cleared.</p>
                )}
              </div>
            )}
          </section>

          <aside className="rw-side">
            <ol className="rw-checklist">
              {CHECKLIST.map(({ key, label }) => {
                const isDone = checklist[key];
                const current = running && ch?.step === key;
                return (
                  <li key={key} className={isDone ? 'done' : current ? 'current' : ''}>
                    <span className="rw-check" aria-hidden="true">{isDone ? '✓' : current ? '▸' : '○'}</span>
                    {label}
                    {key === 'blink' && current && <span className="rw-count">{ch.blinks}/2</span>}
                    <span className="sr-only">{isDone ? ' (done)' : current ? ' (current)' : ''}</span>
                  </li>
                );
              })}
            </ol>

            <div className="rw-attempts">
              Failed attempts
              {Array.from({ length: ch?.maxAttempts ?? 3 }, (_, i) => (
                <span key={i} className={`rw-pip ${i < (ch?.failures ?? 0) ? 'used' : ''}`} />
              ))}
            </div>

            {ch?.message && !done && <p className="rw-message" aria-live="polite">{ch.message}</p>}

            {status === 'alarm' && (
              <div className="rw-actions">
                <button className="rw-btn" onClick={restartChallenge}>Try again</button>
                <button className="rw-btn rw-btn-ghost" onClick={closeRiverwalk}>Escape</button>
              </div>
            )}
            {status === 'idle' && heist.connected && (
              <button className="rw-btn rw-btn-wide" onClick={restartChallenge}>Start checkpoint</button>
            )}
            {done && (
              <>
                <NfcDeposit />
                <button className="rw-btn rw-btn-wide" onClick={closeRiverwalk}>Back to the road</button>
              </>
            )}

            {HEIST_DEV_TOOLS && (
              <div className="rw-dev">
                <h3>DEV simulation</h3>
                <div className="rw-dev-grid">
                  {DEV_ACTIONS.map(([action, label]) => (
                    <button key={action} className={`rw-dev-btn ${action === 'fail' ? 'fail' : ''}`} onClick={() => simulate(action)} disabled={!heist.connected}>
                      {label}
                    </button>
                  ))}
                  <button className="rw-dev-btn" onClick={devResetCar} disabled={!heist.connected}>Reset car loot</button>
                </div>
                <button className="rw-link" onClick={() => setShowSensors((v) => !v)}>
                  {showSensors ? 'Hide' : 'Show'} sensor readout
                </button>
                {showSensors && ch && (
                  <dl className="rw-sensors">
                    <dt>blink</dt><dd>{ch.debug.blink}</dd>
                    <dt>smile</dt><dd>{ch.debug.smile}</dd>
                    <dt>nod Δ</dt><dd>{ch.debug.nodDelta}</dd>
                  </dl>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
