// Heist state shared by the HUD and the Riverwalk challenge, backed by the
// Flask-SocketIO server. The server is the source of truth for cash, wanted
// level and the challenge state machine; this module mirrors it and pushes the
// bits the driving game needs (pause, wanted level) into `game`.
import { useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import { HEIST_SERVER_URL, PRESAGE_SERVER_URL } from '../config/heistConfig.js';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { game, alertPolice } from './runtime.js';

const carId = new URLSearchParams(window.location.search).get('car') || 'solo';

let state = {
  connected: false,
  riverwalkConnected: false, // the server running the Riverwalk (Presage server if ?presage= is set)
  carId,
  cash: 0,
  wantedLevel: 0,
  riverwalkCleared: false,
  riverwalkOpen: false,
  riverwalkReplay: false, // replaying an already-cleared Riverwalk (Play again)
  openReason: null, // 'arrived' | 'dev'
  challenge: null,
  alarm: null,
  lastReward: null,
  // Challenge 1 - Alamo vault. The hardware (Pi + Arduino) runs the actual
  // safecracking (the "camera" is a light sensor); this dashboard is a
  // read-only view of its state plus the Archive/hints, which the server
  // only sends to non-Pi ("hacker") clients. The code itself is typed here.
  alamoCleared: false,
  alamoCode: null,
  alamoOpen: false,
  alamoOpenReason: null, // 'arrived' | 'dev'
  alamo: null, // latest `alamo_state` snapshot ({substage, route, hintsScreen, ...})
  // Challenge 3 - Tower. The crew phones the bank's voice agent; the server
  // sends a one-time code to the vault LCD and the crew keys it in on the
  // joystick. This dashboard is a read-only view (the code is never sent here).
  towerCleared: false,
  towerCode: null,
  towerOpen: false,
  towerOpenReason: null, // 'arrived' | 'dev'
  tower: null, // latest `tower_state` snapshot ({substage, otpStatus, otpRemainingS, ...})
};
const listeners = new Set();
let socket = null;
// Riverwalk-only connection to a separate Presage server (PRESAGE_SERVER_URL,
// e.g. a laptop behind a Cloudflare tunnel). Null = the Riverwalk uses `socket`.
let presageSocket = null;
const riverwalkSocket = () => presageSocket ?? socket;

function set(patch) {
  state = { ...state, ...patch };
  game.paused = state.riverwalkOpen || state.alamoOpen || state.towerOpen;
  game.wantedLevel = state.wantedLevel;
  listeners.forEach((l) => l());
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getHeist = () => state;
export const useHeist = () => useSyncExternalStore(subscribe, getHeist);

const applySnapshot = (snap) => {
  if (snap && !snap.error) set({ challenge: snap });
};

export function connectHeist() {
  if (socket) return;
  socket = io(HEIST_SERVER_URL, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    set(presageSocket ? { connected: true } : { connected: true, riverwalkConnected: true });
    socket.emit('join_car', { carId, role: 'driver' });
    if (!presageSocket && state.riverwalkOpen && !state.challenge) socket.emit('start_challenge', applySnapshot);
  });
  socket.on('disconnect', () => set(presageSocket ? { connected: false } : { connected: false, riverwalkConnected: false }));
  socket.on('car_state', (c) => set({
    cash: c.loot, wantedLevel: c.wantedLevel, riverwalkCleared: c.riverwalkCleared,
    alamoCleared: c.alamoCleared, alamoCode: c.alamoCode,
    towerCleared: c.towerCleared, towerCode: c.towerCode,
  }));
  socket.on('challenge_state', (snap) => { if (!presageSocket) applySnapshot(snap); });
  socket.on('alamo_state', (snap) => set({ alamo: snap }));
  socket.on('tower_state', (snap) => set({ tower: snap }));
  socket.on('alarm', (alarm) => {
    set({ alarm, wantedLevel: alarm.wantedLevel });
    alertPolice();
  });
  socket.on('reward', (reward) => set({ lastReward: reward, cash: reward.loot, wantedLevel: reward.wantedLevel ?? state.wantedLevel }));

  if (PRESAGE_SERVER_URL) connectPresage();
}

// Riverwalk on the Presage server. Its outcomes are relayed to the main server
// so loot and wanted level stay in the one shared total (and Alamo/Tower see them).
function connectPresage() {
  presageSocket = io(PRESAGE_SERVER_URL, {
    // Start on HTTP long-polling and upgrade to WebSocket when the tunnel allows
    // it. ngrok's free plan answers browser requests with a warning page unless
    // this header is sent - possible on polling requests (browsers can't add
    // headers to WebSockets), so polling keeps working either way.
    transports: ['polling', 'websocket'],
    extraHeaders: { 'ngrok-skip-browser-warning': '1' },
  });
  presageSocket.on('connect', () => {
    set({ riverwalkConnected: true });
    presageSocket.emit('join_car', { carId, role: 'driver' });
    if (state.riverwalkOpen && !state.challenge) presageSocket.emit('start_challenge', applySnapshot);
  });
  presageSocket.on('disconnect', () => set({ riverwalkConnected: false }));
  presageSocket.on('challenge_state', applySnapshot);
  // Cleared on the Presage server: the main server pays out (once per car) and
  // broadcasts 'reward' + 'car_state', which update the HUD.
  presageSocket.on('reward', (reward) => {
    if (reward?.source === 'riverwalk_vault') socket?.emit('riverwalk_complete');
  });
  // Three failed attempts: the main server raises the wanted level and
  // broadcasts 'alarm', which alerts the police.
  presageSocket.on('alarm', (alarm) => socket?.emit('riverwalk_alarm', { reason: alarm?.reason }));
}

export function disconnectHeist() {
  socket?.disconnect();
  socket = null;
  presageSocket?.disconnect();
  presageSocket = null;
  set({ connected: false, riverwalkConnected: false });
}

export function openRiverwalk(reason) {
  if (state.riverwalkOpen) return;
  // Park the car at the checkpoint while the popup is up.
  car.v = 0;
  Object.assign(input, { gas: 0, brake: 0, steer: 0 });
  set({ riverwalkOpen: true, openReason: reason, alarm: null, lastReward: null, challenge: null, riverwalkReplay: false });
  if (!state.riverwalkCleared) riverwalkSocket()?.emit('start_challenge', applySnapshot);
}

/**
 * Play a finished Riverwalk again. The puzzle runs from the start; this run's
 * vault loot was already paid, so finishing again pays nothing (no farming).
 * A full game restart (R) still re-locks the vault with fresh loot.
 */
export function replayRiverwalk() {
  set({ riverwalkReplay: true, alarm: null, lastReward: null, challenge: null });
  riverwalkSocket()?.emit('start_challenge', applySnapshot);
}

export function closeRiverwalk() {
  set({ riverwalkOpen: false });
  riverwalkSocket()?.emit('leave_checkpoint'); // free the Presage scanner for other players
}

export function restartChallenge() {
  set({ alarm: null });
  riverwalkSocket()?.emit('start_challenge', applySnapshot);
}

export function simulate(action) {
  riverwalkSocket()?.emit('simulate', { action }, applySnapshot);
}

/** Dev: wipe this run's heist (loot, wanted level, vault) and restart the checkpoint; the popup stays open. */
export function devReplayRiverwalk() {
  presageSocket?.emit('reset_car');
  socket?.emit('reset_car', () => {
    set({ alarm: null, lastReward: null, challenge: null, cash: 0, wantedLevel: 0, riverwalkCleared: false });
    riverwalkSocket()?.emit('start_challenge', applySnapshot);
  });
}

export function devResetCar() {
  presageSocket?.emit('reset_car');
  socket?.emit('reset_car', () => {
    set({ alarm: null, lastReward: null, challenge: null });
    if (state.riverwalkOpen) riverwalkSocket()?.emit('start_challenge', applySnapshot);
  });
}

export function submitNfc(payload) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: 'Heist server offline.' });
    socket.timeout(5000).emit('nfc_scan', { payload }, (err, res) =>
      resolve(err ? { ok: false, error: 'Server did not respond.' } : res)
    );
  });
}

