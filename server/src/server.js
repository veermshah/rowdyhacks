// Loot Run - Riverwalk Heist server (Node.js + Socket.IO + Presage SmartSpectra).
//
// The driver's browser streams JPEG webcam frames over Socket.IO. Frames go to
// Presage SmartSpectra; its face metrics (landmarks, blinking, expressions) are
// turned into checkpoint inputs: face detected -> nod -> blink x2 -> smile.
// Clearing the checkpoint pays out loot and raises the car's wanted level.
//
// Run:  npm start            (reads PRESAGE_API_KEY from server/.env)
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { RiverwalkChallenge, STEPS } from './challenge.js';
import { FaceSignalAdapter, PresageSession } from './presage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const RIVERWALK_REWARD = 5_000;
export const MAX_WANTED_LEVEL = 5;
const MAX_FRAME_BYTES = 512 * 1024;
const SCANNER_IDLE_RELEASE_MS = 5_000; // free the scanner if a player stops sending frames
const TICK_MS = 200;

const DEV_MODE = process.env.RIVERWALK_DEV_MODE !== '0'; // allows the `simulate` event
const PRESAGE_API_KEY = (process.env.PRESAGE_API_KEY || '').trim();
const corsEnv = (process.env.CORS_ORIGINS || '*').split(',').map((o) => o.trim()).filter(Boolean);
const CORS_ORIGINS = corsEnv.length === 1 && corsEnv[0] === '*' ? '*' : corsEnv;

async function loadPresageSdk() {
  try {
    const [sdk, messages] = await Promise.all([
      import('@smartspectra/node-sdk'),
      import('@smartspectra/node-sdk/messages'),
    ]);
    return { sdk, messages };
  } catch (e) {
    console.error('[presage] SDK failed to load:', e.message);
    return null;
  }
}

