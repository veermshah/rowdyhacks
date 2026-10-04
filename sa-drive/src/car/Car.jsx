import { game } from '../game/runtime.js';
import { car, roadGrid, buildingGrid } from './state.js';
import SedanModel from './SedanModel.jsx';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { moveWithCollision } from '../lib/collision.js';
import { stepCar } from './physics.js';
import { input } from '../input/input.js';
import { queryNearestRoad } from '../lib/grid.js';

export default function Car() {
  const groupRef = useRef();
  const reverseLights=useRef();
  useFrame((_, delta) => {
    // Off-road detection
    let offroad = false;
    if (roadGrid) {
      const result = queryNearestRoad(roadGrid, car.x, car.z);
      car.nearestRoadDist = result.distance;
      offroad = !result.onRoad;
    }
    car.offroad = offroad;

    // Apply off-road penalty
    const savedMaxSpeed = car.maxSpeed;
    if (offroad) {
      car.maxSpeed = 18; // slower off-road
    }

    const oldX=car.x,oldZ=car.z;
    if(game.ready&&game.started&&!game.caught&&!game.paused)moveWithCollision(car, input, delta, buildingGrid, stepCar);
    game.distance+=Math.hypot(car.x-oldX,car.z-oldZ);
    if(reverseLights.current)reverseLights.current.visible=input.reverse||car.v<-.1;
    car.maxSpeed = savedMaxSpeed;

    const g = groupRef.current;
    if (!g) return;

    // Off-road camera shake
    const shakeY = offroad && car.v > 2 ? Math.sin(performance.now() * 0.02) * 0.001 * car.v : 0;

    g.position.set(car.x, shakeY, car.z);
    g.rotation.y = car.yaw;

  });

  return (
    <group ref={groupRef}>
      <SedanModel />
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.025,0]}><planeGeometry args={[3,6.2]}/><meshBasicMaterial color="#02060c" transparent opacity={.45} depthWrite={false}/></mesh>
      <pointLight position={[0,1.2,4.5]} color="#b4e7ff" intensity={20} distance={22} decay={2}/>
      <group ref={reverseLights} visible={false}>{[-.77,.77].map(x=><mesh key={x} position={[x,.58,-2.65]}><boxGeometry args={[.28,.08,.03]}/><meshBasicMaterial color="#e7faff" toneMapped={false}/></mesh>)}</group>
    </group>
  );
}