/** New run (game restarted): close the popup and wipe this car's loot, wanted level and vault. */
export function resetHeistRun() {
  set({
    riverwalkOpen: false, alarm: null, lastReward: null, challenge: null, cash: 0, wantedLevel: 0, riverwalkCleared: false,
    towerOpen: false, towerCleared: false, towerCode: null, tower: null,
  });
  socket?.emit('reset_car');
  presageSocket?.emit('reset_car');
}

/**
 * Send one JPEG frame to the Presage scanner (the server timestamps it on
 * arrival). Calls done() when the server has answered (or timed out).
 */
export function sendFrame(buf, done) {
  const rs = riverwalkSocket();
  if (!rs?.connected) return done();
  rs.timeout(3000).emit('frame', { image: buf }, (err, snap) => {
    if (!err) applySnapshot(snap);
    done();
  });
}

// ── Alamo vault challenge ──────────────────────────────────────────────

export function openAlamo(reason) {
  if (state.alamoOpen) return;
  car.v = 0;
  Object.assign(input, { gas: 0, brake: 0, steer: 0 });
  set({ alamoOpen: true, alamoOpenReason: reason });
  if (!state.alamoCleared) socket?.emit('alamo_start');
}

export function closeAlamo() {
  socket?.emit('vault_close');
  set({ alamoOpen: false });
}

