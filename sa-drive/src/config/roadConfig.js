export const ROAD_WIDTH_SCALE = 1.6;
const BASE = { motorway: 14, trunk: 13, primary: 11, secondary: 9.5, tertiary: 8, residential: 7, living_street: 7, unclassified: 7, service: 5.5 };
export function roadWidth(road) {
  const base = BASE[road.type?.replace('_link', '')];
  return base ? base * ROAD_WIDTH_SCALE : (road.width || 3);
}
export const isDrivable = road => Object.hasOwn(BASE, road.type?.replace('_link', '')) && !road.tunnel;
