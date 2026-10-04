// Presage SmartSpectra integration.
//
// PresageSession owns the SDK (one per process - the native SDK state is
// process-global, so only one player can be scanned at a time). Browser frames
// arrive as JPEG, are decoded to RGBA and pushed with sendFrame(). Presage
// answers asynchronously with `metrics` packets (face landmarks, blinking,
// expressions) and `validationStatus` codes (no face, too dark, ...).
//
// FaceSignalAdapter turns those packets into the discrete inputs the
// challenge understands: face present/absent and "nod" | "blink" | "smile".
import sharp from 'sharp';

// Decoding is the main per-frame cost besides Presage itself; libjpeg-turbo (via
// sharp) is ~4.5x faster than a pure-JS decoder. One frame at a time: frames must
// reach Presage in order, and extra threads don't help on a small server.
sharp.concurrency(1);
sharp.cache(false);
const MAX_PENDING_FRAMES = 3; // CPU falling behind: drop frames instead of building lag
// Presage rejects a frame more than 2 s after the previous one, and then keeps
// rejecting everything after it. Pauses longer than this are squeezed down to
// one nominal frame step so the stream it sees stays continuous.
const MAX_FRAME_GAP_US = 1_000_000;
const NOMINAL_FRAME_US = 33_333;
const REJECT_STREAK_RESTART = 30; // this many rejected frames in a row -> fresh session

export const GESTURES = {
  NOD_DELTA: 0.07,          // nose leaves its resting height by this many face-heights...
  NOD_RETURN: 0.03,         // ...and comes back within this many...
  NOD_MAX_S: 1.5,           // ...within this many seconds
  NOD_BASELINE_ALPHA: 0.1,  // how fast the resting height follows slow drift
  BLINK_MIN_GAP_S: 0.15,    // two "blink" detections closer than this are one blink
  SMILE_HAPPY: 0.6,         // Presage HAPPY confidence (0-1) that counts as a smile
  SMILE_SAMPLES: 2,         // consecutive HAPPY samples required
};

// Face-mesh landmark indices (Presage uses the 478-point MediaPipe numbering).
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const HAPPY = 5; // ExpressionType.HAPPY