export function alamoRequestHint() {
  socket?.emit('alamo_request_hint');
}

/** Phase 2 code entry (from the website, not the Pi). Resolves {ok, correct}. */
export function alamoSubmitCode(code) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, correct: false });
    socket.emit('alamo_submit_code', { code }, (res) => resolve(res || { ok: false, correct: false }));
  });
}

/** Ask the Raspberry Pi to repeat the hidden keyword without revealing it. */
export function alamoRepeatKeyword() {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: 'Heist server offline.' });
    socket.emit('alamo_repeat_keyword', (res) => resolve(res || { ok: false }));
  });
}

export function alamoAdminSkip() {
  socket?.emit('alamo_admin_skip');
}

export function alamoAdminReset() {
  socket?.emit('alamo_admin_reset');
}

/** Dev simulator standing in for the Pi: {device: 'joystick'|'light', value}. */
export function alamoSimInput(device, value) {
  socket?.emit('alamo_sim_input', { device, value });
}

export function alamoAdminShowSequence(show) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.emit('alamo_admin_show_sequence', { show }, (res) => resolve(res?.sequence ?? null));
  });
}

export function alamoAdminShowCode(show) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.emit('alamo_admin_show_code', { show }, (res) => resolve(res?.code ?? null));
  });
}

// ── Tower challenge (Challenge 3) ──────────────────────────────────────

export function openTower(reason) {
  if (state.towerOpen) return;
  car.v = 0;
  Object.assign(input, { gas: 0, brake: 0, steer: 0 });
  set({ towerOpen: true, towerOpenReason: reason });
  if (!state.towerCleared) socket?.emit('tower_start');
}

export function closeTower() {
  socket?.emit('vault_close');
  set({ towerOpen: false });
}

export function towerAdminSkip() {
  socket?.emit('tower_admin_skip');
}

export function towerAdminReset() {
  socket?.emit('tower_admin_reset');
}

/** Dev simulator standing in for the Pi: {device: 'joystick'|'button', value}. */
export function towerSimInput(device, value) {
  socket?.emit('tower_sim_input', { device, value });
}

/** Dev: the live one-time code (DEV_MODE servers only), for the dev panel. */
export function towerAdminShowCode(show) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    socket.emit('tower_admin_show_code', { show }, (res) => resolve(res?.code ?? null));
  });
}

/**
 * Dev: calls one of Margaret's webhook tools exactly as ElevenLabs would
 * (POST /api/tower/<path>), so the whole server path gets exercised without a
 * phone. Resolves {status, body}. Servers with TOWER_WEBHOOK_SECRET set will 401.
 */
export async function towerDevWebhook(path, body = {}) {
  try {
    const res = await fetch(`${HEIST_SERVER_URL}/api/tower/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carId, ...body }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}
