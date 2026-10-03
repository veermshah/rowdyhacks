import { useEffect,useMemo,useState } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { guidance } from '../game/runtime.js';
import { selectRouteSigns } from '../lib/routeSigns.js';
const LOGO='/branding/rowdy-logo.webp';
const configure=t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;};
export function CarBranding(){
  const map=useTexture(LOGO,configure);
  return <group>
    <mesh position={[0,1.257,-.2]} rotation={[-Math.PI/2,0,Math.PI]}><planeGeometry args={[.86,.86]}/><meshStandardMaterial map={map} roughness={.55} polygonOffset polygonOffsetFactor={-1}/></mesh>
    {[-1,1].map(side=><mesh key={side} position={[side*.906,.56,-.1]} rotation={[0,side*Math.PI/2,0]}><planeGeometry args={[.42,.42]}/><meshStandardMaterial map={map} roughness={.55} polygonOffset polygonOffsetFactor={-1}/></mesh>)}
  </group>;
}
export default function RouteBranding({buildings}){
  const map=useTexture(LOGO,configure),[route,setRoute]=useState(null);
  useFrame(()=>{if(guidance.route!==route)setRoute(guidance.route);});
  const geometry=useMemo(()=>{
    const signs=selectRouteSigns(buildings,route?.points),faces=[],frames=[];
    for(const s of signs){
      const face=new THREE.PlaneGeometry(2.4,2.4);face.rotateY(s.angle);face.translate(s.x,s.y,s.z);faces.push(face);
      const frame=new THREE.BoxGeometry(2.7,2.7,.12);frame.rotateY(s.angle);frame.translate(s.x-Math.sin(s.angle)*.09,s.y,s.z-Math.cos(s.angle)*.09);frames.push(frame);
    }
    return [faces,frames].map(items=>{if(!items.length)return null;const merged=mergeGeometries(items);items.forEach(g=>g.dispose());return merged;});
  },[buildings,route]);
  useEffect(()=>()=>geometry.forEach(g=>g?.dispose()),[geometry]);
  return <group>{geometry[0]&&<mesh geometry={geometry[0]}><meshStandardMaterial map={map} emissiveMap={map} emissive="#ffffff" emissiveIntensity={.35} roughness={.7}/></mesh>}{geometry[1]&&<mesh geometry={geometry[1]}><meshStandardMaterial color="#4c6159" metalness={.5} emissive="#789a82" emissiveIntensity={.3}/></mesh>}</group>;
}
