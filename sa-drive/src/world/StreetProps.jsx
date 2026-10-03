import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildBuildingGrid, overlapsBuilding } from '../lib/collision.js';
import { buildRoadGrid, queryNearestRoad } from '../lib/grid.js';
export default function StreetProps({roads,buildings}){
  const meshes=useMemo(()=>{
    const solid=[],bulbs=[],pools=[],shrubs=[],occupied=new Set(),grid=buildBuildingGrid(buildings),roadGrid=buildRoadGrid(roads);
    for(const road of roads){
      if(!road.drivable||road.tunnel)continue;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
        for(let d=12;d<len;d+=36){
          const side=i%2?1:-1,offset=road.width/2+1.1;
          const x=a.x+dx*d/len-dz/len*offset*side,z=a.z+dz*d/len+dx/len*offset*side;
          const key=`${Math.round(x/20)},${Math.round(z/20)}`;
          if(occupied.has(key)||overlapsBuilding(grid,x,z,1)||queryNearestRoad(roadGrid,x,z).onRoad)continue;occupied.add(key);
          if(occupied.size%4===0){
            solid.push(new THREE.BoxGeometry(1.8,.45,.65).translate(x, .45,z+1.8));
            solid.push(new THREE.BoxGeometry(1.8,.55,.12).translate(x,.95,z+2.1));
          }
          if(occupied.size%3===0){
            solid.push(new THREE.CylinderGeometry(.8,.65,.55,8).translate(x,.275,z));
            const shrub=new THREE.SphereGeometry(1,8,5);shrub.scale(.85,.55,.85);shrub.translate(x,.8,z);shrubs.push(shrub);
          }
          if(occupied.size%5===0){
            solid.push(new THREE.BoxGeometry(.13,2,.13).translate(x,1,z));
            solid.push(new THREE.BoxGeometry(1.1,.42,.08).translate(x,1.9,z));
          }
          solid.push(new THREE.CylinderGeometry(.10,.17,5.7,6).translate(x,2.85,z));
          solid.push(new THREE.BoxGeometry(1,.18,1).translate(x,5.7,z));
          bulbs.push(new THREE.SphereGeometry(.32,8,6).translate(x,5.5,z));
          // A soft radial pool fakes street lighting without hundreds of lights.
          const pool=new THREE.PlaneGeometry(11,11);pool.rotateX(-Math.PI/2);pool.translate(x,.09,z);pools.push(pool);
          if(occupied.size>=350)break;
        }
        if(occupied.size>=350)break;
      }
      if(occupied.size>=350)break;
    }
    return [solid,bulbs,pools,shrubs].map(items=>{if(!items.length)return null;const g=mergeGeometries(items);items.forEach(g=>g.dispose());return g;});
  },[roads,buildings]);
  useEffect(()=>()=>meshes.forEach(g=>g?.dispose()),[meshes]);
  return <group>
    {meshes[3]&&<mesh geometry={meshes[3]}><meshLambertMaterial color="#426847"/></mesh>}
    {meshes[0]&&<mesh geometry={meshes[0]}><meshStandardMaterial color="#4b6674" metalness={.6} roughness={.4}/></mesh>}
    {meshes[1]&&<mesh geometry={meshes[1]}><meshBasicMaterial color="#ffdfa5" toneMapped={false}/></mesh>}
    {meshes[2]&&<mesh geometry={meshes[2]}><shaderMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} vertexShader={'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }'} fragmentShader={'varying vec2 vUv;void main(){float a=pow(max(0.,1.-length(vUv-.5)*2.),3.)*.20;gl_FragColor=vec4(.95,.64,.28,a);}'}/></mesh>}
  </group>;
}
