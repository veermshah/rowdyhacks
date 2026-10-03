/**
 * Convert a polyline + width into a ribbon (flat quad strip) geometry.
 * Returns { positions, indices } for BufferGeometry.
 */
export function buildRibbon(points, width, yOffset = 0) {
  if (points.length < 2) return null;

  const positions = [];
  const indices = [];

  const hw = width / 2;

  for (let i = 0; i < points.length; i++) {
    // Direction vector
    let dx, dz;
    if (i === 0) {
      dx = points[1].x - points[0].x;
      dz = points[1].z - points[0].z;
    } else if (i === points.length - 1) {
      dx = points[i].x - points[i - 1].x;
      dz = points[i].z - points[i - 1].z;
    } else {
      dx = points[i + 1].x - points[i - 1].x;
      dz = points[i + 1].z - points[i - 1].z;
    }

    // Normalize
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) {
      dx = 1; dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }

    // Perpendicular (right side)
    const px = -dz;
    const pz = dx;

    // Left and right vertices
    positions.push(
      points[i].x - px * hw, yOffset, points[i].z - pz * hw,
      points[i].x + px * hw, yOffset, points[i].z + pz * hw,
    );

    // Indices (two triangles per segment)
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(
        base, base + 1, base + 2,
        base + 1, base + 3, base + 2,
      );
    }
  }

  return { positions: new Float32Array(positions), indices };
}

/**
 * Merge multiple ribbons into a single geometry.
 */
export function mergeRibbons(ribbons) {
  let totalVerts = 0;
  let totalIdx = 0;

  for (const r of ribbons) {
    if (!r) continue;
    totalVerts += r.positions.length;
    totalIdx += r.indices.length;
  }

  const positions = new Float32Array(totalVerts);
  const indices = [];
  let vOffset = 0;
  let iVertOffset = 0;

  for (const r of ribbons) {
    if (!r) continue;
    positions.set(r.positions, vOffset);
    for (const idx of r.indices) {
      indices.push(idx + iVertOffset);
    }
    vOffset += r.positions.length;
    iVertOffset += r.positions.length / 3;
  }

  return { positions, indices };
}
