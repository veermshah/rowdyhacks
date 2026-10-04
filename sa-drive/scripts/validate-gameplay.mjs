import { SP2_POINT } from '../src/config/campus.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOpenHand,createGestureState,updateGestureState } from '../src/input/gestures.js';
import { createCar,stepCar } from '../src/car/physics.js';
import { wheelAngle } from '../src/input/hands.js';
import { roadWidth,isDrivable } from '../src/config/roadConfig.js';
import { destinations,navigation,bearingTo } from '../src/config/navigation.js';
import { landmarkObstacles,LANDMARK_OSM_REPLACEMENTS } from '../src/config/landmarkConfig.js';
import { buildBuildingGrid,overlapsBuilding,safeRoadSpawn,moveWithCollision } from '../src/lib/collision.js';
import { buildRoadGrid,queryNearestRoad } from '../src/lib/grid.js';
import { buildRiverNetwork,riverObstacles } from '../src/lib/riverNetwork.js';
import { buildRouteRibbon } from '../src/lib/routeRibbon.js';
import { buildRoadGraph,calculateRoute,routeProgress,clearSegment,nearestEdge } from '../src/lib/roadGraph.js';
import { game,guidance,initializeGame,restartGame,tickGame,vehiclesTouch } from '../src/game/runtime.js';
import { POLICE_CONFIG } from '../src/config/policeConfig.js';
import { car } from '../src/car/state.js';
import { findFairStart } from '../src/lib/fairStart.js';
import { buildRiverScene } from '../src/lib/riverGeometry.js';
import { WATER_Y,WALKWAY_Y } from '../src/lib/riverNetwork.js';
function hand(open=true,angle=0){const h=Array.from({length:21},()=>({x:0,y:0,z:0}));for(const [i,m] of [5,9,13,17].entries())for(let j=0;j<4;j++){const x=(i-1.5)*.3,y=open?1+j:[1,2,1.5,.9][j];h[m+j]={x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle),z:0};}return h;}
for(const angle of [0,.6,1.5,3]){assert(isOpenHand(hand(true,angle)));assert(!isOpenHand(hand(false,angle)));}
const gesture=createGestureState();
const reverseAt=(hands,t)=>updateGestureState(gesture,hands,t).reverse;
for(const t of [0,40,80])assert.equal(reverseAt([hand(),hand()],t),false);
// A tracking gap (not a one-fist-one-open frame, which the newer rear-view
// classifier reads as a real competing gesture) is the "ignored as noise"
// case that shouldn't reset the pending reverse timer.
reverseAt(null,100);
for(const t of [120,160,200,240])assert.equal(reverseAt([hand(),hand()],t),false);
assert.equal(reverseAt([hand(),hand()],280),true,'held open 280ms enters reverse');
// Leaving reverse needs LEAVE_REVERSE_MS (350ms) of a held non-reverse gesture.
// Consecutive calls must stay within MAX_FRAME_GAP (200ms) of each other, same
// as real per-frame polling, or the gap-reset path (meant for lost tracking)
// kicks in and restarts the pending timer early.
for(const t of [300,340,380,420,460,500,540,580,620])assert.equal(reverseAt([hand(false),hand(false)],t),true);
assert.equal(reverseAt([hand(false),hand(false)],660),false,'held closed 350ms+ leaves reverse');
// Brief poke back toward reverse, then a >200ms tracking gap resets the
// pending timer, so a later frame alone isn't enough to re-enter reverse.
reverseAt([hand(),hand()],680);reverseAt(null,720);assert.equal(reverseAt([hand(),hand()],1000),false);
const c={...createCar(),v:15};stepCar(c,{gas:1,brake:0,steer:0,reverse:true},.05);assert(c.v>0&&c.v<15);
let seenZero=false;for(let i=0;i<600;i++){const previous=c.v;stepCar(c,{gas:1,brake:0,steer:0,reverse:true},1/60);if(c.v===0)seenZero=true;if(c.v<0&&previous>=0)assert(seenZero);}assert(c.v<0&&c.v>=-c.maxSpeed*.3,'reverse capped at 30% of maxSpeed');
for(const steer of [-1,1]){const r={...createCar(),v:-5};stepCar(r,{gas:0,brake:0,steer,reverse:true},.05);assert.equal(Math.sign(r.yaw),steer);assert.equal(Math.sign(r.x),-steer);}
assert(wheelAngle({x:.2,y:.3},{x:.8,y:.6})>0);
const wall=buildBuildingGrid([{points:[{x:-20,z:10},{x:20,z:10},{x:20,z:20},{x:-20,z:20}]}]);const crash={...createCar(),v:25};for(let i=0;i<300;i++)moveWithCollision(crash,{gas:1,brake:0,steer:0},1/60,wall,stepCar);const impactZ=crash.z;assert.equal(crash.v,0);for(let i=0;i<120;i++)moveWithCollision(crash,{gas:1,brake:0,steer:0,reverse:true},1/60,wall,stepCar);assert(crash.z<impactZ-3);assert(!overlapsBuilding(wall,crash.x,crash.z));
const road=points=>({type:'residential',width:12,points});
const u=buildRoadGraph([road([{x:0,z:0},{x:-60,z:0},{x:-60,z:-80},{x:100,z:-80},{x:100,z:0}])],new Map());
const route=calculateRoute(u,{x:0,z:0},{x:100,z:0});assert(Math.abs(route.length-380)<.01);const progress=routeProgress(route.points,{x:0,z:0},30);assert(progress.point.x<0);assert(bearingTo({x:0,z:0,yaw:0},progress.point)>0);assert(bearingTo({x:0,z:0,yaw:0},{x:100,z:0})<0);
const ribbon=buildRouteRibbon(route.points);assert.equal(ribbon.positions.length,route.points.length*6);assert.equal(ribbon.indices.length,(route.points.length-1)*6);assert(ribbon.positions.every(Number.isFinite));
const beforeTurn=routeProgress(route.points,{x:-45,z:0},35);assert(beforeTurn.point.z<0,'anticipate turn before intersection');assert(routeProgress(route.points,{x:-60,z:-40},20).remaining<progress.remaining);
const directed=buildRoadGraph([{...road([{x:0,z:0},{x:100,z:0}]),oneway:'yes'}],new Map());assert(calculateRoute(directed,{x:10,z:0},{x:90,z:0}));assert.equal(calculateRoute(directed,{x:90,z:0},{x:10,z:0}),null);
assert(vehiclesTouch({x:0,z:0,yaw:0},{x:0,z:4,yaw:0}));assert(!vehiclesTouch({x:0,z:0,yaw:0},{x:2,z:0,yaw:0}));
// A crashed/off-road player beside a wall remains catchable by a safe final approach.
const shoulderWall=buildBuildingGrid([{points:[{x:12,z:10},{x:25,z:10},{x:25,z:40},{x:12,z:40}]}]);
const straightGraph=buildRoadGraph([road([{x:0,z:-200},{x:0,z:200}])],shoulderWall);
navigation.selected=1;initializeGame(straightGraph,shoulderWall,{x:0,z:0,yaw:0});game.started=true;Object.assign(car,{x:6.5,z:20,v:0,offroad:true});
for(let i=0;i<2400&&!game.caught;i++){tickGame(1/60);assert(!overlapsBuilding(shoulderWall,game.police.x,game.police.z));}
assert(game.caught,'crash on shoulder is caught without crossing wall');
const data=JSON.parse(readFileSync(new URL('../public/data/downtown.json',import.meta.url)));const roads=data.roads.map(r=>({...r,width:roadWidth(r),drivable:isDrivable(r)}));const river=buildRiverNetwork(data.water),roadGrid=buildRoadGrid(roads);const obstacles=buildBuildingGrid([...data.buildings.filter(b=>!LANDMARK_OSM_REPLACEMENTS.has(b.id)),...landmarkObstacles(),...riverObstacles(river,roadGrid,queryNearestRoad)]);
navigation.selected=0;console.time('Build actual OSM graph');const graph=buildRoadGraph(roads,obstacles);console.timeEnd('Build actual OSM graph');initializeGame(graph,obstacles,safeRoadSpawn(roads,obstacles,destinations[0]));game.started=true;
let cop=game.police;assert(cop.distance>=170&&cop.distance<=220);assert((cop.x-car.x)*Math.sin(car.yaw)+(cop.z-car.z)*Math.cos(car.yaw)<0,'police behind player');assert(nearestEdge(graph,cop).distance<.1);assert(!overlapsBuilding(obstacles,cop.x,cop.z));
for(let i=0;i<1800&&!game.caught;i++){tickGame(1/60);assert(!overlapsBuilding(obstacles,cop.x,cop.z));}assert(game.caught,'stopping is caught');const caughtAt={x:cop.x,z:cop.z};tickGame(1);assert.equal(cop.x,caughtAt.x);assert.equal(cop.z,caughtAt.z);
restartGame();assert(!game.caught);assert.equal(car.v,0);assert.equal(game.distance,0);assert(game.police.distance>=170&&game.police.distance<=220);
for(let i=0;i<destinations.length;i++){navigation.selected=i;tickGame(1/60);assert(guidance.route);assert(guidance.lookahead);const points=guidance.route.points;for(let j=1;j<points.length;j++)assert(clearSegment(obstacles,points[j-1],points[j]));console.log(destinations[i].name,Math.round(guidance.remaining)+'m driving',Math.round(guidance.route.targetOffset)+'m landmark access offset');}
const version=guidance.version;const other=graph.nodes.find(n=>n.component===nearestEdge(graph,car).component&&routeProgress(guidance.route.points,n).distance>50);Object.assign(car,{x:other.x,z:other.z});for(let i=0;i<60;i++)tickGame(1/60);assert(guidance.version>version,'wrong road reroutes');
restartGame();navigation.selected=2;tickGame(1/60);
const chasePath=guidance.route.points;let waypoint=1,policeTravel=0;
for(let i=0;i<3600&&!game.caught&&waypoint<chasePath.length;i++){
  const target=chasePath[waypoint],dx=target.x-car.x,dz=target.z-car.z,length=Math.hypot(dx,dz),step=Math.min(20/60,length);
  if(length<.001){waypoint++;continue;}
  car.x+=dx/length*step;car.z+=dz/length*step;car.yaw=Math.atan2(dx,dz);car.v=20;
  const old={x:game.police.x,z:game.police.z,yaw:game.police.yaw};tickGame(1/60);const moved=Math.hypot(game.police.x-old.x,game.police.z-old.z);policeTravel+=moved;
  const maxBoostRatio=Math.max(POLICE_CONFIG.maxCatchupRatio,POLICE_CONFIG.slowPlayerSpeedRatio);
  assert(moved<=car.maxSpeed*maxBoostRatio*1.1/60+.001,'bounded pursuit movement without teleporting');
  assert(Math.abs(Math.atan2(Math.sin(game.police.yaw-old.yaw),Math.cos(game.police.yaw-old.yaw)))<=POLICE_CONFIG.yawRate/60+.001,'bounded police rotation');
  const policeRoad=nearestEdge(graph,game.police);assert(policeRoad.distance<=policeRoad.edge.width/2-.89,'police remains inside road');
  assert(!overlapsBuilding(obstacles,game.police.x,game.police.z),'moving pursuit never enters buildings');
  if(step>=length-.001)waypoint++;
}
assert(policeTravel>100,'police makes progress through multiple intersections');
console.log('Moving pursuit travelled',Math.round(policeTravel),'m');
const thin=buildRouteRibbon([{x:0,z:0,width:20},{x:0,z:30,width:20}]);
assert(Math.abs(Math.abs(thin.positions[3]-thin.positions[0])-3.2)<.001,'route occupies 16% of road');
for(const destination of destinations){
  const fair=findFairStart(graph,game.anchor,destination),ahead=routeProgress(fair.route.points,fair.spawn,30).point;
  assert((ahead.x-fair.spawn.x)*Math.sin(fair.spawn.yaw)+(ahead.z-fair.spawn.z)*Math.cos(fair.spawn.yaw)>8,'initial guidance ahead');
  assert((fair.police.x-fair.spawn.x)*Math.sin(fair.spawn.yaw)+(fair.police.z-fair.spawn.z)*Math.cos(fair.spawn.yaw)<-35,'police behind');
  const gap=calculateRoute(graph,fair.police,fair.spawn).length;assert(gap>=170&&gap<=220,'actual graph distance to police');
}
restartGame();game.started=false;tickGame(1);assert.equal(game.graceRemaining,4,'calibration does not consume grace');
game.started=true;const waiting={x:game.police.x,z:game.police.z};
for(let i=0;i<230;i++)tickGame(1/60);
assert.equal(game.police.x,waiting.x);assert.equal(game.police.z,waiting.z);assert(!game.caught);
const scene=buildRiverScene(river,roads,data.buildings.filter(b=>!LANDMARK_OSM_REPLACEMENTS.has(b.id)),obstacles,roadGrid);
for(const [geometry,height] of [[scene.water,WATER_Y],[scene.walkways,WALKWAY_Y]]){
  const vertices=geometry.attributes.position;assert(vertices.count>0);
  for(let i=0;i<vertices.count;i++)assert(Math.abs(vertices.getY(i)-height)<.001);
}
assert(scene.bridges.length>0);assert(scene.propCount<=150);
for(const value of Object.values(scene))if(value?.isBufferGeometry){assert(value.attributes.position.array.every(Number.isFinite));value.dispose();}
console.log('PASS: 16% route ribbon, all destination starts forward with police 170-220m behind, four-second grace, recessed river geometry and bridges');
console.log('PASS: open-hand debounce/rotation/loss, signed reverse/steering/cap, crash escape, route-only bearings/anticipation/distance, one-way A*, clear OSM routes, police road spawn/pursuit/catch, restart, rerouting');

