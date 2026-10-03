import { projectSegment } from './roadGraph.js';
const CELL=64;
const facadeCache=new WeakMap();
function facades(buildings){
  if(facadeCache.has(buildings))return facadeCache.get(buildings);
  const result=[];
  for(const building of buildings){
    if((building.height||building.levels*3.3||10)<6)continue;
    const faces=[];
    for(let i=0;i<building.points.length;i++){
      const a=building.points[i],b=building.points[(i+1)%building.points.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<5)continue;
      const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
      faces.push({x,z,nx:-dz/len,nz:dx/len,key:`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`});
    }
    result.push({id:building.id,faces});
  }
  facadeCache.set(buildings,result);return result;
}
export function selectRouteSigns(buildings,points){
  if(!points?.length)return [];
  // Index only the 45 m search corridor. A facade cannot qualify outside
  // these cells; route order is retained for identical tie-breaking.
  const cells=new Map();
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    for(let x=Math.floor((Math.min(a.x,b.x)-45)/CELL);x<=Math.floor((Math.max(a.x,b.x)+45)/CELL);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-45)/CELL);z<=Math.floor((Math.max(a.z,b.z)+45)/CELL);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);
      }
  }
  const candidates=[];
  for(const building of facades(buildings)){
    let best=null;
    for(const face of building.faces){
      const nearby=cells.get(face.key);if(!nearby)continue;
      const {x,z}=face;
      for(const j of nearby){
        const p=projectSegment(face,points[j-1],points[j]);if(p.distance<7||p.distance>45||best&&p.distance>=best.distance)continue;
        let {nx,nz}=face;if(nx*(p.x-x)+nz*(p.z-z)<0){nx=-nx;nz=-nz;}
        if((nx*(p.x-x)+nz*(p.z-z))/p.distance<.7)continue;
        best={x:x+nx*.2,z:z+nz*.2,y:4.8,angle:Math.atan2(nx,nz),distance:p.distance,id:building.id};
      }
    }
    if(best)candidates.push(best);
  }
  const selected=[];
  for(const c of candidates.sort((a,b)=>a.distance-b.distance)){if(selected.every(s=>Math.hypot(s.x-c.x,s.z-c.z)>140))selected.push(c);if(selected.length===6)break;}
  return selected;
}
