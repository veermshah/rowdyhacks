import { useRef,useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildBuildingGeometry } from '../lib/buildingGeometry.js';
export default function Buildings({buildings}){
  const group=useRef();
  const gl=useThree(state=>state.gl);
  useLayoutEffect(()=>{
    const chunks=buildBuildingGeometry(buildings,gl.extensions.has('WEBGL_multi_draw')?128:320);
    const materials=[new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:.15}),new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide})];
    const batches=materials.map((material,i)=>{
      const parts=chunks.map(c=>c[i]).filter(Boolean);
      const batch=new THREE.BatchedMesh(Math.max(1,parts.length),Math.max(1,parts.reduce((sum,g)=>sum+g.attributes.position.count,0)),0,material);
      // Three.js culls individual blocks and submits them through multi-draw.
      // Its built-in fallback supports browsers without WEBGL_multi_draw.
      batch.perObjectFrustumCulled=true;batch.sortObjects=false;batch.receiveShadow=i===0;
      for(const g of parts){batch.addInstance(batch.addGeometry(g));g.dispose();}
      batch.computeBoundingSphere();return batch;
    });
    const target=group.current;
    batches.forEach(b=>target.add(b));
    // Construct fresh batches on each effect setup: StrictMode replays effects,
    // and BatchedMesh.dispose() destroys its internal matrix textures.
    return ()=>batches.forEach(b=>{target.remove(b);b.dispose();b.material.dispose();});
  },[buildings,gl]);
  return <group ref={group}/>;
}
