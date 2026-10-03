import { createCar } from './physics.js';
// Singleton car state so other components can read it
export const car = createCar();

// Grid reference set by App after loading
export let roadGrid = null;
export let buildingGrid = null;
export function setBuildingGrid(grid) { buildingGrid = grid; }
export function setRoadGrid(grid) { roadGrid = grid; }

