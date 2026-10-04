import { findFairStart } from '../lib/fairStart.js';
import { PURSUIT_GRACE_SECONDS, POLICE_START_DISTANCE } from './startConfig.js';
import { POLICE_CONFIG as PC } from '../config/policeConfig.js';
import { policeTargetSpeed,angleDelta,updatePoliceBoost } from './policeDriving.js';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { destinations,navigation } from '../config/navigation.js';
import { calculateRoute,routeProgress,clearSegment,nearestEdge,policeSpawn } from '../lib/roadGraph.js';
import { overlapsBuilding } from '../lib/collision.js';
import { WANTED_POLICE_SPEED_BONUS } from '../config/heistConfig.js';
export const game={player:car,ready:false,started:false,caught:false,distance:0,epoch:0,spawn:null,anchor:null,graceRemaining:PURSUIT_GRACE_SECONDS,graph:null,obstacles:null,police:null,paused:false,wantedLevel:0};
export const guidance={route:null,version:0,selected:-1,remaining:0,lookahead:null,offRoute:0,status:'loading',lastPlan:-Infinity,arrived:false};
let elapsed=0;
export function initializeGame(graph,obstacles,spawn){
  game.graph=graph;game.obstacles=obstacles;
  game.anchor={...spawn};game.ready=true;restartGame();
}
export function restartGame(){
  if(!game.ready)return;
  const fair=findFairStart(game.graph,game.anchor,destinations[navigation.selected]);
  game.spawn=fair.spawn;
  Object.assign(car,game.spawn,{v:0,offroad:false,safePosition:{...game.spawn}});
  Object.assign(input,{gas:0,brake:0,steer:0,reverse:false,rearView:false});
  input.gearReset++;
  game.caught=false;game.distance=0;game.epoch++;
  const spawn=fair.police;
  game.graceRemaining=PURSUIT_GRACE_SECONDS;
  if(!spawn)throw new Error('No valid police road spawn behind player');
  game.police={...spawn,v:0,route:null,index:1,lastPlan:-Infinity,replanDelay:PC.routeUpdateMin,plans:0,turnWait:0,blocked:new Set(),stalled:0,active:true};
  guidance.selected=-1;guidance.lastPlan=-Infinity;guidance.arrived=false;
  updateGuidance(true);
}
export function updateGuidance(force=false){
  if(!game.ready)return;
  if(!force&&guidance.selected!==navigation.selected&&game.distance<2&&Math.abs(car.v)<.5&&game.graceRemaining>0){restartGame();return;}
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
  // Hold position for four seconds of active play, including after restart.
  // The cruiser remains visible; controls/calibration screens consume no grace.
  if(game.graceRemaining>0){game.graceRemaining=Math.max(0,game.graceRemaining-dt);cop.v=0;return;}
  if(vehiclesTouch(car,cop)){catchPlayer();return;}
  if(elapsed-cop.lastPlan>=cop.replanDelay){
    const direct=cop.finalApproach&&(car.offroad||Math.hypot(car.x-cop.x,car.z-cop.z)<28)&&clearSegment(game.obstacles,cop,car);
    const route=direct?{points:[{x:cop.x,z:cop.z},{x:car.x,z:car.z}],edgeIds:[]}:calculateRoute(game.graph,cop,car,cop.blocked,car.offroad?p=>p.distance<120&&clearSegment(game.obstacles,p,car):null);
    if(!direct)cop.finalApproach=false;
    cop.lastPlan=elapsed;
    // Deterministic variation keeps replays/tests reproducible, without reacting
    // instantly to every road choice. Positions are never corrected or teleported.
    cop.replanDelay=PC.routeUpdateMin+(PC.routeUpdateMax-PC.routeUpdateMin)*((++cop.plans*.61803398875)%1);
    if(route && clearSegment(game.obstacles,cop,route.points[0])){cop.route=route;cop.index=0;}
  }
  if(!cop.route){cop.v=0;return;}
  const gap=Math.hypot(car.x-cop.x,car.z-cop.z);
  updatePoliceBoost(cop,car,gap,dt);
  const targetSpeed=policeTargetSpeed(cop,car)*(1+WANTED_POLICE_SPEED_BONUS*game.wantedLevel);
  cop.v+=Math.max(-PC.braking*dt,Math.min(PC.acceleration*dt,targetSpeed-cop.v));
  let yawBudget=PC.yawRate*dt;
  let budget=cop.v*dt,moved=0;
  while(budget>1e-5&&cop.index<cop.route.points.length){
    const target=cop.route.points[cop.index],dx=target.x-cop.x,dz=target.z-cop.z,len=Math.hypot(dx,dz);
    if(len<.05){cop.index++;continue;}
    const desired=Math.atan2(dx,dz),delta=angleDelta(desired,cop.yaw);
    const turn=Math.max(-yawBudget,Math.min(yawBudget,delta));cop.yaw+=turn;yawBudget-=Math.abs(turn);
    // Brake and hesitate at a sharp corner, then rotate at a bounded rate.
    // Following the exact road waypoints avoids unsafe noisy corner cutting.
    if(Math.abs(delta)>.55){cop.turnWait=PC.turnReactionSeconds;cop.v=Math.max(0,cop.v-PC.braking*dt);break;}
    if(cop.turnWait>0){cop.turnWait=Math.max(0,cop.turnWait-dt);cop.v=Math.max(0,cop.v-PC.braking*dt);break;}
    const step=Math.min(budget,len,.35),x=cop.x+dx/len*step,z=cop.z+dz/len*step;
    const road=nearestEdge(game.graph,{x,z});
    if(!road||road.distance>road.edge.width/2-.9){cop.v=0;cop.route=null;cop.lastPlan=elapsed;break;}
    if(overlapsBuilding(game.obstacles,x,z)){
      // Exclude a blocked edge and let A* find another road; never teleport.
      const blocked=nearestEdge(game.graph,{x,z});if(blocked)cop.blocked.add(blocked.edge.id);
      cop.v=0;cop.route=null;cop.lastPlan=-Infinity;break;
    }
    cop.x=x;cop.z=z;budget-=step;moved+=step;
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
export function skipToDestination(){
  if(!game.ready)return;
  // Teleport car to nearest road near the CURRENT destination
  const dest=destinations[navigation.selected];
  const snap=nearestEdge(game.graph,dest);
  if(!snap)return;
  // Align car along the road edge direction
  const edge=snap.edge,a=game.graph.nodes[edge.start],b=game.graph.nodes[edge.end];
  const yaw=Math.atan2(b.x-a.x,b.z-a.z);
  Object.assign(car,{x:snap.x,z:snap.z,yaw,v:0,offroad:false,safePosition:{x:snap.x,z:snap.z,yaw}});
  Object.assign(input,{gas:0,brake:0,steer:0,reverse:false,rearView:false});
  input.gearReset++;
  game.caught=false;game.epoch++;
  // Advance to NEXT destination
  const next=(navigation.selected+1)%destinations.length;
  navigation.selected=next;
  // Reposition police behind the new car position with grace period
  game.graceRemaining=PURSUIT_GRACE_SECONDS;
  const police=policeSpawn(game.graph,car,POLICE_START_DISTANCE);
  if(police){
    game.police={...police,v:0,route:null,index:1,lastPlan:-Infinity,replanDelay:PC.routeUpdateMin,plans:0,turnWait:0,blocked:new Set(),stalled:0,active:true};
  }
  // Force route recalculation for the new destination
  guidance.selected=-1;guidance.lastPlan=-Infinity;guidance.arrived=false;
  updateGuidance(true);
  return next;
}
// Heist alarm: skip any remaining start grace and make the cruiser re-route now.
export function alertPolice(){
  game.graceRemaining=0;
  if(game.police){game.police.lastPlan=-Infinity;game.police.blocked.clear();}
}
export function tickGame(dt){
  elapsed+=Math.min(dt,.05);
  if(!game.ready)return;
  updateGuidance();
  if(game.started&&!game.caught&&!game.paused)stepPursuit(Math.min(dt,.05));
}
