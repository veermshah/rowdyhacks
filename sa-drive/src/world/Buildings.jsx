import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fromOsmId } from '../lib/seededRandom.js';
const palette=['#354450','#475366','#645b60','#586575','#4b6265','#77665c'];
function colored(g,color){const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function box(w,h,d,x,y,z,color,angle=0){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.rotateY(angle);g.translate(x,y,z);return colored(g,color);}
function merge(items){if(!items.length)return null;const g=mergeGeometries(items,false);items.forEach(a=>a.dispose());return g;}
export default function Buildings({buildings}){
  const geometries=useMemo(()=>{
    const bodies=[],details=[],lights=[];
    for(const b of buildings){
      const pts=b.points;if(pts.length<3)continue;
      const rng=fromOsmId(b.id),height=b.height||b.levels*3.3||(3+Math.floor(rng()*6))*3.3,min=b.minHeight||0;
      if(height<=min)continue;
      // Shape Y becomes world -Z after rotation, so negate projected Z here.
      const shape=new THREE.Shape(pts.map(p=>new THREE.Vector2(p.x,-p.z)));
      const g=new THREE.ExtrudeGeometry(shape,{depth:height-min,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,min,0);
      bodies.push(colored(g,palette[Math.floor(rng()*palette.length)]));
      if(height>25){
        const cx=pts.reduce((v,p)=>v+p.x,0)/pts.length,cz=pts.reduce((v,p)=>v+p.z,0)/pts.length;
        const roof=new THREE.ExtrudeGeometry(shape,{depth:2,bevelEnabled:false});roof.rotateX(-Math.PI/2);roof.translate(-cx,0,-cz);roof.scale(.86,1,.86);roof.translate(cx,height,cz);bodies.push(colored(roof,'#334553'));
      }
      const glow=rng()>.7?'#70e4ef':'#ffd39a';
      for(let i=0;i<pts.length;i++){
        const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<1)continue;
        const angle=-Math.atan2(dz,dx),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
        details.push(box(len,.5,.45,mx,height,mz,'#7b8895',angle));
        if(height>22)lights.push(box(len,.12,.5,mx,height-.5,mz,glow,angle));
        // Thin boxes straddle the wall: both footprint windings remain valid.
        const floors=Math.min(16,Math.floor((height-min-3)/3.5));
        for(let floor=0;floor<floors;floor++)for(let d=2;d<len-2;d+=4){
          if(rng()<.42)continue;
          const window=new THREE.PlaneGeometry(1.2,1.35).toNonIndexed();
          window.rotateY(angle);window.translate(a.x+dx*d/len+dz/len*.08,min+3+floor*3.5,a.z+dz*d/len-dx/len*.08);
          // Plane on each face avoids depending on OSM winding.
          const back=window.clone();back.translate(-dz/len*.16,0,dx/len*.16);
          lights.push(colored(window,glow),colored(back,glow));
        }
      }
    }
    return [merge(bodies),merge(details),merge(lights)];
  },[buildings]);
  useEffect(()=>()=>geometries.forEach(g=>g?.dispose()),[geometries]);
  return <group>{geometries.map((g,i)=>g&&<mesh key={i} geometry={g} receiveShadow={i<2}>{i===2?<meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide}/>:<meshStandardMaterial vertexColors roughness={.8} metalness={.15}/>}</mesh>)}</group>;
}
