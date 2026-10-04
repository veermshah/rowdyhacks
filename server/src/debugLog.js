// Presage / Riverwalk diagnostics. Off unless the server runs with --debug or
// PRESAGE_DEBUG=1. Each event goes to the console as one readable line and to
// logs/presage-debug-<time>.jsonl (one JSON object per line) for sharing.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const fmt = (v) => {
  if (Array.isArray(v)) return `[${v.map(fmt).join(' ')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}:${fmt(x)}`).join(' ')}}`;
  return String(v);
};

export function createDebugLog({ enabled, dir }) {
  if (!enabled) {
    const off = () => {};
    off.enabled = false;
    off.file = null;
    return off;
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `presage-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const t0 = performance.now();
  const log = (event, data = {}) => {
    const t = Math.round(performance.now() - t0) / 1000;
    try {
      appendFileSync(file, `${JSON.stringify({ t, time: new Date().toISOString(), event, ...data })}\n`);
    } catch {
      // never let logging break the game
    }
    const details = Object.entries(data).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
    console.log(`[debug ${t.toFixed(2)}s] ${event}${details ? ` ${details}` : ''}`);
  };
  log.enabled = true;
  log.file = file;
  return log;
}
