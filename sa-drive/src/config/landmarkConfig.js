import { toLocal } from './worldConfig.js';
export const LANDMARKS = {
  alamo: {
    // West-facing nave aligned to OSM church 92060042.
    lat: 29.425722000,
    lon: -98.486198519,
    headingDeg: -90,
    scale: 1,
    anchorOffset: { x: 0, y: 0, z: 0 },
  },
  towerOfAmericas: {
    lat: 29.4189,
    lon: -98.4837,
    headingDeg: 0,
    scale: 1,
    anchorOffset: { x: 0, y: 0, z: 0 },
  },
  riverWalk: {
    // Snapped to the existing OSM river centerline at the downtown bend.
    lat: 29.422661001,
    lon: -98.489610059,
    headingDeg: 0,
    scale: 1,
    anchorOffset: { x: 0, y: 0, z: 0 },
  },
};

// Replace the exported tower podium with its dedicated low-rise model.
export const LANDMARK_OSM_REPLACEMENTS = new Set([78485919,92060042]);
export function landmarkObstacles() {
  const shape=(key,points)=>{const cfg=LANDMARKS[key],c=toLocal(cfg.lat,cfg.lon),angle=cfg.headingDeg*Math.PI/180;return {points:points.map(([x,z])=>({x:c.x+x*Math.cos(angle)+z*Math.sin(angle),z:c.z-x*Math.sin(angle)+z*Math.cos(angle)}))};};
  return [shape('alamo',[[-11.8,-25],[11.8,-25],[11.8,8.5],[-11.8,8.5]]),shape('towerOfAmericas',Array.from({length:24},(_,i)=>[Math.sin(i*Math.PI/12)*14.8,Math.cos(i*Math.PI/12)*14.8]))];
}