export async function createApp({ sdkModule, apiKey = PRESAGE_API_KEY, devMode = DEV_MODE, logger = console } = {}) {
  const presage = new PresageSession({ apiKey, sdkModule, logger });
  const cars = new Map();     // carId -> { loot, wantedLevel, riverwalkCleared }
  const sessions = new Map(); // socket.id -> { carId, challenge, adapter, lastSent, lastFrameMs }
  const now = () => performance.now() / 1000;

  const getCar = (id) => {
    if (!cars.has(id)) cars.set(id, { loot: 0, wantedLevel: 0, riverwalkCleared: false });
    return cars.get(id);
  };
  const carDict = (id) => ({ carId: id, ...getCar(id) });

  const httpServer = createServer((req, res) => {
    const origin = req.headers.origin;
    if (CORS_ORIGINS === '*' || (origin && CORS_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS === '*' ? '*' : origin);
    }
    if (req.url === '/health' || req.url === '/') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        sensor: 'presage',
        presageConfigured: !!apiKey,
        presageSdkLoaded: !!sdkModule,
        presageSdkVersion: sdkModule?.sdk?.SmartSpectraSDK?.version ?? null,
        decoder: 'sharp',
        scanner: presage.owner ? 'busy' : 'free',
        stats: presage.stats,
        devMode,
      }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const io = new Server(httpServer, { cors: { origin: CORS_ORIGINS }, maxHttpBufferSize: MAX_FRAME_BYTES * 2 });
  const room = (carId) => `car:${carId}`;
  const broadcastCar = (carId) => io.to(room(carId)).emit('car_state', carDict(carId));

  function snapshot(id, s) {
    return {
      ...s.challenge.snapshot(now()),
      ...presage.status(id),
      debug: s.adapter.debug,
    };
  }

  function emitState(id, s, force = false) {
    const snap = snapshot(id, s);
    const json = JSON.stringify(snap);
    if (!force && json === s.lastSent) return snap;
    s.lastSent = json;
    io.to(id).emit('challenge_state', snap);
    return snap;
  }

  function applyEvents(s, events) {
    if (!events.length) return;
    const car = getCar(s.carId);
    if (events.includes('alarm')) {
      car.wantedLevel = Math.min(MAX_WANTED_LEVEL, car.wantedLevel + 1);
      io.to(room(s.carId)).emit('alarm', { reason: s.challenge.lastFailReason, wantedLevel: car.wantedLevel });
      broadcastCar(s.carId);
    }
    if (events.includes('complete')) {
      // Cash and heat are awarded once per car per run; a game restart (reset_car) re-locks the vault.
      const first = !car.riverwalkCleared;
      car.riverwalkCleared = true;
      if (first) {
        car.loot += RIVERWALK_REWARD;
        car.wantedLevel = Math.min(MAX_WANTED_LEVEL, car.wantedLevel + 1);
      }
      io.to(room(s.carId)).emit('reward', {
        source: 'riverwalk_vault', amount: first ? RIVERWALK_REWARD : 0, loot: car.loot, wantedLevel: car.wantedLevel,
      });
      broadcastCar(s.carId);
    }
  }

  // Presage callbacks for whichever player currently holds the scanner.
  function scannerCallbacks(id) {
    const live = () => sessions.get(id);
    return {
      onStatus: () => { const s = live(); if (s) emitState(id, s); },
      onFace: (present) => {
        const s = live();
        if (!s) return;
        s.challenge.face(present, now());
        applyEvents(s, s.challenge.tick(now()));
        emitState(id, s);
      },
      onMetrics: (metrics) => {
        const s = live();
        if (!s) return;
        const { gestures, sawFace } = s.adapter.ingest(metrics);
        if (sawFace) s.challenge.face(true, now());
        for (const g of gestures) applyEvents(s, s.challenge.gesture(g, now()));
        applyEvents(s, s.challenge.tick(now()));
        emitState(id, s);
      },
    };
  }

  function releaseScanner(id, s) {
    if (!presage.isOwner(id)) return;
    presage.release(id);
    s?.adapter.reset();
  }

  io.on('connection', (socket) => {
    const id = socket.id;
    const s = { carId: 'solo', challenge: new RiverwalkChallenge(), adapter: new FaceSignalAdapter(), lastSent: null, lastFrameMs: 0 };
    sessions.set(id, s);
    socket.join(room(s.carId));

    socket.on('join_car', (data, ack) => {
      const carId = String(data?.carId || 'solo').slice(0, 40);
      socket.leave(room(s.carId));
      s.carId = carId;
      socket.join(room(carId));
      socket.emit('car_state', carDict(carId));
      ack?.({ ok: true });
    });

    socket.on('start_challenge', (...args) => {
      const ack = args.find((a) => typeof a === 'function');
      s.challenge.start(now());
      s.adapter.reset();
      ack?.(emitState(id, s, true));
    });

    socket.on('frame', (data, ack) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.isBuffer(data?.image) ? data.image : null;
      if (!bytes || bytes.length > MAX_FRAME_BYTES) return ack?.({ error: 'bad frame' });
      const clientMs = typeof data?.t === 'number' ? data.t : undefined;
      if (s.challenge.running) {
        s.lastFrameMs = Date.now();
        if (presage.isOwner(id) && presage.state === 'running') {
          if (presage.sendJpeg(id, bytes, clientMs)) s.challenge.frame(now());
        } else if (!presage.isBusyFor(id)) {
          presage.acquire(id, scannerCallbacks(id)).then((ok) => { if (ok) s.adapter.reset(); emitState(id, s); });
        }
        applyEvents(s, s.challenge.tick(now()));
      }
      ack?.(emitState(id, s));
    });

    socket.on('simulate', (data, ack) => {
      if (!devMode) return ack?.({ error: 'dev mode disabled' });
      const action = typeof data === 'object' ? data?.action : data;
      if (![...STEPS, 'fail'].includes(action)) return ack?.({ error: `unknown action ${action}` });
      applyEvents(s, s.challenge.simulate(action, now()));
      ack?.(emitState(id, s, true));
    });

    // Player left the checkpoint popup.
    socket.on('leave_checkpoint', (...args) => {
      releaseScanner(id, s);
      args.find((a) => typeof a === 'function')?.({ ok: true });
    });

    socket.on('reset_challenge', (...args) => {
      releaseScanner(id, s);
      s.challenge = new RiverwalkChallenge();
      args.find((a) => typeof a === 'function')?.(emitState(id, s, true));
    });

    // New run (game restart): zero the car's loot/wanted level and re-lock the vault.
    socket.on('reset_car', (...args) => {
      releaseScanner(id, s);
      cars.set(s.carId, { loot: 0, wantedLevel: 0, riverwalkCleared: false });
      s.challenge = new RiverwalkChallenge();
      broadcastCar(s.carId);
      args.find((a) => typeof a === 'function')?.({ ok: true });
    });

    socket.on('disconnect', () => {
      releaseScanner(id, s);
      sessions.delete(id);
    });
  });

  // Timers: pauses, step timeouts, and freeing the scanner when it's no longer needed.
  const ticker = setInterval(() => {
    for (const [id, s] of sessions) {
      if (s.challenge.running) applyEvents(s, s.challenge.tick(now()));
      const idle = Date.now() - s.lastFrameMs > SCANNER_IDLE_RELEASE_MS;
      if (presage.isOwner(id) && (!s.challenge.running || idle)) releaseScanner(id, s);
      if (s.challenge.running || presage.isOwner(id)) emitState(id, s);
    }
  }, TICK_MS);
  ticker.unref();

  return {
    httpServer, io, presage, cars, sessions, getCar,
    async close() {
      clearInterval(ticker);
      io.close();
      await presage.teardown;
    },
  };
}

// Run directly (npm start), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sdkModule = await loadPresageSdk();
  const app = await createApp({ sdkModule });
  const port = Number(process.env.PORT) || 5000;
  app.httpServer.listen(port, () => {
    console.log(`Riverwalk server on http://localhost:${port}`);
    console.log(`  Presage SDK: ${sdkModule ? `loaded v${sdkModule.sdk.SmartSpectraSDK.version}` : 'NOT loaded'}`
      + ` | API key: ${PRESAGE_API_KEY ? 'set' : 'MISSING (set PRESAGE_API_KEY in server/.env)'}`
      + ` | dev mode: ${DEV_MODE ? 'on' : 'off'}`);
  });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
