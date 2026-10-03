import { useMemo,useEffect } from 'react';
import { LANDMARKS } from '../config/landmarkConfig.js';
import { toLocal } from '../config/worldConfig.js';
import { buildTower,buildAlamo } from '../lib/landmarkGeometry.js';
function Landmark({landmarkKey,build}){
  const geometries=useMemo(()=>build(),[build]),config=LANDMARKS[landmarkKey],position=toLocal(config.lat,config.lon);
  useEffect(()=>()=>geometries.forEach(g=>g?.dispose()),[geometries]);
  return <group position={[position.x,0,position.z]} rotation={[0,config.headingDeg*Math.PI/180,0]}>
    {geometries.map((g,i)=>g&&<mesh key={i} geometry={g} receiveShadow={i===0}>
      {i===2?<meshBasicMaterial vertexColors toneMapped={false}/>:<meshStandardMaterial vertexColors roughness={i===0?.88:.26} metalness={i===0?.05:.5} emissive={landmarkKey==='alamo'?'#d0b88d':'#78978c'} emissiveIntensity={landmarkKey==='alamo'?.22:.12}/>}
    </mesh>)}
  </group>;
}
export default function Landmarks(){return <><Landmark landmarkKey="towerOfAmericas" build={buildTower}/><Landmark landmarkKey="alamo" build={buildAlamo}/></>;}
