import { projectSegment } from './roadGraph.js';
export function selectRouteSigns(buildings,points){
  if(!points?.length)return [];
  const candidates=[];
  for(const building of buildings){
    if((building.height||building.levels*3.3||10)<6)continue;
    let best=null;
    for(let i=0;i<building.points.length;i++){
      const a=building.points[i],b=building.points[(i+1)%building.points.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<5)continue;
      const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
      for(let j=1;j<points.length;j++){
        const p=projectSegment({x,z},points[j-1],points[j]);if(p.distance<7||p.distance>45||best&&p.distance>=best.distance)continue;
        let nx=-dz/len,nz=dx/len;if(nx*(p.x-x)+nz*(p.z-z)<0){nx=-nx;nz=-nz;}
        // Reject end-on faces: a sign should face the road, not a corner.
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
