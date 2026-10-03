import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCar,stepCar } from '../src/car/physics.js';
import { wheelAngle,mirrorPalm } from '../src/input/hands.js';
import { buildBuildingGrid,overlapsBuilding,moveWithCollision,safeRoadSpawn } from '../src/lib/collision.js';
import { buildRoadGrid,queryNearestRoad } from '../src/lib/grid.js';
import { roadWidth,isDrivable } from '../src/config/roadConfig.js';
import { bearingTo,shortestAngle,destinations } from '../src/config/navigation.js';
import { landmarkObstacles } from '../src/config/landmarkConfig.js';
for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const steer of [-1,1]){
 const c={...createCar(),v:10,yaw};stepCar(c,{gas:0,brake:0,steer},.05);
 const rightDot=c.x*(-Math.cos(yaw))+c.z*Math.sin(yaw);
 assert.equal(Math.sign(rightDot),steer,'steering relative to heading');
}
assert(wheelAngle(mirrorPalm({x:.8,y:.4}),mirrorPalm({x:.2,y:.6}))>0,'clockwise mirrored wheel = right');
assert(wheelAngle(mirrorPalm({x:.8,y:.6}),mirrorPalm({x:.2,y:.4}))<0,'counterclockwise = left');
const obstacles=buildBuildingGrid([{points:[{x:-10,z:10},{x:10,z:10},{x:10,z:20},{x:-10,z:20}]}]);
const c={...createCar(),v:25};
for(let i=0;i<240;i++)moveWithCollision(c,{gas:1,brake:0,steer:0},1/60,obstacles,stepCar);
assert(c.z<=7.7);assert.equal(c.v,0);assert(!overlapsBuilding(obstacles,c.x,c.z));
const safe={...c.safePosition};c.z=15;moveWithCollision(c,{gas:1,steer:0,brake:0},.05,obstacles,stepCar);assert.equal(c.z,safe.z);
const road={type:'primary',width:17.6,points:[{x:0,z:0},{x:1000,z:0}]};const grid=buildRoadGrid([road]);assert(queryNearestRoad(grid,250,8).onRoad);assert(!queryNearestRoad(grid,250,10).onRoad);
assert.equal(roadWidth({type:'residential'}),11.200000000000001);
assert.equal(bearingTo({x:0,z:0,yaw:0},{x:0,z:10}),0);assert(bearingTo({x:0,z:0,yaw:0},{x:-10,z:0})>0);assert(Math.abs(shortestAngle(2*Math.PI+.1)-.1)<1e-10);
const data=JSON.parse(readFileSync(new URL('../public/data/downtown.json',import.meta.url)));
const roads=data.roads.map(r=>({...r,width:roadWidth(r),drivable:isDrivable(r)}));const buildings=buildBuildingGrid([...data.buildings,...landmarkObstacles()]);
for(const destination of destinations){const spawn=safeRoadSpawn(roads,buildings,destination);assert(spawn);assert(!overlapsBuilding(buildings,spawn.x,spawn.z));console.log(destination.name,'nearest clear road',Math.hypot(spawn.x-destination.x,spawn.z-destination.z).toFixed(1),'m');}
console.log('PASS: steering, mirrored hands, sustained collision, recovery, long road coverage, widths, bearings, real-map spawns');