// Every road-access arrival advances once, preserves the run, and waits for challenges.
navigation.selected=0;
initializeGame(graph,obstacles,safeRoadSpawn(roads,obstacles,SP2_POINT));
assert(Math.hypot(car.x-SP2_POINT.x,car.z-SP2_POINT.z)<100,`spawn stays beside SP2: ${JSON.stringify(car.safePosition)}, ${JSON.stringify(game.anchor)}`);
assert(guidance.remaining>500,'SP2 has a driving route to the Alamo');
for(let selected=0;selected<destinations.length;selected++){
  game.started=true;
  game.paused=true;
  const endpoint=guidance.route.endpoint;
  Object.assign(car,{x:endpoint.x,z:endpoint.z,v:0});
  const epoch=game.epoch;
  const police=game.police;
  tickGame(0);
  assert(guidance.arrived,'endpoint counts as arrival');
  assert.equal(navigation.selected,selected,'open challenge holds destination');
  game.paused=false;
  tickGame(0);
  assert.equal(navigation.selected,(selected+1)%destinations.length,'arrival advances including wraparound');
  assert.equal(guidance.selected,navigation.selected);
  assert(guidance.route.targetOffset<100,'next route reaches the landmark neighborhood');
  for(let i=1;i<guidance.route.points.length;i++)assert(clearSegment(obstacles,guidance.route.points[i-1],guidance.route.points[i]),'campus progression stays on clear roads');
  assert(guidance.route&&guidance.remaining>12,`next destination has an active route: ${selected}, ${guidance.remaining}, ${!!guidance.route}, length=${guidance.route?.length}, component=${nearestEdge(graph,car)?.component}, offset=${guidance.route?.targetOffset}`);
  assert.equal(game.epoch,epoch,'arrival preserves the run');
  assert.equal(game.police,police,'arrival preserves police');
  assert.equal(car.x,endpoint.x);
  assert.equal(car.z,endpoint.z);
  tickGame(0);
  assert.equal(navigation.selected,(selected+1)%destinations.length,'stationary car does not advance twice');
}
console.log('Automatic destination progression passed');

// Bridges connect to their approach roads without joining an interior overpass.
const bridgeGraph=buildRoadGraph([
  road([{x:0,z:0},{x:0,z:40}]),
  {...road([{x:0,z:40},{x:0,z:60}]),bridge:true,layer:1},
  road([{x:0,z:60},{x:0,z:100}]),
  road([{x:-30,z:50},{x:0,z:50},{x:30,z:50}]),
],new Map());
assert(calculateRoute(bridgeGraph,{x:0,z:10},{x:0,z:90})?.length===80,'bridge joins both approaches');
assert.notEqual(nearestEdge(bridgeGraph,{x:0,z:10}).component,nearestEdge(bridgeGraph,{x:20,z:50}).component,'overpass interior remains separate');
console.log('PASS: campus road access, landmark reachability, and bridge endpoint connections');
