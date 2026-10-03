import { isDrivable } from '../config/roadConfig.js';
/**
 * Spatial grid for fast road proximity queries.
 * Cell size ~20m. Each road segment is registered in nearby cells.
 */
const CELL_SIZE = 20;

function cellKey(cx, cz) {
  return `${cx},${cz}`;
}

function toCell(x, z) {
  return {
    cx: Math.floor(x / CELL_SIZE),
    cz: Math.floor(z / CELL_SIZE),
  };
}

export function buildRoadGrid(roads) {
  const grid = new Map();

  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    if (!isDrivable(road)) continue;
    const pts = road.points;

    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x, az = pts[i].z;
      const bx = pts[i + 1].x, bz = pts[i + 1].z;

      const pad = road.width / 2 + 4;
      for (let cx = Math.floor((Math.min(ax,bx)-pad)/CELL_SIZE); cx <= Math.floor((Math.max(ax,bx)+pad)/CELL_SIZE); cx++) {
        for (let cz = Math.floor((Math.min(az,bz)-pad)/CELL_SIZE); cz <= Math.floor((Math.max(az,bz)+pad)/CELL_SIZE); cz++) {
          const key = cellKey(cx,cz);
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push({ ri, si:i, ax,az,bx,bz,width:road.width });
        }
      }
    }
  }

  return grid;
}

/**
 * Find distance from point to nearest road segment.
 * Returns { distance, onRoad, nearestX, nearestZ }
 */
export function queryNearestRoad(grid, x, z) {
  const { cx, cz } = toCell(x, z);
  const key = cellKey(cx, cz);
  const cell = grid.get(key);

  if (!cell || cell.length === 0) {
    return { distance: Infinity, onRoad: false, nearestX: x, nearestZ: z };
  }

  let minDist = Infinity;
  let bestNx = x, bestNz = z;
  let onRoad = false;

  for (const seg of cell) {
    const { ax, az, bx, bz, width } = seg;

    // Project point onto segment
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;

    if (len2 < 0.001) continue;

    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));

    const nx = ax + t * dx;
    const nz = az + t * dz;
    const dist = Math.sqrt((x - nx) * (x - nx) + (z - nz) * (z - nz));

    if (dist <= width / 2) onRoad = true;
    if (dist < minDist) {
      minDist = dist;
      bestNx = nx;
      bestNz = nz;

    }
  }

  return {
    distance: minDist,
    onRoad,
    nearestX: bestNx,
    nearestZ: bestNz,
  };
}

/**
 * Find a good spawn point near given coordinates — snap to nearest road.
 */
export function findSpawnPoint(grid, roads, targetX, targetZ) {
  const result = queryNearestRoad(grid, targetX, targetZ);

  if (result.distance === Infinity) {
    return { x: targetX, z: targetZ, yaw: 0 };
  }

  // Find the road segment to determine heading
  const { cx, cz } = toCell(result.nearestX, result.nearestZ);
  const key = cellKey(cx, cz);
  const cell = grid.get(key) || [];

  let bestSeg = null;
  let bestDist = Infinity;

  for (const seg of cell) {
    const { ax, az, bx, bz } = seg;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const d = Math.sqrt(
      (result.nearestX - mx) ** 2 + (result.nearestZ - mz) ** 2
    );
    if (d < bestDist) {
      bestDist = d;
      bestSeg = seg;
    }
  }

  let yaw = 0;
  if (bestSeg) {
    const dx = bestSeg.bx - bestSeg.ax;
    const dz = bestSeg.bz - bestSeg.az;
    yaw = Math.atan2(dx, dz);
  }

  return { x: result.nearestX, z: result.nearestZ, yaw };
}
