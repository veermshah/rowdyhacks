import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { ROUTE_COLOR } from '../config/routeStyle.js';
import { buildRouteRibbon } from '../lib/routeRibbon.js';
import { game,guidance,tickGame } from './runtime.js';
function RouteOverlay(){
  const [version,setVersion]=useState(-1),mesh=useRef();
  useFrame(()=>{if(version!==guidance.version)setVersion(guidance.version);});
  useEffect(()=>{
    const data=buildRouteRibbon(guidance.route?.points||[]),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(data.indices);geometry.computeVertexNormals();
    mesh.current.geometry=geometry;return()=>geometry.dispose();
  },[version]);
  return <mesh ref={mesh} renderOrder={2}><meshBasicMaterial color={ROUTE_COLOR} transparent opacity={.72} depthWrite={false} side={THREE.DoubleSide} toneMapped={false}/></mesh>;
}
function PoliceCar(){
  const group=useRef(),red=useRef(),blue=useRef();
  useFrame(({clock})=>{
    const cop=game.police;if(!group.current)return;
    group.current.visible=!!cop;
    if(!cop)return;
    group.current.position.set(cop.x,0,cop.z);group.current.rotation.y=cop.yaw;
    const flash=Math.sin(clock.elapsedTime*15)>0;
    red.current.color.set(flash?'#ff284b':'#591326');blue.current.color.set(flash?'#13285a':'#4cafff');
  });
  return <group ref={group}>
    <RoundedBox args={[1.8,.5,4.2]} position={[0,.55,0]} radius={.14} smoothness={2}><meshStandardMaterial color="#d9e0e6" metalness={.35} roughness={.4}/></RoundedBox>
    <RoundedBox args={[1.45,.55,1.9]} position={[0,1,-.2]} radius={.12} smoothness={2}><meshStandardMaterial color="#172d41" metalness={.5} roughness={.3}/></RoundedBox>
    <mesh position={[0,.81,1.3]}><boxGeometry args={[1.65,.1,1.3]}/><meshStandardMaterial color="#17202b"/></mesh>
    <mesh position={[0,1.35,-.2]}><boxGeometry args={[1.35,.1,.35]}/><meshStandardMaterial color="#131e2c"/></mesh>
    <mesh position={[-.36,1.46,-.2]}><boxGeometry args={[.6,.17,.32]}/><meshBasicMaterial ref={red} color="#ff284b" toneMapped={false}/></mesh>
    <mesh position={[.36,1.46,-.2]}><boxGeometry args={[.6,.17,.32]}/><meshBasicMaterial ref={blue} color="#4cafff" toneMapped={false}/></mesh>
    {[-1,1].map(side=><group key={side}>
      <mesh position={[side*.6,.64,2.12]}><boxGeometry args={[.45,.15,.04]}/><meshBasicMaterial color="#ddf6ff" toneMapped={false}/></mesh>
      <mesh position={[side*.91,.6,-.1]}><boxGeometry args={[.03,.26,1.7]}/><meshStandardMaterial color="#142332"/></mesh>
      {[-1.25,1.25].map(z=><mesh key={z} position={[side*.91,.3,z]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.3,.3,.22,12]}/><meshStandardMaterial color="#10151e"/></mesh>)}
    </group>)}
  </group>;
}
export default function Gameplay(){
  useFrame((_,dt)=>tickGame(dt));
  return <><RouteOverlay/><PoliceCar/></>;
}
