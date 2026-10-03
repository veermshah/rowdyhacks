export const RIVER_WIDTH=12;
export const WALKWAY_WIDTH=3.1;
export const WATER_Y=-2.95;
export const WALKWAY_Y=-2.15;
export const CHANNEL_HALF=RIVER_WIDTH/2+WALKWAY_WIDTH;
const CELL=32;
export function buildRiverNetwork(water){
  const paths=[],segments=[],cells=new Map();
  for(const feature of water){
    if(!['river','canal'].includes(feature.type))continue;
    let run=[];
    const flush=()=>{if(run.length>1)paths.push(run);run=[];};
    for(const p of feature.points){if(Math.abs(p.x)>1100||Math.abs(p.z)>1100){flush();continue;}run.push(p);}flush();
  }
  for(const points of paths)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<.01)continue;
    const segment={a,b,len},id=segments.length;segments.push(segment);
    for(let x=Math.floor((Math.min(a.x,b.x)-24)/CELL);x<=Math.floor((Math.max(a.x,b.x)+24)/CELL);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-24)/CELL);z<=Math.floor((Math.max(a.z,b.z)+24)/CELL);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);
      }
  }
  return {paths,segments,cells};
}
export function nearestRiver(network,x,z){
  let best={distance:Infinity};
  for(const id of network?.cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)||[]){
    const segment=network.segments[id],{a,b,len}=segment,dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(len*len))),px=a.x+dx*t,pz=a.z+dz*t,distance=Math.hypot(x-px,z-pz);
    if(distance<best.distance)best={distance,x:px,z:pz,dx:dx/len,dz:dz/len,segment};
  }
  return best;
}
export function offsetPath(points,offset){
  return points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;return {x:p.x-dz/len*offset,z:p.z+dx/len*offset};});
}
// Solid street-level channel boundary except at road crossings. Vehicles remain
// on the existing ground-plane physics and cannot hover over recessed water.
export function riverObstacles(network,roadGrid,queryRoad){
  const obstacles=[];
  for(const {a,b,len} of network.segments){
    const count=Math.ceil(len/3),dx=(b.x-a.x)/len,dz=(b.z-a.z)/len;
    for(let i=0;i<count;i++){
      const t=(i+.5)/count,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      if(queryRoad(roadGrid,x,z,5).onRoad)continue;
      const half=len/count/2;
      obstacles.push({points:[[-half,-CHANNEL_HALF],[-half,CHANNEL_HALF],[half,CHANNEL_HALF],[half,-CHANNEL_HALF]].map(([along,across])=>({x:x+dx*along-dz*across,z:z+dz*along+dx*across}))});
    }
  }
  return obstacles;
}
