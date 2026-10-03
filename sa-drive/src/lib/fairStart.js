import { calculateRoute, nearestEdge, policeSpawn, routeProgress } from './roadGraph.js';
import { POLICE_START_DISTANCE } from '../game/startConfig.js';
import { POLICE_CONFIG } from '../config/policeConfig.js';
// Pick a clear road start facing its destination route, with a real 150-220m
// pursuit path behind it. A distance check rejects loops that create shortcuts.
export function findFairStart(graph, anchor, destination) {
  const candidates=[anchor,...graph.edges.map(e=>{
    const a=graph.nodes[e.start],b=graph.nodes[e.end];
    return {x:(a.x+b.x)/2,z:(a.z+b.z)/2};
  })].sort((a,b)=>Math.hypot(a.x-anchor.x,a.z-anchor.z)-Math.hypot(b.x-anchor.x,b.z-anchor.z));
  const visited=new Set();
  for(const candidate of candidates){
    const key=`${Math.round(candidate.x/12)},${Math.round(candidate.z/12)}`;
    if(visited.has(key))continue;visited.add(key);
    const snap=nearestEdge(graph,candidate);if(!snap||graph.sizes[snap.component]<30)continue;
    const route=calculateRoute(graph,snap,destination);if(!route||route.length<65)continue;
    const next=routeProgress(route.points,snap,10).point;
    const spawn={x:snap.x,z:snap.z,yaw:Math.atan2(next.x-snap.x,next.z-snap.z)};
    const ahead=routeProgress(route.points,spawn,30).point;
    if((ahead.x-spawn.x)*Math.sin(spawn.yaw)+(ahead.z-spawn.z)*Math.cos(spawn.yaw)<8)continue;
    const police=policeSpawn(graph,spawn,POLICE_START_DISTANCE);if(!police)continue;
    if((police.x-spawn.x)*Math.sin(spawn.yaw)+(police.z-spawn.z)*Math.cos(spawn.yaw)>-35)continue;
    const chase=calculateRoute(graph,police,spawn);
    if(!chase||chase.length<POLICE_CONFIG.spawnDistanceMin||chase.length>POLICE_CONFIG.spawnDistanceMax)continue;
    return {spawn,police:{...police,distance:chase.length},route};
  }
  throw new Error('No fair road start with sufficient pursuit spacing was found');
}
