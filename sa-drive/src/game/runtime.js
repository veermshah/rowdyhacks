import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { destinations,navigation } from '../config/navigation.js';
import { calculateRoute,routeProgress,policeSpawn,clearSegment,nearestEdge } from '../lib/roadGraph.js';
import { overlapsBuilding } from '../lib/collision.js';
export const game={player:car,ready:false,started:false,caught:false,distance:0,epoch:0,spawn:null,graph:null,obstacles:null,police:null};
export const guidance={route:null,version:0,selected:-1,remaining:0,lookahead:null,offRoute:0,status:'loading',lastPlan:-Infinity,arrived:false};
let elapsed=0;
export function initializeGame(graph,obstacles,spawn){
  game.graph=graph;game.obstacles=obstacles;
  let start={...spawn};
  // A map spawn beside a dead end may not have 80m of road behind it.
  // Move the initial spawn forward along that same network before play starts.
  for(let i=0;i<3;i++){
    const cop=policeSpawn(graph,start,80);if(!cop)break;
    const behind=(cop.x-start.x)*Math.sin(start.yaw)+(cop.z-start.z)*Math.cos(start.yaw);
    if(behind<0)break;
    start={x:cop.x,z:cop.z,yaw:cop.yaw+Math.PI};
  }
  game.spawn=start;game.ready=true;restartGame();
}
export function restartGame(){
  if(!game.ready)return;
  Object.assign(car,game.spawn,{v:0,offroad:false,safePosition:{...game.spawn}});
  Object.assign(input,{gas:0,brake:0,steer:0,reverse:false});
  input.gearReset++;
  game.caught=false;game.distance=0;game.epoch++;
  const spawn=policeSpawn(game.graph,car,80);
  if(!spawn)throw new Error('No valid police road spawn behind player');
  game.police={...spawn,v:0,route:null,index:1,lastPlan:-Infinity,blocked:new Set(),stalled:0,active:true};
  guidance.selected=-1;guidance.lastPlan=-Infinity;guidance.arrived=false;
  updateGuidance(true);
}
export function updateGuidance(force=false){
  if(!game.ready)return;
  let progress=routeProgress(guidance.route?.points,car,20+Math.min(Math.abs(car.v)/25,1)*35);
  const wrongRoad=progress && progress.distance>Math.max(8,(guidance.route.points[progress.index]?.width||12)/2+3);
  const needsPlan=force||guidance.selected!==navigation.selected||!guidance.route||progress?.distance>24||wrongRoad;
  if(needsPlan&&(force||guidance.selected!==navigation.selected||elapsed-guidance.lastPlan>=.75)){
    guidance.route=calculateRoute(game.graph,car,destinations[navigation.selected]);
    guidance.version++;guidance.selected=navigation.selected;guidance.lastPlan=elapsed;
    progress=routeProgress(guidance.route?.points,car,20+Math.min(Math.abs(car.v)/25,1)*35);
  }
  guidance.remaining=progress?.remaining??0;guidance.offRoute=progress?.distance??Infinity;
  guidance.lookahead=progress?.point??null;
  guidance.arrived=!!progress&&progress.remaining<12&&Math.hypot(car.x-guidance.route.endpoint.x,car.z-guidance.route.endpoint.z)<16;
  guidance.status=!guidance.route?'No connected road route':guidance.arrived?'Destination road access':guidance.offRoute>24?'Return to highlighted road':'Remaining road distance';
}
// OBB separating-axis check: physical contact, not a large catch radius.
export function vehiclesTouch(a,b){
  const delta={x:b.x-a.x,z:b.z-a.z};
  const axes=c=>[{x:Math.sin(c.yaw),z:Math.cos(c.yaw)},{x:Math.cos(c.yaw),z:-Math.sin(c.yaw)}];
  const aa=axes(a),bb=axes(b),dot=(u,v)=>u.x*v.x+u.z*v.z;
  for(const axis of [...aa,...bb]){
    const ra=2.1*Math.abs(dot(axis,aa[0]))+.9*Math.abs(dot(axis,aa[1]));
    const rb=2.1*Math.abs(dot(axis,bb[0]))+.9*Math.abs(dot(axis,bb[1]));
    if(Math.abs(dot(delta,axis))>ra+rb)return false;
  }
  return true;
}
function catchPlayer(){game.caught=true;car.v=0;game.police.v=0;Object.assign(input,{gas:0,brake:0,steer:0});}
export function stepPursuit(dt){
  const cop=game.police;if(!cop?.active||game.caught)return;
  if(vehiclesTouch(car,cop)){catchPlayer();return;}
  if(elapsed-cop.lastPlan>=.8){
    const direct=cop.finalApproach&&(car.offroad||Math.hypot(car.x-cop.x,car.z-cop.z)<28)&&clearSegment(game.obstacles,cop,car);
    const route=direct?{points:[{x:cop.x,z:cop.z},{x:car.x,z:car.z}],edgeIds:[]}:calculateRoute(game.graph,cop,car,cop.blocked,car.offroad?p=>p.distance<120&&clearSegment(game.obstacles,p,car):null);
    if(!direct)cop.finalApproach=false;
    cop.lastPlan=elapsed;
    if(route && clearSegment(game.obstacles,cop,route.points[0])){cop.route=route;cop.index=0;}
  }
  if(!cop.route){cop.v=0;return;}
  const gap=Math.hypot(car.x-cop.x,car.z-cop.z);
  // Good driving at 25m/s escapes the 23m/s cruiser. Slow/crashed/off-road
  // players briefly face 26m/s, bounded rather than distance-based teleporting.
  const targetSpeed=car.offroad||Math.abs(car.v)<8?26:23;
  cop.v=Math.min(targetSpeed,cop.v+7*dt);
  let budget=cop.v*dt,moved=0;
  while(budget>1e-5&&cop.index<cop.route.points.length){
    const target=cop.route.points[cop.index],dx=target.x-cop.x,dz=target.z-cop.z,len=Math.hypot(dx,dz);
    if(len<.05){cop.index++;continue;}
    const step=Math.min(budget,len,.35),x=cop.x+dx/len*step,z=cop.z+dz/len*step;
    if(overlapsBuilding(game.obstacles,x,z)){
      // Exclude a blocked edge and let A* find another road; never teleport.
      const blocked=nearestEdge(game.graph,{x,z});if(blocked)cop.blocked.add(blocked.edge.id);
      cop.v=0;cop.route=null;cop.lastPlan=-Infinity;break;
    }
    cop.x=x;cop.z=z;cop.yaw=Math.atan2(dx,dz);budget-=step;moved+=step;
    if(vehiclesTouch(car,cop)){catchPlayer();break;}
  }
  // Off-road targets: stay on the network until a short, unobstructed final
  // approach is possible. Open off-road terrain remains catchable too; a
  // blocked line of sight instead routes to another visible road access point.
  if(cop.route&&cop.index>=cop.route.points.length&&(car.offroad||gap<28)&&!game.caught){
    if(clearSegment(game.obstacles,cop,car)){cop.route={points:[{x:cop.x,z:cop.z},{x:car.x,z:car.z}],edgeIds:[]};cop.index=1;cop.finalApproach=true;}
  }
  cop.stalled=moved<.01?cop.stalled+dt:0;
  if(cop.stalled>2){cop.lastPlan=-Infinity;cop.stalled=0;}
}
export function tickGame(dt){
  elapsed+=Math.min(dt,.05);
  if(!game.ready)return;
  updateGuidance();
  if(game.started&&!game.caught)stepPursuit(Math.min(dt,.05));
}