const num = (v) => (v && typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
const byTime = (a, b) => num(a.timestamp) - num(b.timestamp);

export class NodTracker {
  constructor() { this.reset(); }

  reset() {
    this.baseline = null;
    this.movingSince = null;
    this.delta = 0;
  }

  /** @returns true when a complete nod (away and back, quickly) just finished */
  update(noseY, faceH, t) {
    if (this.baseline == null) {
      this.baseline = noseY;
      return false;
    }
    this.delta = (noseY - this.baseline) / Math.max(faceH, 1e-3);
    if (this.movingSince == null) {
      if (Math.abs(this.delta) > GESTURES.NOD_DELTA) this.movingSince = t;
      else this.baseline += GESTURES.NOD_BASELINE_ALPHA * (noseY - this.baseline);
      return false;
    }
    if (Math.abs(this.delta) < GESTURES.NOD_RETURN) {
      const quick = t - this.movingSince <= GESTURES.NOD_MAX_S;
      this.movingSince = null;
      return quick;
    }
    if (t - this.movingSince > GESTURES.NOD_MAX_S) {
      // Head moved and stayed (leaned, shifted seat): adopt it as the new rest.
      this.movingSince = null;
      this.baseline = noseY;
    }
    return false;
  }
}

export class FaceSignalAdapter {
  constructor() { this.reset(); }

  reset() {
    this.nod = new NodTracker();
    this.blinkOn = false;
    this.lastBlinkT = -Infinity;
    this.happySamples = 0;
    this.lastSampleT = -Infinity; // packets can overlap; skip samples already seen
    this.debug = { blink: 0, smile: 0, nodDelta: 0 };
  }

  /**
   * Consume one decoded Presage Metrics packet.
   * @returns {{gestures: string[], sawFace: boolean}} gestures in time order
   */
  ingest(metrics) {
    const face = metrics?.face;
    if (!face) return { gestures: [], sawFace: false };
    const events = []; // [t, gesture]
    let sawFace = false;
    let newest = this.lastSampleT;

    for (const lm of [...(face.landmarks ?? [])].sort(byTime)) {
      const t = num(lm.timestamp) / 1e6;
      const pts = lm.value ?? [];
      if (t <= this.lastSampleT || pts.length <= CHIN) continue;
      sawFace = true;
      newest = Math.max(newest, t);
      if (lm.reset) this.nod.reset(); // Presage lost and re-acquired the face
      const faceH = Math.abs(pts[CHIN].y - pts[FOREHEAD].y);
      if (this.nod.update(pts[NOSE_TIP].y, faceH, t)) events.push([t, 'nod']);
      this.debug.nodDelta = Math.round(this.nod.delta * 1000) / 1000;
    }

    for (const b of [...(face.blinking ?? [])].sort(byTime)) {
      const t = num(b.timestamp) / 1e6;
      if (t <= this.lastSampleT) continue;
      newest = Math.max(newest, t);
      // A blink is the rising edge of Presage's binary "eyes closed" detection.
      if (b.detected && !this.blinkOn && t - this.lastBlinkT >= GESTURES.BLINK_MIN_GAP_S) {
        events.push([t, 'blink']);
        this.lastBlinkT = t;
      }
      this.blinkOn = !!b.detected;
      this.debug.blink = b.detected ? 1 : 0;
    }

    for (const ex of [...(face.expression ?? [])].sort(byTime)) {
      const t = num(ex.timestamp) / 1e6;
      if (t <= this.lastSampleT) continue;
      newest = Math.max(newest, t);
      const happy = (ex.scores ?? []).find((s) => s.type === HAPPY || s.type === 'HAPPY');
      const score = happy ? num(happy.confidence) / 100 : 0;
      this.debug.smile = Math.round(score * 100) / 100;
      this.happySamples = score >= GESTURES.SMILE_HAPPY ? this.happySamples + 1 : 0;
      if (this.happySamples === GESTURES.SMILE_SAMPLES) events.push([t, 'smile']);
    }

    this.lastSampleT = newest;
    events.sort((a, b) => a[0] - b[0]);
    return { gestures: events.map((e) => e[1]), sawFace };
  }
}

// Friendly text for Presage validation codes (ValidationCode enum).
const HINTS = {
  1: 'No face found',
  2: 'Only one face at a time',
  3: 'Center your face',
  4: 'Adjust your distance',
  5: 'Too dark - add some light',
  6: 'Too bright',
  10: 'Camera adjusting...',
  11: 'Connection too slow for the scanner',
  13: 'Back up a little',
  14: 'Move closer',
  15: 'Lower your camera or face',
  16: 'Raise your camera or face',
  17: 'Look straight at the camera',
};
const NO_FACE = 1;
const MULTIPLE_FACES = 2;

/**
 * Wraps the SmartSpectra SDK for one scanning session at a time.
 * Emits through the callbacks passed to acquire().
 */
export class PresageSession {
  constructor({ apiKey, sdkModule, logger = console }) {
    this.apiKey = apiKey;
    this.sdkModule = sdkModule; // injected so tests and key-less runs don't need the native SDK
    this.log = logger;
    this.owner = null;
    this.sdk = null;
    this.state = apiKey ? 'off' : 'no_key'; // off | starting | running | error | no_key
    this.error = null;
    this.hint = null;
    this.lastTsUs = 0;
    this.frameQueue = Promise.resolve();
    this.pendingFrames = 0;
    // Diagnostics for /health: what actually reaches Presage and what comes back.
    this.stats = { framesSent: 0, framesDropped: 0, sendFrameRejected: 0, sendFrameErrors: 0, gapsCompressed: 0, sessionRestarts: 0, metricsPackets: 0, faceSamples: 0, validationEvents: 0, lastValidationCode: null, lastProcessingStatus: null, lastError: null };
    this.teardown = Promise.resolve();
    this.starting = null;
    this.retryAfter = 0;
  }

  get available() {
    return !!this.apiKey && !!this.sdkModule;
  }

  isOwner(id) {
    return this.owner === id;
  }

  isBusyFor(id) {
    return this.owner != null && this.owner !== id;
  }

  /** Start scanning for `id`. Resolves false if another player holds the scanner or start failed. */
  acquire(id, callbacks) {
    if (!this.available || this.isBusyFor(id)) return Promise.resolve(false);
    if (this.owner === id) return this.starting ?? Promise.resolve(!!this.sdk);
    // Don't hammer Presage with a bad key / no credits: wait before retrying.
    if (Date.now() < this.retryAfter) return Promise.resolve(false);
    this.owner = id;
    this.callbacks = callbacks;
    this.starting = this.#start(id, callbacks).finally(() => { this.starting = null; });
    return this.starting;
  }

  async #start(id, callbacks) {
    await this.teardown; // native state is process-global: finish any previous teardown first
    if (this.owner !== id) return false;

    const { SmartSpectraSDK, FrameTransform, faceMetrics, SmartSpectraLogLevel } = this.sdkModule.sdk;
    const { decodeMetrics } = this.sdkModule.messages;
    this.state = 'starting';
    this.error = null;
    this.hint = null;
    this.lastTsUs = 0;
    this.tsOffsetUs = 0;
    this.rejectStreak = 0;
    this.lastSendError = null;
    callbacks.onStatus?.();
    try {
      const sdk = new SmartSpectraSDK({
        apiKey: this.apiKey,
        requestedMetrics: faceMetrics, // landmarks, blinking, talking, expressions
        logLevel: SmartSpectraLogLevel.kWarning,
      });
      sdk.on('metrics', (buf) => {
        this.stats.metricsPackets += 1;
        if (this.owner !== id) return;
        let metrics;
        try {
          metrics = decodeMetrics(buf);
        } catch (e) {
          this.log.warn('[presage] could not decode metrics', e.message);
          return;
        }
        if (Buffer.isBuffer(metrics)) return;
        this.stats.faceSamples += (metrics.face?.landmarks?.length ?? 0) + (metrics.face?.blinking?.length ?? 0) + (metrics.face?.expression?.length ?? 0);
        callbacks.onMetrics?.(metrics);
      });
      sdk.on('validationStatus', (code) => {
        this.stats.validationEvents += 1;
        this.stats.lastValidationCode = code;
        if (this.owner !== id) return;
        this.hint = code === 0 ? null : HINTS[code] ?? null;
        if (code === NO_FACE) callbacks.onFace?.(false);
        else if (code === 0 || code === MULTIPLE_FACES || HINTS[code]) callbacks.onFace?.(true);
        callbacks.onStatus?.();
      });
      sdk.on('processingStatus', (status) => {
        this.stats.lastProcessingStatus = status;
        if (this.owner !== id) return;
        if (status === 3) this.state = 'running'; // ProcessingStatus.kRunning
        callbacks.onStatus?.();
      });
      sdk.on('error', (code, message, retryable) => {
        this.stats.lastError = `${code}: ${message}`;
        if (this.owner !== id) return;
        this.log.warn(`[presage] error ${code}: ${message} (retryable=${retryable})`);
        this.#setError(code, message);
        // Timestamp hiccups (tab was hidden, network stall): rebuild on the next frame.
        if (code === 10 || code === 11 || retryable) this.#restartSoon(id);
        else {
          this.release(id);
          this.retryAfter = Date.now() + 10_000;
        }
      });
      sdk.useCustomInput(FrameTransform.kNone);
      sdk.start(); // authenticates with Presage; throws on a bad key
      this.sdk = sdk;
      if (this.state === 'starting') this.state = 'running';
      callbacks.onStatus?.();
      return true;
    } catch (e) {
      this.log.warn(`[presage] start failed: ${e.code} ${e.message}`);
      this.#setError(e.code, e.message);
      this.owner = null;
      this.retryAfter = Date.now() + 10_000;
      callbacks.onStatus?.();
      return false;
    }
  }

  #setError(code, message) {
    this.state = 'error';
    this.error = code === 2 ? 'Presage rejected the API key.'
      : code === 4 ? 'Presage credits are used up.'
        : code === 5 ? 'Cannot reach Presage (network).'
          : message || `Presage error ${code}`;
    this.callbacks?.onStatus?.();
  }

  // Drop the broken session; the next frame from the player re-acquires a fresh one.
  #restartSoon(id) {
    this.release(id);
  }

  /**
   * Queue one JPEG frame for Presage. Returns false if the frame was dropped (not
   * scanning, not a JPEG, or the server is behind); decoding and sendFrame happen
   * asynchronously, in arrival order.
   */
  sendJpeg(id, jpegBytes) {
    if (this.owner !== id || !this.sdk || this.state !== 'running') return false;
    if (this.pendingFrames >= MAX_PENDING_FRAMES) {
      this.stats.framesDropped += 1;
      return false;
    }
    if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return false; // not a JPEG
    const ts = this.#nextTimestamp();
    const sdk = this.sdk;
    this.pendingFrames += 1;
    this.frameQueue = this.frameQueue
      .then(() => sharp(jpegBytes, { limitInputPixels: 2_000_000 }).removeAlpha().raw().toBuffer({ resolveWithObject: true }))
      .then(({ data, info }) => {
        if (this.sdk !== sdk || this.state !== 'running') return; // session ended while decoding
        const { PixelFormat } = this.sdkModule.sdk;
        const ok = sdk.sendFrame(data, info.width, info.height, info.width * 3, PixelFormat.kRGB, ts);
        if (ok === false) {
          this.stats.sendFrameRejected += 1;
          this.#noteRejected(id, sdk);
        } else {
          this.stats.framesSent += 1;
          this.rejectStreak = 0;
        }
      })
      .catch((e) => {
        this.stats.sendFrameErrors += 1;
        // Frames keep coming at 30 fps; log a failing state once, not every frame.
        if (this.lastSendError !== e.message) this.log.warn('[presage] frame dropped:', e.code ?? '', e.message);
        this.lastSendError = e.message;
        this.#noteRejected(id, sdk);
      })
      .finally(() => { this.pendingFrames -= 1; });
    return true;
  }

  // Server monotonic clock (as Presage's docs recommend), strictly increasing,
  // with long pauses compressed so Presage never sees a > 2 s gap.
  #nextTimestamp() {
    let ts = Math.round(performance.now() * 1000) - this.tsOffsetUs;
    if (this.lastTsUs && ts - this.lastTsUs > MAX_FRAME_GAP_US) {
      this.tsOffsetUs += ts - this.lastTsUs - NOMINAL_FRAME_US;
      ts = this.lastTsUs + NOMINAL_FRAME_US;
      this.stats.gapsCompressed += 1;
    }
    if (ts <= this.lastTsUs) ts = this.lastTsUs + 1;
    this.lastTsUs = ts;
    return ts;
  }

  // Presage stuck rejecting frames (for whatever reason): start a fresh session.
  #noteRejected(id, sdk) {
    if (this.sdk !== sdk) return;
    this.rejectStreak += 1;
    if (this.rejectStreak >= REJECT_STREAK_RESTART) {
      this.log.warn(`[presage] ${this.rejectStreak} frames rejected in a row; restarting session`);
      this.rejectStreak = 0;
      this.stats.sessionRestarts += 1;
      this.#restartSoon(id);
    }
  }

  /** Stop scanning for `id` (challenge over, player left). */
  release(id) {
    if (this.owner !== id) return;
    const sdk = this.sdk;
    this.owner = null;
    this.sdk = null;
    this.hint = null;
    if (this.state !== 'error') this.state = 'off';
    if (sdk) {
      this.teardown = this.teardown
        .then(() => sdk.stopAsync())
        .catch(() => {})
        .then(() => sdk.destroy())
        .catch((e) => this.log.warn('[presage] teardown failed', e.message));
    }
  }

  status(id) {
    if (!this.apiKey) return { sensor: 'no_key', sensorError: 'PRESAGE_API_KEY is not set on the server.', hint: null };
    if (!this.sdkModule) return { sensor: 'error', sensorError: 'Presage SDK failed to load on this server.', hint: null };
    if (this.isBusyFor(id)) return { sensor: 'busy', sensorError: null, hint: null };
    if (this.owner !== id) return { sensor: this.state === 'error' ? 'error' : 'off', sensorError: this.state === 'error' ? this.error : null, hint: null };
    return { sensor: this.state, sensorError: this.state === 'error' ? this.error : null, hint: this.hint };
  }
}
