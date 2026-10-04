// Geographic center of downtown San Antonio
export const LAT0 = 29.4220;
export const LON0 = -98.4870;

// Bounding box
export const BOUNDS = {
  south: 29.414,
  west: -98.505,
  north: 29.430,
  east: -98.478,
};

// Conversion constants for this latitude
const LON_SCALE = 111320 * Math.cos(LAT0 * Math.PI / 180);
const LAT_SCALE = 110540;

/** Convert lat/lon to local meters (Three.js coords: +x=east, -z=north, +y=up) */
export function toLocal(lat, lon) {
  return {
    x: (lon - LON0) * LON_SCALE,
    z: -(lat - LAT0) * LAT_SCALE,
  };
}

/** Convert local meters back to lat/lon */
export function toGeo(x, z) {
  return {
    lat: LAT0 + (-z) / LAT_SCALE,
    lon: LON0 + x / LON_SCALE,
  };
}

// Ground and sky colors
export const SKY_COLOR = '#070f20';
export const GROUND_COLOR = '#172d30';
export const FOG_COLOR = '#070f20';
export const FOG_NEAR = 100;
export const FOG_FAR = 600;
