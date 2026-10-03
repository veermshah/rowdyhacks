import assert from 'node:assert/strict';
import { buildBuildingGeometry } from '../src/lib/buildingGeometry.js';
import { selectRouteSigns } from '../src/lib/routeSigns.js';
import { buildRoadGraph,calculateRoute,nearestEdge,aStar } from '../src/lib/roadGraph.js';

// Both OSM windings must leave windows outside the opaque footprint, after
// removing the duplicate window planes formerly hidden inside each building.
for(const reverse of [false,true]){
  const points=[{x:0,z:0},{x:20,z:0},{x:20,z:20},{x:0,z:20}];
  if(reverse)points.reverse();
  const geometries=buildBuildingGeometry([{id:10,height:12,points}]);
  assert.equal(geometries.length,2);
  const windows=geometries[1].attributes.position;
  assert(windows.count>0);
  for(let i=0;i<windows.count;i+=6){
    let x=0,z=0;for(let j=0;j<6;j++){x+=windows.getX(i+j)/6;z+=windows.getZ(i+j)/6;}
    assert(x<0||x>20||z<0||z>20,'window faces the exterior');
  }
  geometries.forEach(g=>g?.dispose());
}
const buildings=[0,640].map((x,i)=>({id:i,height:12,points:[{x,z:10},{x:x+20,z:10},{x:x+20,z:30},{x,z:30}]}));
const near=selectRouteSigns(buildings,[{x:-20,z:0},{x:40,z:0}]);assert.equal(near.length,1);assert.equal(near[0].id,0);assert.equal(near[0].z,9.8);
const far=selectRouteSigns(buildings,[{x:620,z:0},{x:680,z:0}]);assert.equal(far.length,1);assert.equal(far[0].id,1);
// Boundary crossing and a long segment must not lose candidates in the grid.
assert.equal(selectRouteSigns(buildings,[{x:-64,z:0},{x:704,z:0}]).length,2);
assert.deepEqual(near,selectRouteSigns(buildings,[{x:-20,z:0},{x:40,z:0}]),'cached facade data does not retain the old route');
assert.equal(selectRouteSigns(buildings,[]).length,0);
// Independent reference: exhaust all legal start/end combinations using the
// unchanged node-to-node A*, including one-way roads and excluded edges.
const roads=[];
for(let row=0;row<7;row++)for(const horizontal of [true,false])roads.push({type:'residential',width:12,oneway:row%3===0?'yes':undefined,points:Array.from({length:7},(_,i)=>({x:(horizontal?i:row)*20,z:(horizontal?row:i)*20}))});
const graph=buildRoadGraph(roads,new Map()),dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
for(let i=0;i<60;i++){
  const from={x:(i*13)%120,z:(i*29)%120},to={x:(i*37+17)%120,z:(i*19+9)%120},blocked=new Set(i%2?[i%graph.edges.length]:[]);
  const s=nearestEdge(graph,from),t=nearestEdge(graph,to,s.component);
  let expected=Infinity;
  if(s.edge.id===t.edge.id&&((t.t>=s.t&&s.edge.forward)||(t.t<=s.t&&s.edge.backward))&&!blocked.has(s.edge.id))expected=Math.abs(t.t-s.t)*s.edge.distance;
  for(const a of [...(s.edge.backward?[s.edge.start]:[]),...(s.edge.forward?[s.edge.end]:[])])for(const b of [...(t.edge.forward?[t.edge.start]:[]),...(t.edge.backward?[t.edge.end]:[])]){
    const path=aStar(graph,a,b,blocked);if(path)expected=Math.min(expected,path.distance+dist(s,graph.nodes[a])+dist(t,graph.nodes[b]));
  }
  const actual=calculateRoute(graph,from,to,blocked);
  if(Number.isFinite(expected))assert(Math.abs(actual.length-expected)<1e-6,'single search preserves shortest road distance');else assert.equal(actual,null);
}
console.log('PASS: exterior-only windows for both windings, indexed route sign corridor and cache invalidation');
console.log('PASS: single-search routes match exhaustive reference across 60 directed/blocked-road cases');
