import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { renderStats } from '../lib/renderStats.js';
import { car } from './state.js';
const target = new THREE.Vector3(), look = new THREE.Vector3();
export default function CameraRig() {
  const initialized=useRef(false);
  useFrame(({camera,gl},dt)=>{
    renderStats.calls=gl.info.render.calls;renderStats.triangles=gl.info.render.triangles;
    const speed=Math.min(1,Math.abs(car.v)/25),distance=6.5+speed*1.0;
    const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw);
    target.set(car.x-sin*distance,3.0+speed*.4,car.z-cos*distance);
    look.set(car.x+sin*5,1.2,car.z+cos*5);
    if(!initialized.current||camera.position.distanceTo(target)>45){camera.position.copy(target);initialized.current=true;}
    else camera.position.lerp(target,1-Math.exp(-9*dt));
    camera.lookAt(look);
    camera.fov=THREE.MathUtils.lerp(camera.fov,60+10*speed,1-Math.exp(-3*dt));
    camera.updateProjectionMatrix();
  });return null;
}
