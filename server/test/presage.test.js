// Presage adapter + full socket pipeline, using a fake SmartSpectra SDK that
// mirrors the real one's events and payload shapes (no API key needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { io as connect } from 'socket.io-client';
import { FaceSignalAdapter } from '../src/presage.js';
import { createApp, RIVERWALK_REWARD } from '../src/server.js';

// ---- Fake Presage payloads (shapes from docs/data-types.md) ----------------
const us = (s) => Math.round(s * 1e6);
function face(noseY) {
  const pts = Array.from({ length: 478 }, () => ({ x: 200, y: 200 }));
  pts[10] = { x: 200, y: 100 };  // forehead
  pts[152] = { x: 200, y: 300 }; // chin  -> face height 200 px
  pts[1] = { x: 200, y: noseY }; // nose tip
  return pts;
}
const landmarks = (samples) => ({ face: { landmarks: samples.map(([t, y]) => ({ value: face(y), stable: true, reset: false, timestamp: us(t) })) } });
const blinking = (samples) => ({ face: { blinking: samples.map(([t, d]) => ({ detected: d, stable: true, timestamp: us(t) })) } });
const expression = (samples) => ({ face: { expression: samples.map(([t, happy]) => ({ stable: true, timestamp: us(t), scores: [{ type: 6, confidence: 100 - happy }, { type: 5, confidence: happy }] })) } });
const nodPacket = (t0) => landmarks([[t0, 200], [t0 + 0.1, 200], [t0 + 0.3, 230], [t0 + 0.6, 235], [t0 + 0.9, 202], [t0 + 1.0, 200]]);

test('adapter: nod = nose leaves rest by >7% face height and returns quickly', () => {
  const a = new FaceSignalAdapter();
  const r = a.ingest(nodPacket(1));
  assert.deepEqual(r.gestures, ['nod']);
  assert.equal(r.sawFace, true);
});

test('adapter: slow lean is not a nod', () => {
  const a = new FaceSignalAdapter();
  const r = a.ingest(landmarks([[1, 200], [1.5, 240], [2.5, 240], [3.5, 240], [4.5, 200]]));
  assert.deepEqual(r.gestures, []);
});

test('adapter: blink = rising edge of Presage blink detection, across packets', () => {
  const a = new FaceSignalAdapter();
  assert.deepEqual(a.ingest(blinking([[1, false], [1.1, true], [1.2, true]])).gestures, ['blink']);
  assert.deepEqual(a.ingest(blinking([[1.3, true], [1.4, false], [1.6, true]])).gestures, ['blink']);
  // overlapping/duplicate samples are not double counted
  assert.deepEqual(a.ingest(blinking([[1.6, true]])).gestures, []);
});

test('adapter: smile = HAPPY confidence >= 60% on consecutive samples', () => {
  const a = new FaceSignalAdapter();
  assert.deepEqual(a.ingest(expression([[1, 30], [1.1, 70]])).gestures, []);
  assert.deepEqual(a.ingest(expression([[1.2, 80]])).gestures, ['smile']);
  assert.equal(a.debug.smile, 0.8);
});

// ---- Fake SDK module ---------------------------------------------------------
function fakeSdkModule() {
  const instances = [];
  class SmartSpectraSDK {
    static version = 'fake';
    constructor(opts) { this.opts = opts; this.handlers = {}; this.frames = []; this.accept = true; instances.push(this); }
    on(ev, cb) { this.handlers[ev] = cb; return this; }
    useCustomInput() { return this; }
    start() {
      if (this.opts.apiKey === 'bad') throw Object.assign(new Error('auth failed'), { code: 2, retryable: false });
      this.handlers.processingStatus?.(3);
    }
    sendFrame(buf, w, h, stride, fmt, ts) { this.frames.push({ w, h, stride, fmt, ts, bytes: buf.length }); return this.accept; }
    async stopAsync() { this.stopped = true; }
    async destroy() { this.destroyed = true; }
    emit(ev, ...args) { this.handlers[ev]?.(...args); }
  }
  return {
    instances,
    module: {
      sdk: {
        SmartSpectraSDK, faceMetrics: [11, 12, 13, 14],
        FrameTransform: { kNone: 0 }, PixelFormat: { kRGB: 0, kRGBA: 2 }, SmartSpectraLogLevel: { kWarning: 2 },
      },
      messages: { decodeMetrics: (buf) => buf }, // fake "buffers" are already objects
    },
  };
}

