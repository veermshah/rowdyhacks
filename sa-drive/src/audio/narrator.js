// Plays the pre-recorded story clips (see config/storyLines.js). Each line plays
// at most once per run, lines queue instead of talking over each other, and a
// missing clip just shows its caption for a reading-length moment.
import { STORY_AUDIO_DIR, STORY_AUDIO_EXTENSIONS, STORY_LINES } from '../config/storyLines.js';

const played = new Set();
const queue = [];
const listeners = new Set();
let current = null; // { id, text, audio }
let muted = false;
let captionTimer = null;

// Stable snapshot for useSyncExternalStore: a new object only when the line changes
// (returning a fresh object on every read makes React re-render forever).
let snapshot = null;
const emit = () => {
  snapshot = current ? { id: current.id, text: current.text, hasAudio: !!current.hasAudio } : null;
  listeners.forEach((l) => l());
};
export const subscribeNarration = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** The line being spoken right now ({ id, text, hasAudio }) or null. */
export const currentNarration = () => snapshot;
/** True while a line is playing (the driving audio ducks the music). */
export const isNarrating = () => current != null;

export function setNarrationMuted(value) {
  muted = !!value;
  if (current?.audio) current.audio.muted = muted;
}

/** Queue a story line by id. Ignored if it already played this run. */
export function narrate(id, { interrupt = false } = {}) {
  if (!STORY_LINES[id] || played.has(id)) return;
  played.add(id);
  if (interrupt) {
    queue.length = 0;
    stopCurrent();
  }
  queue.push(id);
  if (!current) playNext();
}

/** New run: forget what played, stop talking. */
export function resetNarration() {
  played.clear();
  queue.length = 0;
  stopCurrent();
}

function stopCurrent() {
  clearTimeout(captionTimer);
  if (current?.audio) {
    current.audio.onended = current.audio.onerror = current.audio.onplaying = null;
    current.audio.pause();
  }
  current = null;
  emit();
}

function finish() {
  clearTimeout(captionTimer);
  current = null;
  emit();
  playNext();
}

function playNext() {
  const id = queue.shift();
  if (!id) return;
  const text = STORY_LINES[id];
  current = { id, text, audio: null };
  emit();
  tryExtension(id, 0);
}

// Try <id>.mp3, then <id>.m4a; with no clip at all, show the caption only.
function tryExtension(id, i) {
  if (current?.id !== id) return;
  if (i >= STORY_AUDIO_EXTENSIONS.length) {
    current.audio = null;
    captionTimer = setTimeout(finish, Math.min(9000, 1500 + current.text.length * 55));
    return;
  }
  const audio = new Audio(`${STORY_AUDIO_DIR}/${id}.${STORY_AUDIO_EXTENSIONS[i]}`);
  audio.muted = muted;
  current.audio = audio;
  audio.onended = finish;
  audio.onplaying = () => {
    if (current?.id === id && !current.hasAudio) {
      current.hasAudio = true;
      emit();
    }
  };
  audio.onerror = () => tryExtension(id, i + 1);
  // Autoplay can still be refused before the first click/keypress: keep the caption up.
  audio.play().catch((e) => {
    if (e?.name === 'NotAllowedError' && current?.id === id) {
      captionTimer = setTimeout(finish, Math.min(9000, 1500 + current.text.length * 55));
    }
  });
}
