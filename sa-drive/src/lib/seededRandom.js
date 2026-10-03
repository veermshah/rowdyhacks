/**
 * Seeded random number generator based on a numeric seed.
 * Deterministic — same seed always produces same sequence.
 * Used for building heights, colors, etc. to ensure identical city on every reload.
 */
export function seededRandom(seed) {
  let s = seed | 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Get a seeded random from an OSM ID */
export function fromOsmId(osmId) {
  return seededRandom(osmId);
}
