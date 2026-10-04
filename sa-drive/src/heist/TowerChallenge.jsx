import { useEffect, useRef, useState } from 'react';
import {
  closeTower, towerAdminSkip, towerAdminReset, towerAdminShowCode, towerSimInput,
  towerDevWebhook, useHeist,
} from '../game/heist.js';
import { HEIST_DEV_TOOLS } from '../config/heistConfig.js';

// Mirrors server/tower_config.py - only used to scale the meters and labels.
// The server owns the real gameplay checks.
const OTP_TTL_S = 30;
const SUSPICION_ALARM_THRESHOLD = 100;
const MAX_OTP_ATTEMPTS = 3;
const KEY_TO_MOVE = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const STEPS = [
  { id: 'call', label: 'Call the bank and pass verification', stages: ['TOWER_RINGING', 'TOWER_VERIFY'] },
  { id: 'code', label: 'Read the code off the vault', stages: ['TOWER_CODE'] },
  { id: 'enter', label: 'Key it in on the joystick', stages: ['TOWER_ENTERING'] },
];

const STEP_TEXT = {
  TOWER_IDLE: 'Waiting for the vault to come online...',
  TOWER_RINGING: "Phone the bank's fraud line and ask for Margaret. Pose as the account holder - or know the staff override phrase.",
  TOWER_VERIFY: "Margaret is on the line. Talk her into trusting you: once she's satisfied she'll send the one-time code to the vault.",
  TOWER_CODE: 'A code is on the vault screen right now - read it off before it disappears!',
  TOWER_ENTERING: 'Key it in on the vault joystick: up/down = digit, left/right = position. Push right on the last digit to enter it.',
  TOWER_DONE: 'Code accepted. The vault is open.',
  TOWER_ALARM: 'Margaret raised the alarm. Security is on the way.',
};

const OTP_STATUS_TEXT = {
  none: 'No code issued',
  sent: 'Code live',
  verified: 'Code accepted',
  expired: 'Code expired - ask for a new one',
  burned: 'Code burned - too many wrong entries',
};

function stepState(step, substage) {
  const order = STEPS.findIndex((s) => s.stages.includes(substage));
  const index = STEPS.indexOf(step);
  if (substage === 'TOWER_DONE') return 'done';
  if (order < 0) return '';
  if (index < order) return 'done';
  return index === order ? 'current' : '';
}

function CodeEntryView({ entry, cursor, active }) {
  const digits = entry ?? [];
  return (
    <div className={`al-code-boxes tw-entry ${active ? '' : 'idle'}`} aria-label="Live joystick entry">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={`al-code-box ${active && i === cursor ? 'tw-cursor' : ''}`}>
          {active ? digits[i] ?? 0 : ''}
        </span>
      ))}
    </div>
  );
}

function DevPanel({ connected }) {
  const [revealedCode, setRevealedCode] = useState(null);
  const [lastCall, setLastCall] = useState(null);

  const call = async (path, body) => {
    const res = await towerDevWebhook(path, body);
    setLastCall(`${path} -> ${res.status || 'no response'} ${res.body ? JSON.stringify(res.body) : ''}`);
  };
  const toggleShowCode = async () => {
    if (revealedCode) { setRevealedCode(null); return; }
    setRevealedCode(await towerAdminShowCode(true) || '(no live code)');
  };

  return (
    <div className="rw-dev">
      <h3>DEV simulation</h3>
      <p className="rw-muted">Stands in for the Pi: arrow keys = joystick (right on the 4th digit submits).</p>
      <div className="rw-dev-grid">
        <button className="rw-dev-btn" onClick={towerAdminSkip} disabled={!connected}>Skip to done</button>
        <button className="rw-dev-btn" onClick={towerAdminReset} disabled={!connected}>Reset run</button>
        <button className="rw-dev-btn" onClick={toggleShowCode} disabled={!connected}>{revealedCode ? 'Hide' : 'Show'} code</button>
      </div>
      {revealedCode && <p className="rw-muted al-reveal-text">{revealedCode}</p>}

      <h3 className="tw-dev-sub">Margaret's webhook tools</h3>
      <p className="rw-muted">Same POSTs ElevenLabs makes. Identity checks live in the agent, not here.</p>
      <div className="rw-dev-grid">
        <button className="rw-dev-btn" onClick={() => call('send-otp')}>sendOtp</button>
        <button className="rw-dev-btn" onClick={() => call('check-otp')}>checkOtp</button>
        <button className="rw-dev-btn" onClick={() => call('approve-transfer', { amount: 12000 })}>approveTransfer</button>
        <button className="rw-dev-btn" onClick={() => call('raise-suspicion', { amount: 30, reason: 'dev' })}>raiseSuspicion +30</button>
        <button className="rw-dev-btn fail" onClick={() => call('trigger-alarm', { reason: 'dev' })}>triggerAlarm</button>
      </div>
      {lastCall && <p className="rw-muted al-reveal-text">{lastCall}</p>}
    </div>
  );
}

