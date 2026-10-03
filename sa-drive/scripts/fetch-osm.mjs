/**
 * Fetch OpenStreetMap data for downtown San Antonio and convert to game JSON.
 * Run: node scripts/fetch-osm.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'public', 'data', 'downtown.json');

// Bounding box for downtown San Antonio
const SOUTH = 29.414;
const WEST = -98.495;
const NORTH = 29.430;
const EAST = -98.478;

// Geographic constants
const LAT0 = 29.4220;
const LON0 = -98.4870;
const LON_SCALE = 111320 * Math.cos(LAT0 * Math.PI / 180);
const LAT_SCALE = 110540;

function toLocal(lat, lon) {
  return {
    x: (lon - LON0) * LON_SCALE,
    z: -(lat - LAT0) * LAT_SCALE,
  };
}

// Road width fallbacks by highway type
const ROAD_WIDTHS = {
  motorway: 14, trunk: 14,
  primary: 12, primary_link: 8,
  secondary: 10, secondary_link: 7,
  tertiary: 9, tertiary_link: 6,
  residential: 7, living_street: 6,
  service: 5, unclassified: 7,
  pedestrian: 4, footway: 2,
  cycleway: 2, path: 1.5,
  track: 3,
};

const LANE_WIDTH = 3.2;

function parseWidth(widthStr) {
  if (!widthStr) return null;
  // Handle "12 m", "12m", "12", "40'" etc.
  const m = widthStr.match(/^([\d.]+)\s*(m|ft|')?$/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2] === 'ft' || m[2] === "'") val *= 0.3048;
  return val;
}

function getRoadWidth(tags) {
  // 1. Explicit width
  const w = parseWidth(tags.width);
  if (w) return w;
  // 2. Lanes
  if (tags.lanes) {
    const lanes = parseInt(tags.lanes);
    if (!isNaN(lanes) && lanes > 0) return lanes * LANE_WIDTH;
  }
  // 3. Highway type fallback
  return ROAD_WIDTHS[tags.highway] || 7;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const bbox = `${SOUTH},${WEST},${NORTH},${EAST}`;
const query = [
  '[out:json][timeout:60];',
  '(',
  `way["highway"](${bbox});`,
  `way["building"](${bbox});`,
  `relation["building"](${bbox});`,
  `way["waterway"](${bbox});`,
  `way["natural"="water"](${bbox});`,
  `relation["natural"="water"](${bbox});`,
  `way["leisure"="park"](${bbox});`,
  `relation["leisure"="park"](${bbox});`,
  `way["leisure"="garden"](${bbox});`,
  ');',
  'out body;',
  '>;',
  'out skel qt;',
].join('\n');

async function fetchOSM() {
  console.log('Fetching OSM data for downtown San Antonio...');

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'User-Agent': 'sa-drive/1.0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Response body:', body.slice(0, 500));
    throw new Error(`Overpass API error: ${res.status}`);
  }

  const data = await res.json();
  console.log(`Received ${data.elements.length} elements`);

  // Index nodes by ID
  const nodes = {};
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
  }

  // Process ways
  const roads = [];
  const buildings = [];
  const water = [];
  const parks = [];

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.tags) continue;

    const coords = (el.nodes || [])
      .map(nid => nodes[nid])
      .filter(Boolean)
      .map(n => toLocal(n.lat, n.lon));

    if (coords.length < 2) continue;

    if (el.tags.highway) {
      const hw = el.tags.highway;
      // Skip very minor paths for driving game
      if (['steps', 'corridor', 'elevator'].includes(hw)) continue;

      roads.push({
        id: el.id,
        type: hw,
        width: getRoadWidth(el.tags),
        points: coords,
        bridge: el.tags.bridge === 'yes',
        tunnel: el.tags.tunnel === 'yes',
        layer: parseInt(el.tags.layer) || 0,
        name: el.tags.name || null,
        lanes: parseInt(el.tags.lanes) || null,
      });
    } else if (el.tags.building) {
      const height = parseFloat(el.tags.height)
        || (parseInt(el.tags['building:levels']) || 0) * 3.3
        || null;

      buildings.push({
        id: el.id,
        points: coords,
        height,
        type: el.tags.building,
        levels: parseInt(el.tags['building:levels']) || null,
        minHeight: parseFloat(el.tags.min_height) || 0,
      });
    } else if (el.tags.waterway || el.tags.natural === 'water') {
      water.push({
        id: el.id,
        type: el.tags.waterway || 'water',
        points: coords,
      });
    } else if (el.tags.leisure === 'park' || el.tags.leisure === 'garden') {
      parks.push({
        id: el.id,
        type: el.tags.leisure,
        points: coords,
      });
    }
  }

  console.log(`Roads: ${roads.length}, Buildings: ${buildings.length}, Water: ${water.length}, Parks: ${parks.length}`);

  const result = {
    center: { lat: LAT0, lon: LON0 },
    bounds: { south: SOUTH, west: WEST, north: NORTH, east: EAST },
    roads,
    buildings,
    water,
    parks,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(result));

  const sizeMB = (Buffer.byteLength(JSON.stringify(result)) / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${OUTPUT} (${sizeMB} MB)`);
}

fetchOSM().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
