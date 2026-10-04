import { useEffect, useRef, useState } from 'react';
import {
  closeAlamo, alamoSubmitCode, alamoRepeatKeyword, alamoAdminSkip, alamoAdminReset,
  alamoAdminShowSequence, alamoAdminShowCode, alamoSimInput, useHeist,
} from '../game/heist.js';
import { HEIST_DEV_TOOLS } from '../config/heistConfig.js';
import useAlamoSound from './useAlamoSound.js';

// Mirrors server/alamo_config.py BLIND_BELOW - just where the status bar
// draws the threshold marker, the server owns the actual gameplay check.
const LIGHT_BLIND_THRESHOLD = 100;
const LIGHT_MAX = 1023;
const KEY_TO_MOVE = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function CodeEntry({ locked, keywordLength = 5, onSubmit }) {
  const [keyword, setKeyword] = useState('');
  const [shake, setShake] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (locked) setKeyword('');
  }, [locked]);

  const submit = async (value) => {
    if (value.length !== keywordLength) return;
    const res = await onSubmit(value);
    if (res?.correct) {
      setKeyword('');
    } else {
      setShake(true);
      setKeyword('');
      setTimeout(() => setShake(false), 500);
    }
  };

  const update = (value) => {
    if (locked) return;
    setKeyword(value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, keywordLength));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (locked) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(keyword); }
    };
    const el = wrapRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, locked]);

  return (
    <div ref={wrapRef} className={`al-code-entry ${locked ? 'locked' : ''}`} tabIndex={locked ? -1 : 0}>
      <div className={`al-code-boxes ${shake ? 'shake' : ''}`}>
        {Array.from({ length: keywordLength }, (_, i) => (
          <span key={i} className="al-code-box">{keyword[i] ?? ''}</span>
        ))}
      </div>
      <input
        className="al-keyword-input"
        value={keyword}
        maxLength={keywordLength}
        disabled={locked}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') submit(keyword);
        }}
        placeholder="TYPE THE SPOKEN WORD"
        aria-label="Spoken keyword"
      />
      <button className="rw-btn" disabled={locked || keyword.length !== keywordLength} onClick={() => submit(keyword)}>
        Submit keyword
      </button>
      {locked && <p className="al-code-locked-hint">Locked until the vault speaks the keyword.</p>}
    </div>
  );
}

export default function AlamoChallenge() {
  const heist = useHeist();
  const closeRef = useRef(null);
  const [revealedSequence, setRevealedSequence] = useState(null); // null (hidden) | string[]
  const [revealedCode, setRevealedCode] = useState(null);
  const [lightSim, setLightSim] = useState(600);
  const [repeatStatus, setRepeatStatus] = useState('');

  const a = heist.alamo;
  const substage = a?.substage ?? 'ALAMO_IDLE';
  const done = substage === 'ALAMO_DONE';
  const codeUnlocked = substage === 'ALAMO_CODE';
  const stepText = {
    ALAMO_COVER: 'Step 1: Cover the light sensor.',
    ALAMO_SHOW: 'Step 2: Watch the four-move sequence.',
    ALAMO_INPUT: 'Step 2: Repeat the sequence on the joystick.',
    ALAMO_CODE: 'Step 3: Type the keyword spoken by the vault.',
    ALAMO_DONE: 'Challenge complete.',
  }[substage] || 'Cover the light sensor to begin.';

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
  const repeatKeyword = async () => {
    setRepeatStatus('Requesting repeat...');
    const result = await alamoRepeatKeyword();
    setRepeatStatus(result?.ok ? 'Keyword repeated on vault speaker.' : (result?.error || 'Unable to repeat keyword.'));
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
            <p className="al-step-instruction">{stepText}</p>
            <CodeEntry locked={!codeUnlocked} keywordLength={a?.keywordLength ?? 5} onSubmit={alamoSubmitCode} />
            {codeUnlocked && (
              <div className="al-repeat-keyword">
                <button className="rw-btn" onClick={repeatKeyword}>Repeat keyword on vault speaker</button>
                {repeatStatus && <p role="status">{repeatStatus}</p>}
              </div>
            )}
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

            <div className="al-progress-dots" aria-label={`Progress ${a?.progress ?? 0} of ${a?.sequenceLength ?? 0}`}>
              {Array.from({ length: a?.sequenceLength || 0 }, (_, i) => (
                <span key={i} className={`al-dot ${i < (a?.progress ?? 0) ? 'done' : ''}`} />
              ))}
            </div>

            <div className="al-lcd-preview">
              <div className="al-lcd-label">VAULT LCD</div>
              <div className="al-lcd-line">{a?.currentLcdText?.[0] ?? ''}</div>
              <div className="al-lcd-line">{a?.currentLcdText?.[1] ?? ''}</div>
            </div>

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
