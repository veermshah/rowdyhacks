// Riverwalk checkpoint state machine. Sensor-agnostic: it receives discrete
// inputs (frame arrived, face present/absent, gesture "nod" | "blink" | "smile")
// from the Presage adapter, or from the dev Simulate buttons.
//
// Rules:
//   * Steps must happen in order: face -> nod -> blink x2 -> smile.
//   * Out-of-order gestures are ignored: no progress, no failure, no reset.
//   * A failed attempt is running out a step's timer (live camera only) or a
//     dev "fail". Each failure restarts the sequence; MAX_ATTEMPTS trips the alarm.
//   * Losing the face or the camera feed pauses (and freezes the timer) without
//     counting as a failure.
//
// Methods that can change the outcome return event names ("failed", "alarm",
// "complete") so the socket layer can update the shared car.

export const STEPS = ['face', 'nod', 'blink', 'smile'];

// Prompts echo the clue ("Acknowledge the guard, signal twice, and look pleased.")
// without naming the gestures.
export const PROMPTS = {
  face: "Face the guard's camera.",
  nod: 'Acknowledge the guard.',
  blink: 'Signal twice.',
  smile: 'Look pleased.',
};

export const RULES = {
  MAX_ATTEMPTS: 3,
  STEP_TIMEOUT_S: 20,        // per step; only ticks while live camera frames arrive
  FACE_CONFIRM_S: 0.5,       // face must stay visible this long for "face detected"
  FACE_LOST_GRACE_S: 0.6,    // face gone this long = pause
  FRAME_GAP_PAUSE_S: 1.5,    // no camera frames this long = pause
  DOUBLE_BLINK_WINDOW_S: 3,  // both blinks must land within this window
  FAIL_COOLDOWN_S: 1.5,      // ignore input right after a failure
};

export class RiverwalkChallenge {
  constructor() {
    this.status = 'idle'; // idle | active | paused | alarm | complete
    this.failures = 0;
    this.lastFailReason = null;
    this.faceVisible = false;
    this.lastFrameAt = null;
    this.message = 'Pull up to the Riverwalk checkpoint.';
    this.#resetSequence();
  }

