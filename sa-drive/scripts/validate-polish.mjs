import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRibbon } from '../src/lib/ribbon.js';
import { selectRouteSigns } from '../src/lib/routeSigns.js';
import { buildAlamo,buildTower } from '../src/lib/landmarkGeometry.js';
import { landmarkObstacles,LANDMARKS } from '../src/config/landmarkConfig.js';
import { toLocal } from '../src/config/worldConfig.js';
import { buildBuildingGrid,overlapsBuilding } from '../src/lib/collision.js';
function covered(g,x,z){
  const p=g.positions,side=(a,b)=> (p[b]-p[a])*(z-p[a+2])-(p[b+2]-p[a+2])*(x-p[a]);
  for(let i=0;i<g.indices.length;i+=3){const a=g.indices[i]*3,b=g.indices[i+1]*3,c=g.indices[i+2]*3,v=[side(a,b),side(b,c),side(c,a)];if(v.every(n=>n>=-1e-5)||v.every(n=>n<=1e-5))return true;}return false;
}
for(const points of [
  [{x:0,z:0},{x:1,z:0},{x:1,z:90}],
  [{x:0,z:0},{x:40,z:0},{x:4,z:4}],
  [{x:0,z:0},{x:0,z:0},{x:2,z:20},{x:-20,z:25}],
]){
  const g=buildRibbon(points,12);assert(g.positions.every(Number.isFinite));
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(!len)continue;
    for(let t=0;t<=1;t+=.1)for(const offset of [-5.4,0,5.4])assert(covered(g,a.x+dx*t-dz/len*offset,a.z+dz*t+dx/len*offset),'full road width through uneven samples and corners');
  }
  for(let i=0;i<g.positions.length;i+=3){assert(g.positions[i]>=Math.min(...points.map(p=>p.x))-6.01);assert(g.positions[i]<=Math.max(...points.map(p=>p.x))+6.01);}
}
assert.equal(buildRibbon([{x:0,z:0},{x:0,z:0}],12),null);
const data=JSON.parse(readFileSync(new URL('../public/data/downtown.json',import.meta.url)));
const path=[{x:80,z:-500},{x:300,z:-200},{x:300,z:300}],signs=selectRouteSigns(data.buildings,path);
assert(signs.length>0&&signs.length<=6);assert.deepEqual(signs,selectRouteSigns(data.buildings,path));
for(let i=0;i<signs.length;i++)for(let j=i+1;j<signs.length;j++)assert(Math.hypot(signs[i].x-signs[j].x,signs[i].z-signs[j].z)>140);
assert.equal(selectRouteSigns(data.buildings,[]).length,0);
for(const build of [buildAlamo,buildTower])for(const g of build()){assert(g.attributes.position.array.every(Number.isFinite));g.computeBoundingBox();assert(g.boundingBox.max.y>0);g.dispose();}
const grid=buildBuildingGrid(landmarkObstacles()),alamo=toLocal(LANDMARKS.alamo.lat,LANDMARKS.alamo.lon);
assert(overlapsBuilding(grid,alamo.x-13,alamo.z+8,.3),'Alamo front fence solid');
assert(!overlapsBuilding(grid,alamo.x-13,alamo.z,.3),'Alamo gate remains open');
const logo=readFileSync(new URL('../public/branding/rowdy-logo.webp',import.meta.url));assert.equal(logo.toString('ascii',0,4),'RIFF');assert(logo.length<400000);
console.log('PASS: rounded road coverage/no spikes, deterministic sparse route signs, landmark geometry, solid Alamo fence/open gate, supplied WebP asset');
