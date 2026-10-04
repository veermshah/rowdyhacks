import { useEffect, useRef, useState } from 'react';
import {
  closeAlamo, alamoRequestHint, alamoSubmitCode, alamoAdminSkip, alamoAdminReset,
  alamoAdminShowSequence, alamoAdminShowCode, alamoSimInput, useHeist,
} from '../game/heist.js';
import { HEIST_DEV_TOOLS } from '../config/heistConfig.js';
import useAlamoSound from './useAlamoSound.js';

// Mirrors server/alamo_config.py BLIND_BELOW - just where the status bar
// draws the threshold marker, the server owns the actual gameplay check.
const LIGHT_BLIND_THRESHOLD = 100;
const LIGHT_MAX = 1023;
const KEY_TO_MOVE = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Renders `**bold**` spans from the config's fact text - no markdown library needed. */
function Bold({ text }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>))}
    </>
  );
}

function Archive({ archive }) {
  if (!archive) return null;
  return (
    <div className="al-archive">
      <div className="al-archive-head">
        <span className="al-archive-kicker">The Alamo Archive</span>
        <h3>{archive.title}</h3>
      </div>
      <ul className="al-archive-facts">
        {archive.facts.map((f, i) => <li key={i}><Bold text={f} /></li>)}
      </ul>
      <div className="al-archive-divider" />
      <ul className="al-archive-facts al-archive-distractors">
        {archive.distractors.map((f, i) => <li key={i}><Bold text={f} /></li>)}
      </ul>
    </div>
  );
}

function CodeEntry({ locked, codeLength = 4, onSubmit }) {
  const [digits, setDigits] = useState('');
  const [shake, setShake] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (locked) setDigits('');
  }, [locked]);

  const submit = async (value) => {
    if (value.length !== codeLength) return;
    const res = await onSubmit(value);
    if (res?.correct) {
      setDigits('');
    } else {
      setShake(true);
      setDigits('');
      setTimeout(() => setShake(false), 500);
    }
  };

  const press = (d) => {
    if (locked) return;
    const next = (digits + d).slice(0, codeLength);
    setDigits(next);
    if (next.length === codeLength) submit(next);
  };
  const backspace = () => !locked && setDigits((d) => d.slice(0, -1));

  useEffect(() => {
    const onKey = (e) => {
      if (locked) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); backspace(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(digits); }
    };
    const el = wrapRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, locked]);

  return (
    <div ref={wrapRef} className={`al-code-entry ${locked ? 'locked' : ''}`} tabIndex={locked ? -1 : 0}>
      <div className={`al-code-boxes ${shake ? 'shake' : ''}`}>
        {Array.from({ length: codeLength }, (_, i) => (
          <span key={i} className="al-code-box">{digits[i] ?? ''}</span>
        ))}
      </div>
      <div className="al-keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '<-'].map((k, i) => (
          k === '' ? <span key={i} /> : (
            <button
              key={i}
              className="al-key"
              disabled={locked}
              onClick={() => (k === '<-' ? backspace() : press(k))}
            >
              {k}
            </button>
          )
        ))}
      </div>
      {locked && <p className="al-code-locked-hint">Locked until the vault reveals the code pieces.</p>}
    </div>
  );
}

