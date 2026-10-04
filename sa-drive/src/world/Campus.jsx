import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAMPUS_BUILDINGS } from '../config/campus.js';

function buildCampus(building,config){
  const points=building.points.slice(0,-1),xs=points.map(p=>p.x),zs=points.map(p=>p.z);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
  const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x-cx,-(p.z-cz))));
  const groups=[[],[],[]];
  function add(g,color,group=0){
    const flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();
    const c=new THREE.Color(color),colors=new Float32Array(flat.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}
    flat.setAttribute('color',new THREE.BufferAttribute(colors,3));groups[group].push(flat);
  }
  function slab(y,h,color){const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);add(g,color);}
  slab(0,config.height,config.color);
  const floors=Math.floor(config.height/4);
  for(let floor=0;floor<=floors;floor++)slab(floor*4,.28,floor===0?'#918673':'#ddd3ba');
  slab(config.height,.55,'#e3d6bc');
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<2)continue;
    const angle=-Math.atan2(dz,dx),count=Math.floor(len/3.8);
    for(let f=0;f<floors;f++)for(let j=0;j<count;j++){
      const t=(j+.5)/count,x=a.x+dx*t-cx,z=a.z+dz*t-cz;
      const g=new THREE.BoxGeometry(Math.min(2.8,len/count-.3),2.7,.18);g.rotateY(angle);g.translate(x,2+f*4,z);
      add(g,(j+f)%5===0?'#d7ba77':'#264b60',(j+f)%5===0?2:1);
    }
  }
  // A lit orange portal and canopy face Dolorosa Street to the north.
  const front=Math.min(...zs)-cz;
  add(new THREE.BoxGeometry(14,.45,4).translate(0,4.1,front-1.6),'#dd6e30');
  add(new THREE.BoxGeometry(10,3.5,.22).translate(0,1.8,front-.16),'#244855',1);
  add(new THREE.BoxGeometry(13,.12,.2).translate(0,3.85,front-3.5),'#ffd7a0',2);
  return {cx,cz,front,geometries:groups.map(items=>{if(!items.length)return null;const g=mergeGeometries(items);items.forEach(x=>x.dispose());return g;})};
}
function Building({building}){
  const config=CAMPUS_BUILDINGS[building.id];
  const scene=useMemo(()=>buildCampus(building,config),[building,config]);
  const sign=useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#08283e';ctx.fillRect(0,0,1024,320);
    ctx.fillStyle='#f36c21';ctx.fillRect(0,292,1024,28);ctx.fillStyle='#fff';ctx.textAlign='center';
    ctx.font='bold 155px Arial';ctx.fillText(config.name,512,175);
    ctx.font='bold 44px Arial';ctx.fillText(config.subtitle,512,252);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  },[config]);
  useEffect(()=>()=>{scene.geometries.forEach(g=>g?.dispose());sign.dispose();},[scene,sign]);
  return <group name={config.name} position={[scene.cx,0,scene.cz]}>
    {scene.geometries.map((geometry,i)=>geometry&&<mesh key={i} geometry={geometry} receiveShadow castShadow>
      {i===2?<meshBasicMaterial vertexColors toneMapped={false}/>:<meshStandardMaterial vertexColors roughness={i===1?.28:.8} metalness={i===1?.5:.05} emissive="#55778a" emissiveIntensity={.12}/>}
    </mesh>)}
    <mesh position={[0,config.height-4,scene.front-.3]} rotation={[0,Math.PI,0]}><planeGeometry args={[19,5.94]}/><meshBasicMaterial map={sign} toneMapped={false}/></mesh>
    <mesh position={[0,6.9,scene.front-3.7]} rotation={[0,Math.PI,0]}><planeGeometry args={[10,3.125]}/><meshBasicMaterial map={sign} toneMapped={false}/></mesh>
  </group>;
}
export default function Campus({buildings}){return <group name="UTSA campus">{buildings.filter(b=>CAMPUS_BUILDINGS[b.id]).map(b=><Building key={b.id} building={b}/>)}</group>;}
