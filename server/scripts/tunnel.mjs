// npm run tunnel
// Opens a Cloudflare quick tunnel to the local Presage server, prints the
// shareable game link (and copies it to the clipboard), and keeps it alive:
// if the tunnel dies (Wi-Fi change, sleep) it starts a new one and prints the
// new link. Quick-tunnel addresses change on every restart; this just saves
// you from fishing the new one out of cloudflared's logs.
//
// Options (env vars): GAME_URL (default https://rowdyhacks-hackutd.vercel.app),
// PRESAGE_PORT (default 5001), CLOUDFLARED (path to the cloudflared binary).
import { spawn, spawnSync } from 'node:child_process';

const GAME_URL = (process.env.GAME_URL || 'https://rowdyhacks-hackutd.vercel.app').replace(/\/+$/, '');
const PORT = Number(process.env.PRESAGE_PORT) || 5001;
const CLOUDFLARED = process.env.CLOUDFLARED || 'cloudflared';
const CHECK_EVERY_MS = 15_000;
const FAILS_BEFORE_RESTART = 3;

let child = null;
let tunnelUrl = null;
let fails = 0;
let stopping = false;

const stamp = () => new Date().toLocaleTimeString();

function copyToClipboard(text) {
  const cmd = process.platform === 'win32' ? ['clip'] : process.platform === 'darwin' ? ['pbcopy'] : null;
  if (!cmd) return false;
  return spawnSync(cmd[0], cmd.slice(1), { input: text }).status === 0;
}

function announce(url) {
  const link = `${GAME_URL}/?presage=${url}`;
  const copied = copyToClipboard(link);
  console.log('\n' + '='.repeat(78));
  console.log(` [${stamp()}] Presage tunnel is up`);
  console.log(`   Tunnel:  ${url}`);
  console.log(`   SHARE THIS LINK${copied ? ' (copied to clipboard)' : ''}:`);
  console.log(`   ${link}`);
  console.log(`   Local test: http://localhost:5173/?presage=${url}`);
  console.log('='.repeat(78) + '\n');
}

function start() {
  tunnelUrl = null;
  fails = 0;
  console.log(`[${stamp()}] starting cloudflared -> http://localhost:${PORT} ...`);
  child = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (e) => {
    console.error(`[${stamp()}] could not run cloudflared (${e.message}).`);
    console.error('  Install it: winget install --id Cloudflare.cloudflared  (or set CLOUDFLARED=<path to cloudflared.exe>)');
    process.exit(1);
  });
  const onData = (buf) => {
    const text = buf.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) tunnelUrl = m[0];
    if (/Registered tunnel connection/.test(text) && tunnelUrl) announce(tunnelUrl);
    if (/Allow outbound (TCP|QUIC) .*7844/.test(text)) {
      console.error(`[${stamp()}] this network blocks Cloudflare's tunnel port (7844) - switch Wi-Fi or use a phone hotspot.`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    console.log(`[${stamp()}] cloudflared exited (code ${code}); restarting in 3 s ...`);
    setTimeout(start, 3000);
  });
}

// Watchdog: a quick tunnel that lost its connection never comes back (Cloudflare
// error 1016), so after a few failed health checks start a fresh one.
setInterval(async () => {
  if (!tunnelUrl || !child) return;
  // If the Presage server itself is down, a new tunnel won't help (and would change the link).
  try {
    await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(3_000) });
  } catch {
    console.log(`[${stamp()}] Presage server isn't answering on port ${PORT} - start it: $env:PORT=${PORT}; npm start`);
    fails = 0;
    return;
  }
  try {
    const res = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fails = 0;
  } catch (e) {
    fails += 1;
    console.log(`[${stamp()}] tunnel check failed (${fails}/${FAILS_BEFORE_RESTART}): ${e.message}`);
    if (fails >= FAILS_BEFORE_RESTART) {
      console.log(`[${stamp()}] tunnel looks dead - starting a new one (the link will change).`);
      child.kill();
    }
  }
}, CHECK_EVERY_MS).unref();

const stop = () => {
  stopping = true;
  child?.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start();