export default function TowerChallenge() {
  const heist = useHeist();
  const closeRef = useRef(null);

  const t = heist.tower;
  const substage = t?.substage ?? 'TOWER_IDLE';
  const done = substage === 'TOWER_DONE';
  const alarm = substage === 'TOWER_ALARM';
  const entering = substage === 'TOWER_ENTERING';
  const otpStatus = t?.otpStatus ?? 'none';
  const remaining = t?.otpRemainingS;
  const suspicion = t?.suspicion ?? 0;
  const attemptsLeft = t?.attemptsLeft ?? MAX_OTP_ATTEMPTS;
  const suspicionPct = Math.min(100, (suspicion / SUSPICION_ALARM_THRESHOLD) * 100);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeTower(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dev simulator: arrow keys stand in for the Pi's joystick while this
  // dashboard is open. Capture phase so they beat the modal's
  // own stopPropagation, and stopped here so they never also steer the car.
  useEffect(() => {
    if (!HEIST_DEV_TOOLS) return undefined;
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const move = KEY_TO_MOVE[e.key];
      if (!move) return;
      e.preventDefault();
      e.stopPropagation();
      towerSimInput('joystick', move);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="rw-backdrop">
      <div
        className="rw-modal al-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tw-title"
        onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
      >
        <header className="rw-head">
          <div>
            <div className="rw-eyebrow">CASE FILE 03 &middot; TOWER OF THE AMERICAS</div>
            <h2 id="tw-title">The Callback</h2>
          </div>
          <button ref={closeRef} className="rw-close" onClick={closeTower} aria-label="Close challenge">&times;</button>
        </header>

        <blockquote className="rw-clue al-briefing">
          <span className="rw-clue-label">BRIEFING</span>
          &ldquo;{t?.briefing
            || "Phone the bank's fraud line, convince Margaret you're the account holder, then key the one-time code from the vault screen into its joystick before it expires."}&rdquo;
        </blockquote>

        {!heist.connected && (
          <p className="rw-banner">
            Heist server offline. Start it with <code>python app.py</code> in <code>/server</code>.
          </p>
        )}

        <div className="rw-body">
          <section className="al-main">
            <div className={`tw-phone ${alarm ? 'alarm' : ''} ${done ? 'done' : ''}`}>
              <div className="tw-phone-head">
                <span className="tw-phone-dot" />
                <strong>{done ? 'CALL COMPLETE' : alarm ? 'CALL TRACED' : 'FRAUD LINE - MARGARET'}</strong>
              </div>
              <p className="tw-step-text" aria-live="polite">{STEP_TEXT[substage] ?? STEP_TEXT.TOWER_IDLE}</p>
              <ol className="rw-checklist">
                {STEPS.map((step) => {
                  const st = stepState(step, substage);
                  return (
                    <li key={step.id} className={st}>
                      <span className="rw-check">{st === 'done' ? '✓' : st === 'current' ? '▶' : '·'}</span>
                      {step.label}
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="al-code-entry tw-otp">
              <div className="tw-otp-head">
                <span className={`tw-otp-status ${otpStatus}`}>{OTP_STATUS_TEXT[otpStatus] ?? otpStatus}</span>
                {remaining != null && <strong className="tw-otp-time">{remaining}s</strong>}
              </div>
              <div className="tw-otp-bar" aria-hidden="true">
                <div style={{ width: `${remaining != null ? Math.min(100, (remaining / OTP_TTL_S) * 100) : 0}%` }} />
              </div>
              <CodeEntryView entry={t?.entry} cursor={t?.cursor} active={entering} />
              <div className="rw-attempts" aria-label={`${attemptsLeft} attempts left`}>
                Attempts
                {Array.from({ length: MAX_OTP_ATTEMPTS }, (_, i) => (
                  <span key={i} className={`rw-pip ${i >= attemptsLeft && otpStatus !== 'none' ? 'used' : ''}`} />
                ))}
              </div>
              <p className="al-code-locked-hint">
                The code only ever appears on the vault itself - Margaret can't read it to you.
              </p>
            </div>

            {done && (
              <div className="al-done-banner">
                <strong>VAULT OPEN</strong>
                <p>The bearer bonds are secured - back to the road.</p>
              </div>
            )}
            {alarm && (
              <div className="tw-alarm-banner">
                <strong>ALARM</strong>
                <p>The bank flagged the call. Cops are inbound.</p>
              </div>
            )}
          </section>

          <aside className="rw-side">
            <div className="al-lcd-preview">
              <div className="al-lcd-label">VAULT LCD</div>
              <div className="al-lcd-line">{t?.currentLcdText?.[0] ?? ''}</div>
              <div className="al-lcd-line">{t?.currentLcdText?.[1] ?? ''}</div>
            </div>

            <div className="tw-suspicion">
              <div className="al-lcd-label">BANK SUSPICION</div>
              <div
                className="tw-suspicion-bar"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={SUSPICION_ALARM_THRESHOLD}
                aria-valuenow={suspicion}
                aria-label="Bank suspicion"
              >
                <div className={suspicionPct >= 70 ? 'hot' : ''} style={{ width: `${suspicionPct}%` }} />
              </div>
              <p className="rw-muted">Burned codes and anything fishy Margaret notices make her nervous. Max it out and she calls the cops.</p>
            </div>

            {(done || alarm) && <button className="rw-btn rw-btn-wide" onClick={closeTower}>Back to the road</button>}

            {HEIST_DEV_TOOLS && <DevPanel connected={heist.connected} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