const JPEG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#808080' } }).jpeg({ quality: 70 }).toBuffer();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(opts) {
  const app = await createApp({ devMode: true, logger: { warn() {}, error() {}, log() {} }, ...opts });
  await new Promise((r) => app.httpServer.listen(0, r));
  const client = connect(`http://localhost:${app.httpServer.address().port}`, { transports: ['websocket'] });
  await new Promise((r) => client.on('connect', r));
  return { app, client };
}

test('pipeline: frames reach Presage; Presage gestures clear the vault and pay out', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'test-key' });
  try {
    const carId = 'car-pipeline';
    await client.emitWithAck('join_car', { carId });
    await client.emitWithAck('start_challenge');

    // First frame acquires the scanner; next frames are pushed to Presage as RGBA.
    await client.emitWithAck('frame', { image: JPEG });
    await wait(50);
    let snap;
    for (let i = 1; i <= 5; i++) { snap = await client.emitWithAck('frame', { image: JPEG }); await wait(15); }
    await wait(50); // decoding is async
    const sdk = fake.instances[0];
    assert.equal(sdk.opts.apiKey, 'test-key');
    assert.deepEqual(sdk.opts.requestedMetrics, [11, 12, 13, 14]);
    assert.ok(sdk.frames.length >= 4, 'frames forwarded to Presage');
    assert.deepEqual({ w: sdk.frames[0].w, h: sdk.frames[0].h, stride: sdk.frames[0].stride, fmt: sdk.frames[0].fmt }, { w: 64, h: 48, stride: 192, fmt: 0 }); // RGB from sharp
    assert.ok(sdk.frames.every((f, i, a) => i === 0 || f.ts > a[i - 1].ts), 'timestamps strictly increase');
    assert.equal(snap.sensor, 'running');

    // Presage reports a face; keep frames flowing so the face step confirms.
    sdk.emit('validationStatus', 0, 0, '');
    for (let i = 6; i < 30; i++) { snap = await client.emitWithAck('frame', { image: JPEG }); await wait(30); }
    assert.equal(snap.step, 'nod');

    // Out-of-order (smile, blink) ignored, then the real sequence.
    sdk.emit('metrics', expression([[10, 90], [10.1, 90]]));
    sdk.emit('metrics', blinking([[10.2, false], [10.3, true], [10.4, false]]));
    snap = await client.emitWithAck('frame', { image: JPEG });
    assert.equal(snap.step, 'nod');
    assert.equal(snap.failures, 0);

    sdk.emit('metrics', nodPacket(11));
    sdk.emit('metrics', blinking([[13, false], [13.1, true], [13.2, false], [13.5, true], [13.6, false]]));
    sdk.emit('metrics', expression([[14, 20]]));
    sdk.emit('metrics', expression([[14.1, 85], [14.2, 90]]));
    await wait(50);
    const car = app.getCar(carId);
    assert.deepEqual(car, { loot: RIVERWALK_REWARD, wantedLevel: 1, riverwalkCleared: true });

    // Scanner is released once the vault is open.
    await wait(400);
    assert.equal(app.presage.owner, null);
    assert.ok(sdk.stopped && sdk.destroyed);
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: non-JPEG bytes are rejected and a slow server drops frames instead of lagging', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'k' });
  try {
    await client.emitWithAck('start_challenge');
    await client.emitWithAck('frame', { image: JPEG });
    await wait(50);
    assert.equal(app.presage.sendJpeg(client.id, Buffer.from('not a jpeg')), false);
    const accepted = Array.from({ length: 10 }, (_, i) => app.presage.sendJpeg(client.id, JPEG));
    assert.deepEqual(accepted, [true, true, true, false, false, false, false, false, false, false]);
    await wait(100);
    assert.equal(fake.instances[0].frames.length >= 3, true);
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: a pause in frames is compressed so Presage never sees a > 2 s gap', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'k' });
  try {
    await client.emitWithAck('start_challenge');
    await client.emitWithAck('frame', { image: JPEG });
    await wait(50);
    await client.emitWithAck('frame', { image: JPEG });
    await wait(1300); // tab hidden / network stall
    await client.emitWithAck('frame', { image: JPEG });
    await wait(80);
    const ts = fake.instances[0].frames.map((f) => f.ts);
    assert.equal(ts.length, 2, 'first frame only acquires the scanner');
    assert.ok(ts[1] - ts[0] <= 1_000_000, `gap ${ts[1] - ts[0]} us sent to Presage`);
    assert.equal(app.presage.stats.gapsCompressed, 1);
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: Presage stuck rejecting frames -> session restarts by itself', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'k' });
  try {
    await client.emitWithAck('start_challenge');
    await client.emitWithAck('frame', { image: JPEG });
    await wait(50);
    fake.instances[0].accept = false;
    for (let i = 0; i < 40; i++) { await client.emitWithAck('frame', { image: JPEG }); await wait(8); }
    await wait(100);
    assert.ok(fake.instances[0].destroyed, 'stuck session torn down');
    assert.equal(fake.instances.length, 2, 'fresh session started');
    assert.equal(app.presage.stats.sessionRestarts, 1);
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: bad API key surfaces an error and does not hammer Presage', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'bad' });
  try {
    await client.emitWithAck('start_challenge');
    for (let i = 0; i < 10; i++) await client.emitWithAck('frame', { image: JPEG });
    await wait(50);
    const snap = await client.emitWithAck('frame', { image: JPEG });
    assert.equal(snap.sensor, 'error');
    assert.match(snap.sensorError, /API key/);
    assert.equal(fake.instances.length, 1, 'only one start attempt during the back-off window');
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: no API key -> clear message; dev simulate still works and pays out', async () => {
  const { app, client } = await startServer({ sdkModule: null, apiKey: '' });
  try {
    await client.emitWithAck('join_car', { carId: 'car-sim' });
    let snap = await client.emitWithAck('frame', { image: JPEG });
    assert.equal(snap.sensor, 'no_key');
    for (const a of ['face', 'smile', 'nod', 'blink', 'blink', 'smile']) snap = await client.emitWithAck('simulate', { action: a });
    assert.equal(snap.status, 'complete');
    assert.deepEqual(app.getCar('car-sim'), { loot: 5000, wantedLevel: 1, riverwalkCleared: true });
    assert.deepEqual(await client.emitWithAck('reset_car'), { ok: true });
    assert.deepEqual(app.getCar('car-sim'), { loot: 0, wantedLevel: 0, riverwalkCleared: false });
  } finally {
    client.disconnect();
    await app.close();
  }
});

test('pipeline: only one player can hold the Presage scanner', async () => {
  const fake = fakeSdkModule();
  const { app, client } = await startServer({ sdkModule: fake.module, apiKey: 'k' });
  const other = connect(`http://localhost:${app.httpServer.address().port}`, { transports: ['websocket'] });
  try {
    await new Promise((r) => other.on('connect', r));
    await client.emitWithAck('start_challenge');
    await other.emitWithAck('start_challenge');
    await client.emitWithAck('frame', { image: JPEG });
    await wait(30);
    const snap = await other.emitWithAck('frame', { image: JPEG });
    assert.equal(snap.sensor, 'busy');
    client.disconnect(); // first player leaves -> scanner frees up
    await wait(100);
    await other.emitWithAck('frame', { image: JPEG });
    await wait(30);
    assert.equal((await other.emitWithAck('frame', { image: JPEG })).sensor, 'running');
  } finally {
    other.disconnect();
    await app.close();
  }
});