  #resetSequence() {
    this.step = 0;
    this.blinks = 0;
    this.firstBlinkAt = null;
    this.faceSince = null;
    this.lostSince = null;
    this.pausedAt = null;
    this.pauseReason = null;
    this.deadline = Infinity;
    this.cooldownUntil = 0;
  }

  get running() {
    return this.status === 'active' || this.status === 'paused';
  }

  start(now) {
    if (this.status === 'alarm') this.failures = 0; // cops already called; fresh tries
    this.status = 'active';
    this.#resetSequence();
    if (this.faceVisible) this.faceSince = now;
    this.#enterStep(0, now);
  }

  #enterStep(step, now) {
    this.step = step;
    this.deadline = now + RULES.STEP_TIMEOUT_S;
    if (STEPS[step] === 'blink') {
      this.blinks = 0;
      this.firstBlinkAt = null;
    }
    this.message = PROMPTS[STEPS[step]];
  }

  #fail(reason, now) {
    this.failures += 1;
    this.lastFailReason = reason;
    if (this.failures >= RULES.MAX_ATTEMPTS) {
      this.status = 'alarm';
      this.message = `ALARM! ${reason} Security is on the way.`;
      return ['failed', 'alarm'];
    }
    const left = RULES.MAX_ATTEMPTS - this.failures;
    const faceSince = this.faceVisible ? now : null;
    this.#resetSequence();
    this.faceSince = faceSince;
    this.#enterStep(0, now);
    this.cooldownUntil = now + RULES.FAIL_COOLDOWN_S;
    this.message = `${reason} Sequence reset - ${left} attempt${left === 1 ? '' : 's'} left.`;
    return ['failed'];
  }

  #pause(reason, since) {
    this.status = 'paused';
    this.pauseReason = reason;
    this.pausedAt = since;
    this.message = reason === 'feed'
      ? 'Camera feed lost - progress paused.'
      : 'Lost tracking - get back in frame. Progress paused.';
  }

  #resume(now) {
    if (this.status !== 'paused') return;
    this.status = 'active';
    if (this.pausedAt != null) {
      const gap = now - this.pausedAt;
      this.deadline += gap;
      this.cooldownUntil += gap;
    }
    this.pausedAt = null;
    this.pauseReason = null;
    this.message = `Tracking restored. ${PROMPTS[STEPS[this.step]]}`;
  }

  /** A live camera frame reached the sensor. */
  frame(now) {
    this.lastFrameAt = now;
    if (this.status === 'paused' && this.pauseReason === 'feed') {
      if (this.lostSince == null) this.#resume(now);
      else this.pauseReason = 'face'; // feed is back but the face still isn't
    }
  }

  /** Sensor says whether a face is in view. */
  face(present, now) {
    this.faceVisible = present;
    if (present) {
      this.lostSince = null;
      this.faceSince ??= now;
      if (this.status === 'paused' && this.pauseReason === 'face') this.#resume(now);
    } else {
      this.faceSince = null;
      this.lostSince ??= now;
    }
  }

  /** Sensor recognized a gesture. Only the gesture matching the current step counts. */
  gesture(name, now) {
    if (this.status !== 'active' || now < this.cooldownUntil) return [];
    return this.#advance(name, now);
  }

  #advance(name, now) {
    const step = STEPS[this.step];
    if (name !== step) return []; // out of order: ignored
    if (step === 'face' || step === 'nod') {
      this.#enterStep(this.step + 1, now);
    } else if (step === 'blink') {
      if (this.firstBlinkAt != null && now - this.firstBlinkAt > RULES.DOUBLE_BLINK_WINDOW_S) {
        this.blinks = 0; // too slow between signals: start the pair over (not a failure)
      }
      this.blinks += 1;
      if (this.blinks === 1) this.firstBlinkAt = now;
      else this.#enterStep(3, now);
    } else if (step === 'smile') {
      this.status = 'complete';
      this.step = STEPS.length;
      this.message = 'Vault open! Riverwalk cash secured.';
      return ['complete'];
    }
    return [];
  }

  /** Periodic housekeeping: pauses, face confirmation, step timeout. */
  tick(now) {
    if (this.status === 'paused') return [];
    if (this.status !== 'active') return [];

    if (this.lastFrameAt != null && now - this.lastFrameAt > RULES.FRAME_GAP_PAUSE_S) {
      this.#pause('feed', this.lastFrameAt);
      return [];
    }
    if (this.lostSince != null && now - this.lostSince > RULES.FACE_LOST_GRACE_S) {
      this.#pause('face', this.lostSince);
      return [];
    }
    if (now < this.cooldownUntil) return [];

    const step = STEPS[this.step];
    if (step === 'face') {
      if (this.faceSince != null && now - this.faceSince >= RULES.FACE_CONFIRM_S) this.#enterStep(1, now);
      return [];
    }
    // The timer only runs for live play; dev-simulated runs never time out.
    if (this.lastFrameAt != null && now > this.deadline) {
      return this.#fail('Too slow - the guard got suspicious!', now);
    }
    return [];
  }

  /** Dev input: face | nod | blink | smile | fail. Same ordering rules as live input. */
  simulate(action, now) {
    if (this.status === 'idle' || this.status === 'complete') this.start(now);
    if (this.status === 'alarm') return [];
    if (this.status === 'paused') this.#resume(now);
    if (action === 'fail') return this.#fail('Wrong signal!', now);
    return this.#advance(action, now);
  }

  snapshot(now) {
    let timeLeft = null;
    if (this.status === 'active') timeLeft = this.deadline - now;
    else if (this.status === 'paused' && this.pausedAt != null) timeLeft = this.deadline - this.pausedAt;
    if (timeLeft != null) timeLeft = Number.isFinite(timeLeft) ? Math.max(0, Math.round(timeLeft * 10) / 10) : null;
    return {
      status: this.status,
      step: this.step < STEPS.length ? STEPS[this.step] : 'done',
      checklist: Object.fromEntries(STEPS.map((name, i) => [name, this.step > i])),
      faceVisible: this.faceVisible,
      blinks: this.blinks,
      failures: this.failures,
      maxAttempts: RULES.MAX_ATTEMPTS,
      timeLeft,
      stepTimeout: RULES.STEP_TIMEOUT_S,
      message: this.message,
      lastFailReason: this.lastFailReason,
    };
  }
}
