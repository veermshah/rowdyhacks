import { LANDMARKS } from './landmarkConfig.js';
import { toLocal } from './worldConfig.js';
export const destinations = [['alamo','The Alamo'],['riverWalk','River Walk'],['towerOfAmericas','Tower of the Americas']].map(([key,name])=>({key,name,...toLocal(LANDMARKS[key].lat,LANDMARKS[key].lon)}));
export const navigation = { selected: 0 };
// CSS clockwise angle relative to the car's +Z forward axis.
export function bearingTo(car, target) { return car.yaw-Math.atan2(target.x-car.x,target.z-car.z); }
export function shortestAngle(a) { return Math.atan2(Math.sin(a),Math.cos(a)); }
