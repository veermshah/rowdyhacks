import { LANDMARKS } from './landmarkConfig.js';
import { toLocal } from './worldConfig.js';

// import.meta.env is Vite-only; plain Node (scripts/validate-*.mjs) imports this too.
const env = import.meta.env ?? {};

// Riverwalk server (see /server). Set VITE_HEIST_SERVER_URL on Vercel. For a demo
// with the server on your own laptop, open the game with ?server=http://localhost:5000
// (Chrome allows an https page to talk to localhost).
const serverParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('server') : null;
export const HEIST_SERVER_URL = serverParam || env.VITE_HEIST_SERVER_URL || 'http://localhost:5000';

// Dev-only UI inside the popup (Simulate buttons, sensor readout). On in
// `npm run dev`, off in production builds unless VITE_HEIST_DEV_TOOLS=true.
export const HEIST_DEV_TOOLS = !!env.DEV || env.VITE_HEIST_DEV_TOOLS === 'true';

// Riverwalk checkpoint: the challenge opens when the car gets within TRIGGER
// meters and can only re-open after it has driven back out past EXIT meters.
// The nearest drivable road (a bridge) passes ~4 m from this point.
export const RIVERWALK_POINT = toLocal(LANDMARKS.riverWalk.lat, LANDMARKS.riverWalk.lon);
export const RIVERWALK_TRIGGER_RADIUS = 30;
export const RIVERWALK_EXIT_RADIUS = 45;

// Alamo checkpoint (Challenge 1): same arrive/leave trigger pattern as the
// Riverwalk, but the challenge itself runs on the Raspberry Pi/Arduino vault
// hardware - this dashboard is the hacker's read-only status/Archive/code view.
// Unlike the Riverwalk (road passes ~4m away), the nearest drivable road here
// is ~78m from the landmark (`node scripts/validate-gameplay.mjs` reports the
// offset) - a 30m trigger radius can never be reached and the popup would
// never fire, so this needs a much wider radius than the Riverwalk's.
export const ALAMO_POINT = toLocal(LANDMARKS.alamo.lat, LANDMARKS.alamo.lon);
export const ALAMO_TRIGGER_RADIUS = 95;
export const ALAMO_EXIT_RADIUS = 120;

export const MAX_WANTED_LEVEL = 5;
// Each wanted star makes the police cruiser this much faster (5 stars = +25%).
export const WANTED_POLICE_SPEED_BONUS = 0.05;