export default function AlamoChallenge() {
  const heist = useHeist();
  const closeRef = useRef(null);
  const [revealedSequence, setRevealedSequence] = useState(null); // null (hidden) | string[]
  const [revealedCode, setRevealedCode] = useState(null);
  const [lightSim, setLightSim] = useState(600);

  const a = heist.alamo;
  const substage = a?.substage ?? 'ALAMO_IDLE';
  const done = substage === 'ALAMO_DONE';
  const codeUnlocked = substage === 'ALAMO_CODE';

  useAlamoSound(a);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeAlamo(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dev simulator: arrow keys stand in for the Pi's joystick while this
  // dashboard is focused. Stopped from propagating so they never also steer.
  useEffect(() => {
    if (!HEIST_DEV_TOOLS) return undefined;
    const onKey = (e) => {
      const move = KEY_TO_MOVE[e.key];
      if (!move) return;
      e.preventDefault();
      e.stopPropagation();
      alamoSimInput('joystick', move);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleShowSequence = async () => {
    if (revealedSequence) { setRevealedSequence(null); return; }
    setRevealedSequence(await alamoAdminShowSequence(true) || []);
  };
  const toggleShowCode = async () => {
    if (revealedCode) { setRevealedCode(null); return; }
    setRevealedCode(await alamoAdminShowCode(true) || '????');
  };

  const lightValue = a?.lightValue ?? 0;
  const lightPct = Math.min(100, Math.max(0, (lightValue / LIGHT_MAX) * 100));
  const thresholdPct = (LIGHT_BLIND_THRESHOLD / LIGHT_MAX) * 100;

  return (
    <div className="rw-backdrop">
      <div
        className="rw-modal al-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="al-title"
        onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
      >
        <header className="rw-head">
          <div>
            <div className="rw-eyebrow">CHALLENGE 1 &middot; THE ALAMO</div>
            <h2 id="al-title">Crack the Vault</h2>
          </div>
          <button ref={closeRef} className="rw-close" onClick={closeAlamo} aria-label="Close challenge">&times;</button>
        </header>

        <blockquote className="rw-clue al-briefing">
          <span className="rw-clue-label">BRIEFING</span>
          &ldquo;{a?.briefing
            || 'A hidden vault in the Alamo is guarded by a security camera. Your safecracker must keep it blinded while repeating the unlock pattern.'}&rdquo;
        </blockquote>

        {!heist.connected && (
          <p className="rw-banner">
            Heist server offline. Start it with <code>python app.py</code> in <code>/server</code>.
          </p>
        )}

        <div className="rw-body">
          <section className="al-main">
            <Archive archive={a?.archive} />
            <CodeEntry locked={!codeUnlocked} codeLength={a?.codeLength ?? 4} onSubmit={alamoSubmitCode} />
            {done && (
              <div className="al-done-banner">
                <strong>VAULT OPEN</strong>
                <p>The Alamo code is cracked - back to the road.</p>
              </div>
            )}
          </section>

          <aside className="rw-side">
            <div className={`al-sensor-pill ${a?.lightSensorCovered ? 'covered' : ''}`}>
              CAMERA {a?.lightSensorCovered ? 'BLIND' : 'ACTIVE'}
            </div>
            <div className="al-light-bar" aria-label={`Light reading ${lightValue} of ${LIGHT_MAX}`}>
              <div className="al-light-bar-fill" style={{ width: `${lightPct}%` }} />
              <div className="al-light-bar-threshold" style={{ left: `${thresholdPct}%` }} />
            </div>

            <div className="al-round-row">
              <span>Round {a?.round || 0}/3</span>
            </div>
            <div className="al-progress-dots" aria-label={`Progress ${a?.progress ?? 0} of ${a?.sequenceLength ?? 0}`}>
              {Array.from({ length: a?.sequenceLength || 0 }, (_, i) => (
                <span key={i} className={`al-dot ${i < (a?.progress ?? 0) ? 'done' : ''}`} />
              ))}
            </div>

            <div className="rw-attempts">Mistakes: {a?.mistakes ?? 0} &nbsp;&middot;&nbsp; Heat: {a?.heat ?? 0}</div>

            <div className="al-lcd-preview">
              <div className="al-lcd-label">VAULT LCD</div>
              <div className="al-lcd-line">{a?.currentLcdText?.[0] ?? ''}</div>
              <div className="al-lcd-line">{a?.currentLcdText?.[1] ?? ''}</div>
            </div>

            {!!a?.hintsScreen?.length && (
              <div className="al-hints">
                <h3>Hints</h3>
                <ul>
                  {a.hintsScreen.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            {!done && (
              <button className="rw-btn rw-btn-wide" onClick={alamoRequestHint} disabled={!heist.connected}>
                Request hint (+1 heat)
              </button>
            )}
            {done && <button className="rw-btn rw-btn-wide" onClick={closeAlamo}>Back to the road</button>}

            {HEIST_DEV_TOOLS && (
              <div className="rw-dev">
                <h3>DEV simulation</h3>
                <p className="rw-muted">Stands in for the Pi: arrow keys = joystick, slider = light sensor.</p>
                <label className="al-dev-light">
                  <input
                    type="range"
                    min={0}
                    max={LIGHT_MAX}
                    value={lightSim}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLightSim(v);
                      alamoSimInput('light', v);
                    }}
                  />
                  <span>{lightSim}</span>
                </label>
                <div className="rw-dev-grid">
                  <button className="rw-dev-btn" onClick={alamoAdminSkip} disabled={!heist.connected}>Skip to done</button>
                  <button className="rw-dev-btn" onClick={alamoAdminReset} disabled={!heist.connected}>Reset run</button>
                </div>
                <button className="rw-link" onClick={toggleShowSequence}>
                  {revealedSequence ? 'Hide' : 'Show'} sequence
                </button>
                {revealedSequence && (
                  <p className="rw-muted al-reveal-text">
                    {revealedSequence.length ? revealedSequence.join(' -> ') : '(not playing right now)'}
                  </p>
                )}
                <button className="rw-link" onClick={toggleShowCode}>
                  {revealedCode ? 'Hide' : 'Show'} code
                </button>
                {revealedCode && <p className="rw-muted al-reveal-text">{revealedCode}</p>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
