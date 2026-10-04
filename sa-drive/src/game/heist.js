// Heist state shared by the HUD and the Riverwalk challenge, backed by the
// Flask-SocketIO server. The server is the source of truth for cash, wanted
// level and the challenge state machine; this module mirrors it and pushes the
// bits the driving game needs (pause, wanted level) into `game`.
import { useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import { HEIST_SERVER_URL } from '../config/heistConfig.js';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { game, alertPolice } from './runtime.js';

const carId = new URLSearchParams(window.location.search).get('car') || 'solo';

let state = {
  connected: false,
  carId,
  cash: 0,
  wantedLevel: 0,
  riverwalkCleared: false,
  riverwalkOpen: false,
  openReason: null, // 'arrived'
  challenge: null,
  alarm: null,
  lastReward: null,
};
const listeners = new Set();
let socket = null;

function set(patch) {
  state = { ...state, ...patch };
  game.paused = state.riverwalkOpen;
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
    set({ connected: true });
    socket.emit('join_car', { carId, role: 'driver' });
    if (state.riverwalkOpen && !state.challenge) socket.emit('start_challenge', applySnapshot);
  });
  socket.on('disconnect', () => set({ connected: false }));
  socket.on('car_state', (c) => set({ cash: c.loot, wantedLevel: c.wantedLevel, riverwalkCleared: c.riverwalkCleared }));
  socket.on('challenge_state', applySnapshot);
  socket.on('alarm', (alarm) => {
    set({ alarm, wantedLevel: alarm.wantedLevel });
    alertPolice();
  });
  socket.on('reward', (reward) => set({ lastReward: reward, cash: reward.loot, wantedLevel: reward.wantedLevel ?? state.wantedLevel }));
}

export function disconnectHeist() {
  socket?.disconnect();
  socket = null;
  set({ connected: false });
}

export function openRiverwalk(reason) {
  if (state.riverwalkOpen) return;
  // Park the car at the checkpoint while the popup is up.
  car.v = 0;
  Object.assign(input, { gas: 0, brake: 0, steer: 0 });
  set({ riverwalkOpen: true, openReason: reason, alarm: null, lastReward: null, challenge: null });
  if (!state.riverwalkCleared) socket?.emit('start_challenge', applySnapshot);
}

export function closeRiverwalk() {
  set({ riverwalkOpen: false });
  socket?.emit('leave_checkpoint'); // free the Presage scanner for other players
}

export function restartChallenge() {
  set({ alarm: null });
  socket?.emit('start_challenge', applySnapshot);
}

export function simulate(action) {
  socket?.emit('simulate', { action }, applySnapshot);
}

/** New run (game restarted): close the popup and wipe this car's loot, wanted level and vault. */
export function resetHeistRun() {
  set({ riverwalkOpen: false, alarm: null, lastReward: null, challenge: null, cash: 0, wantedLevel: 0, riverwalkCleared: false });
  socket?.emit('reset_car');
}

/**
 * Send one JPEG frame to the Presage scanner (the server timestamps it on
 * arrival). Calls done() when the server has answered (or timed out).
 */
export function sendFrame(buf, done) {
  if (!socket?.connected) return done();
  socket.timeout(3000).emit('frame', { image: buf }, (err, snap) => {
    if (!err) applySnapshot(snap);
    done();
  });
}

