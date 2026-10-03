import { toLocal } from './worldConfig.js';
export const LANDMARKS = {
  alamo: {
    lat: 29.4260,
    lon: -98.4861,
    headingDeg: 0,
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
    lat: 29.4235,
    lon: -98.4895,
    headingDeg: 0,
    scale: 1,
    anchorOffset: { x: 0, y: 0, z: 0 },
  },
};

export function landmarkObstacles() {
  const box=(key,w,d)=>{const c=toLocal(LANDMARKS[key].lat,LANDMARKS[key].lon);return {points:[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>({x:c.x+x,z:c.z+z}))};};
  return [box('alamo',17,8),box('towerOfAmericas',15,15)];
}
