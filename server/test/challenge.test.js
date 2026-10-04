import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiverwalkChallenge, RULES } from '../src/challenge.js';

// Drive a challenge with live-camera style input at 30 fps.
function live() {
  const c = new RiverwalkChallenge();
  let t = 100;
  const events = [];
  c.face(true, t);
  c.start(t);
  const api = {
    c, events,
    get t() { return t; },
    run(seconds, { face = true } = {}) {
      for (let i = 0; i < Math.round(seconds * 30); i++) {
        t += 1 / 30;
        c.frame(t);
        c.face(face, t);
        events.push(...c.tick(t));
      }
      return api;
    },
    g(name) { events.push(...c.gesture(name, t)); return api; },
    get step() { return c.snapshot(t).step; },
  };
  return api;
}

test('live happy path: face -> nod -> blink x2 -> smile completes', () => {
  const s = live().run(0.6);
  assert.equal(s.step, 'nod');
  s.g('nod');
  assert.equal(s.step, 'blink');
  s.g('blink').run(0.3).g('blink');
  assert.equal(s.step, 'smile');
  s.g('smile');
  assert.equal(s.c.status, 'complete');
  assert.deepEqual(s.events, ['complete']);
  assert.ok(Object.values(s.c.snapshot(s.t).checklist).every(Boolean));
});

test('out-of-order gestures are ignored: no progress, no failure', () => {
  const s = live().run(0.6);
  s.g('smile').g('blink').g('blink');
  assert.equal(s.step, 'nod');
  s.g('nod').g('nod').g('smile');
  assert.equal(s.step, 'blink');
  assert.equal(s.c.blinks, 0);
  assert.equal(s.c.failures, 0);
  assert.deepEqual(s.events, []);
});

test('face step needs the face held briefly', () => {
  const s = live().run(0.2);
  assert.equal(s.step, 'face');
  s.run(0.5);
  assert.equal(s.step, 'nod');
});

test('step timeout counts as a failure and resets the sequence', () => {
  const s = live().run(0.6).g('nod').run(RULES.STEP_TIMEOUT_S + 0.5);
  assert.deepEqual(s.events, ['failed']);
  assert.equal(s.c.failures, 1);
  assert.equal(s.step, 'face');
});

test('three failures trip the alarm', () => {
  const c = new RiverwalkChallenge();
  const ev = [];
  for (let i = 0; i < 3; i++) ev.push(...c.simulate('fail', i));
  assert.equal(c.status, 'alarm');
  assert.deepEqual(ev, ['failed', 'failed', 'failed', 'alarm']);
});

test('losing the face pauses and freezes the timer without failing', () => {
  const s = live().run(0.6);
  const before = s.c.snapshot(s.t).timeLeft;
  s.run(30, { face: false });
  assert.equal(s.c.status, 'paused');
  s.run(0.1);
  assert.equal(s.c.status, 'active');
  assert.equal(s.c.failures, 0);
  assert.ok(s.c.snapshot(s.t).timeLeft >= before - 1.5);
  assert.equal(s.step, 'nod');
});

test('camera feed dropping pauses; it resumes when frames return', () => {
  const s = live().run(0.6);
  for (let i = 0; i < 5; i++) s.c.tick(s.t + 2 + i); // no frames for several seconds
  assert.equal(s.c.status, 'paused');
  s.run(0.1);
  assert.equal(s.c.status, 'active');
  assert.equal(s.c.failures, 0);
});

test('two blinks too far apart restart the pair (not a failure)', () => {
  const s = live().run(0.6).g('nod').run(0.1).g('blink').run(RULES.DOUBLE_BLINK_WINDOW_S + 0.5).g('blink');
  assert.equal(s.step, 'blink');
  assert.equal(s.c.blinks, 1);
  assert.equal(s.c.failures, 0);
});

test('simulated runs never time out', () => {
  const c = new RiverwalkChallenge();
  c.simulate('face', 0);
  assert.deepEqual(c.tick(1000), []);
  assert.equal(c.snapshot(1000).step, 'nod');
});

test('restart after alarm clears failures', () => {
  const c = new RiverwalkChallenge();
  for (let i = 0; i < 3; i++) c.simulate('fail', 0);
  c.start(1);
  assert.equal(c.status, 'active');
  assert.equal(c.failures, 0);
});
