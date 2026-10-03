import { nearestRiver, CHANNEL_HALF } from '../lib/riverNetwork.js';
import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { buildRibbon, mergeRibbons } from '../lib/ribbon.js';
export default function Roads({roads,river}) {
  const meshes=useMemo(()=>{
    const groups=[[],[],[],[],[]];
    for(const r of roads){
      if(r.tunnel) continue;
      if(!r.drivable&&r.points.some(p=>nearestRiver(river,p.x,p.z).distance<CHANNEL_HALF+1))continue;
      if(!r.drivable){groups[4].push(buildRibbon(r.points,r.width,.04));continue;}
      // The driving simulation is a ground-plane arcade world; bridge road
      // decks share that plane so rendered and drivable surfaces agree.
      const curb=buildRibbon(r.points,r.width+2.8,.035),edge=buildRibbon(r.points,r.width+.35,.05),surface=buildRibbon(r.points,r.width,.065);
      if(curb)groups[0].push(curb);if(edge)groups[1].push(edge);if(surface)groups[2].push(surface);
      if(!r.drivable||r.width<10)continue;
      for(let i=1;i<r.points.length;i++){
        const a=r.points[i-1],b=r.points[i],len=Math.hypot(b.x-a.x,b.z-a.z);
        for(let d=7;d<len-7;d+=12){
          const end=Math.min(d+3,len-7);
          if(end<=d)continue;
          groups[3].push(buildRibbon([d,end].map(t=>({x:a.x+(b.x-a.x)*t/len,z:a.z+(b.z-a.z)*t/len})),.16,.08));
        }
      }
    }
    return groups.map((r,i)=>{
      const m=mergeRibbons(r),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(m.positions,3));g.setIndex(m.indices);g.computeVertexNormals();
      return {g,color:['#596266','#809493','#17272d','#c3b188','#7c8072'][i]};
    });
  },[roads,river]);
  useEffect(()=>()=>meshes.forEach(m=>m.g.dispose()),[meshes]);
  return <group>{meshes.map(({g,color},i)=><mesh key={i} geometry={g} receiveShadow><meshStandardMaterial color={color} roughness={.85} emissive={color} emissiveIntensity={i===1?.22:.08} side={THREE.DoubleSide}/></mesh>)}</group>;
}
