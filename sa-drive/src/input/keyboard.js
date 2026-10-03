import { input } from './input.js';

const keys = {};

function onKeyDown(e) {
  keys[e.code] = true;
  updateInput();
}

function onKeyUp(e) {
  keys[e.code] = false;
  updateInput();
}

function updateInput() {
  if (input.mode !== 'keyboard') return;

  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const up = keys['KeyW'] || keys['ArrowUp'];
  const down = keys['KeyS'] || keys['ArrowDown'];

  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
  input.reverse = !!keys['KeyX'];
  input.gas = (up || keys['KeyX']) ? 1 : 0;
  input.brake = down ? 1 : 0;
}

function clearKeys(){for(const key of Object.keys(keys))delete keys[key];updateInput();}

export function initKeyboard() {
  window.addEventListener('blur',clearKeys);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

export function cleanupKeyboard() {
  window.removeEventListener('blur',clearKeys);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
}
