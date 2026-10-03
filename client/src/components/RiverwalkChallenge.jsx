import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './RiverwalkChallenge.css';

const DEFAULT_SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';
const FPS = 15;
const MAX_IN_FLIGHT = 2; // frames awaiting a server ack; extra frames are skipped, not queued
const CAPTURE_W = 320;
const CAPTURE_H = 240;
const MAX_WANTED = 5;

const CHECKLIST = [
  { key: 'face', label: 'Face detected' },
  { key: 'nod', label: 'Nod' },
  { key: 'blink', label: 'Two blinks' },
  { key: 'smile', label: 'Smile' },
];

const INITIAL_CHALLENGE = {
  status: 'idle',
  step: 'face',
  checklist: { face: false, nod: false, blink: false, smile: false },
  faceVisible: false,
  blinks: 0,
  failures: 0,
  maxAttempts: 3,
  timeLeft: null,
  message: 'Pull up to the Riverwalk checkpoint and press Start.',
  debug: { blink: 0, smile: 0, nodDelta: 0 },
};

const money = (n) => `$${(n || 0).toLocaleString()}`;

export default function RiverwalkChallenge({
  serverUrl = DEFAULT_SERVER,
  carId = 'solo',
  onComplete,
  onWantedLevelChange,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const inFlightRef = useRef(0);
  const statusRef = useRef('idle');

  const [connected, setConnected] = useState(false);
  const [camera, setCamera] = useState({ state: 'off', error: null }); // off | starting | on | lost | error
  const [challenge, setChallenge] = useState(INITIAL_CHALLENGE);
  const [car, setCar] = useState({ loot: 0, wantedLevel: 0, riverwalkCleared: false });
  const [alarm, setAlarm] = useState(null);
  const [toast, setToast] = useState(null);
  const [nfcInput, setNfcInput] = useState('');
  const [nfcStatus, setNfcStatus] = useState(null);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const callbacksRef = useRef({ onComplete, onWantedLevelChange });
  callbacksRef.current = { onComplete, onWantedLevelChange };

  const applySnapshot = useCallback((snap) => {
    if (!snap || snap.error) return;
    statusRef.current = snap.status;
    setChallenge(snap);
  }, []);

  // ---- Socket connection -------------------------------------------------
  useEffect(() => {
    const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_car', { carId, role: 'driver' });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('challenge_state', applySnapshot);
    socket.on('car_state', setCar);
    socket.on('alarm', (data) => {
      setAlarm(data);
      callbacksRef.current.onWantedLevelChange?.(data.wantedLevel);
    });
    socket.on('reward', (data) => {
      setToast(data.source === 'nfc' ? `NFC loot +${money(data.amount)}` : `VAULT OPEN +${money(data.amount)}`);
      setTimeout(() => setToast(null), 3500);
      if (data.source === 'riverwalk_vault') callbacksRef.current.onComplete?.(data.amount);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, carId, applySnapshot]);

  // ---- Camera ------------------------------------------------------------
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera({ state: 'off', error: null });
  }, []);

  const startCamera = useCallback(async () => {
    setCamera({ state: 'starting', error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      // Unplugged webcam / revoked permission: progress pauses server-side because frames stop.
      stream.getVideoTracks()[0].addEventListener('ended', () =>
        setCamera({ state: 'lost', error: 'Camera disconnected - progress paused.' })
      );
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCamera({ state: 'on', error: null });
    } catch (err) {
      setCamera({ state: 'error', error: err.name === 'NotAllowedError' ? 'Camera permission denied.' : err.message });
    }
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // ---- Frame pump --------------------------------------------------------
  useEffect(() => {
    if (camera.state !== 'on') return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const id = setInterval(() => {
      const video = videoRef.current;
      const socket = socketRef.current;
      if (!socket?.connected || !video || video.readyState < 2) return;
      if (inFlightRef.current >= MAX_IN_FLIGHT) return;
      if (statusRef.current === 'alarm' || statusRef.current === 'complete') return;

      ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
      inFlightRef.current += 1;
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            inFlightRef.current -= 1;
            return;
          }
          const buf = await blob.arrayBuffer();
          socket.timeout(3000).emit('frame', buf, (err, snap) => {
            inFlightRef.current = Math.max(0, inFlightRef.current - 1);
            if (!err) applySnapshot(snap);
          });
        },
        'image/jpeg',
        0.7
      );
    }, 1000 / FPS);

    return () => {
      clearInterval(id);
      inFlightRef.current = 0;
    };
  }, [camera.state, applySnapshot]);

  // ---- Actions -----------------------------------------------------------
  const startChallenge = () => {
    setAlarm(null);
    socketRef.current?.emit('start_challenge', applySnapshot);
  };

  const submitNfc = (payload) => {
    if (!payload.trim()) return;
    setNfcStatus({ pending: true, text: 'Verifying tag...' });
    socketRef.current?.timeout(5000).emit('nfc_scan', { payload: payload.trim() }, (err, res) => {
      if (err) setNfcStatus({ ok: false, text: 'Server did not respond.' });
      else if (res.ok) {
        setNfcStatus({ ok: true, text: `Deposited ${money(res.amount)} from tag ${res.tagId}` });
        setNfcInput('');
      } else setNfcStatus({ ok: false, text: res.error });
    });
  };

  // Web NFC is only available in Chrome on Android over HTTPS; elsewhere use the text box.
  const nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;
  const scanNfc = async () => {
    try {
      const reader = new window.NDEFReader();
      const controller = new AbortController();
      setNfcScanning(true);
      setNfcStatus({ pending: true, text: 'Hold your phone near the Riverwalk loot tag...' });
      await reader.scan({ signal: controller.signal });
      reader.onreadingerror = () => setNfcStatus({ ok: false, text: 'Could not read tag - try again.' });
      reader.onreading = ({ message }) => {
        const textRecord = message.records.find((r) => r.recordType === 'text');
        if (!textRecord) {
          setNfcStatus({ ok: false, text: 'Tag has no text record.' });
          return;
        }
        controller.abort();
        setNfcScanning(false);
        submitNfc(new TextDecoder(textRecord.encoding || 'utf-8').decode(textRecord.data));
      };
    } catch (err) {
      setNfcScanning(false);
      setNfcStatus({ ok: false, text: `NFC error: ${err.message}` });
    }
  };

  // ---- Render ------------------------------------------------------------
  const { status, checklist, blinks, failures, maxAttempts, timeLeft, message, faceVisible, debug } = challenge;
  const paused = status === 'paused' || camera.state === 'lost';
  const running = status === 'active' || status === 'paused';

  return (
    <div className={`rw-root ${status === 'alarm' ? 'rw-alarm-bg' : ''}`}>
      <header className="rw-header">
        <div>
          <div className="rw-kicker">Challenge 2 · Riverwalk</div>
          <h1 className="rw-title">Face the Vault</h1>
        </div>
        <div className="rw-hud">
          <div className="rw-hud-item">
            <span className="rw-hud-label">Loot</span>
            <span className="rw-cash">{money(car.loot)}</span>
          </div>
          <div className="rw-hud-item">
            <span className="rw-hud-label">Wanted</span>
            <span className="rw-stars" aria-label={`Wanted level ${car.wantedLevel} of ${MAX_WANTED}`}>
              {Array.from({ length: MAX_WANTED }, (_, i) => (
                <span key={i} className={i < car.wantedLevel ? 'on' : ''}>★</span>
              ))}
            </span>
          </div>
          <span className={`rw-dot ${connected ? 'ok' : ''}`} title={connected ? 'Server connected' : 'Server offline'} />
        </div>
      </header>

      <main className="rw-grid">
        <section className="rw-camera">
          <video ref={videoRef} className="rw-video" muted playsInline />
          <canvas ref={canvasRef} width={CAPTURE_W} height={CAPTURE_H} hidden />

          {camera.state !== 'on' && camera.state !== 'lost' && (
            <div className="rw-overlay rw-center">
              <p>{camera.error || 'Driver camera is off.'}</p>
              <button className="rw-btn" onClick={startCamera} disabled={camera.state === 'starting'}>
                {camera.state === 'starting' ? 'Starting...' : 'Enable camera'}
              </button>
            </div>
          )}

          {camera.state === 'on' && (
            <>
              <div className={`rw-face-pill ${faceVisible ? 'ok' : ''}`}>{faceVisible ? 'FACE LOCKED' : 'NO FACE'}</div>
              {running && timeLeft != null && (
                <div className="rw-timer">
                  <div className="rw-timer-fill" style={{ width: `${Math.min(100, (timeLeft / 15) * 100)}%` }} />
                </div>
              )}
              <div className="rw-prompt">{message}</div>
            </>
          )}

          {paused && (
            <div className="rw-overlay rw-center rw-paused">
              <strong>TRACKING LOST</strong>
              <p>{camera.error || 'Get back in frame - progress is paused, not failed.'}</p>
              {camera.state === 'lost' && <button className="rw-btn" onClick={startCamera}>Reconnect camera</button>}
            </div>
          )}

          {status === 'alarm' && (
            <div className="rw-overlay rw-center rw-alarm">
              <strong>🚨 ALARM TRIPPED 🚨</strong>
              <p>{alarm?.reason || 'Too many failed attempts.'} Wanted level raised - more cops incoming!</p>
              <button className="rw-btn rw-btn-danger" onClick={startChallenge}>Try again</button>
            </div>
          )}

          {status === 'complete' && (
            <div className="rw-overlay rw-center rw-complete">
              <strong>VAULT OPEN</strong>
              <p>Riverwalk cash added to the loot pool. Scan the physical loot tag below for a bonus.</p>
            </div>
          )}

          {toast && <div className="rw-toast">{toast}</div>}
        </section>

        <aside className="rw-panel">
          <h2>Security sequence</h2>
          <ol className="rw-checklist">
            {CHECKLIST.map(({ key, label }) => {
              const done = checklist[key];
              const current = running && challenge.step === key;
              return (
                <li key={key} className={done ? 'done' : current ? 'current' : ''}>
                  <span className="rw-check">{done ? '✓' : current ? '▸' : '○'}</span>
                  {label}
                  {key === 'blink' && current && <span className="rw-sub"> ({blinks}/2)</span>}
                </li>
              );
            })}
          </ol>

          <div className="rw-attempts">
            Attempts:
            {Array.from({ length: maxAttempts }, (_, i) => (
              <span key={i} className={`rw-pip ${i < failures ? 'used' : ''}`} />
            ))}
          </div>

          {!running && status !== 'complete' && status !== 'alarm' && (
            <button className="rw-btn rw-btn-wide" onClick={startChallenge} disabled={!connected || camera.state !== 'on'}>
              Start checkpoint
            </button>
          )}
          {running && <p className="rw-hint">Wrong move or out-of-order action resets the sequence.</p>}

          <div className={`rw-nfc ${car.riverwalkCleared ? '' : 'locked'}`}>
            <h2>Physical loot (NFC)</h2>
            {!car.riverwalkCleared ? (
              <p className="rw-hint">Locked until the vault is open.</p>
            ) : (
              <>
                {nfcSupported && (
                  <button className="rw-btn rw-btn-wide" onClick={scanNfc} disabled={nfcScanning}>
                    {nfcScanning ? 'Scanning...' : '📡 Scan NFC tag'}
                  </button>
                )}
                <form
                  className="rw-nfc-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitNfc(nfcInput);
                  }}
                >
                  <input
                    value={nfcInput}
                    onChange={(e) => setNfcInput(e.target.value)}
                    placeholder="LOOTRUN|RIVERWALK|TAG01|5000"
                    aria-label="NFC tag payload"
                  />
                  <button className="rw-btn" type="submit">Deposit</button>
                </form>
              </>
            )}
            {nfcStatus && (
              <p className={`rw-nfc-status ${nfcStatus.ok ? 'ok' : nfcStatus.pending ? '' : 'err'}`}>{nfcStatus.text}</p>
            )}
          </div>

          <button className="rw-link" onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? 'Hide' : 'Show'} sensor readout
          </button>
          {showDebug && (
            <dl className="rw-debug">
              <dt>blink</dt><dd><meter min="0" max="1" value={debug.blink} /> {debug.blink}</dd>
              <dt>smile</dt><dd><meter min="0" max="1" value={debug.smile} /> {debug.smile}</dd>
              <dt>nod Δ</dt><dd>{debug.nodDelta}</dd>
            </dl>
          )}
        </aside>
      </main>
    </div>
  );
}
