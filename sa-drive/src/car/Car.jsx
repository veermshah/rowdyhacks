import { game } from '../game/runtime.js';
import { car, roadGrid, buildingGrid } from './state.js';
import { RoundedBox } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { moveWithCollision } from '../lib/collision.js';
import { stepCar } from './physics.js';
import { input } from '../input/input.js';
import { queryNearestRoad } from '../lib/grid.js';

export default function Car() {
  const groupRef = useRef();
  const wheelFLRef = useRef();
  const wheelFRRef = useRef();
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
      car.maxSpeed = 12; // slower off-road
    }

    const oldX=car.x,oldZ=car.z;
    if(game.ready&&game.started&&!game.caught&&!game.paused)moveWithCollision(car, input, delta, buildingGrid, stepCar);
    game.distance+=Math.hypot(car.x-oldX,car.z-oldZ);
    if(reverseLights.current)reverseLights.current.visible=input.reverse||car.v<-.1;
    car.maxSpeed = savedMaxSpeed;

    const g = groupRef.current;
    if (!g) return;

    // Off-road camera shake
    const shakeY = offroad && car.v > 2 ? Math.sin(performance.now() * 0.03) * 0.003 * car.v : 0;

    g.position.set(car.x, shakeY, car.z);
    g.rotation.y = car.yaw;

    // Animate front wheel steering visual
    const visualSteer = game.caught ? 0 : -input.steer * 0.4;
    if (wheelFLRef.current) wheelFLRef.current.rotation.y = visualSteer;
    if (wheelFRRef.current) wheelFRRef.current.rotation.y = visualSteer;
  });

  const bodyColor = '#c5663d';
  const wheelColor = '#333';
  const wheelRadius = 0.3;
  const wheelWidth = 0.2;

  return (
    <group ref={groupRef}>
      {/* Car body */}
      <RoundedBox position={[0, 0.55, 0]} args={[1.8, 0.5, 4.2]} radius={.16} smoothness={2} castShadow>
        <meshStandardMaterial color={bodyColor} metalness={0.55} roughness={0.3} />
      </RoundedBox>
      {/* Cabin */}
      <RoundedBox position={[0, 1.0, -0.2]} args={[1.45, 0.5, 1.8]} radius={.15} smoothness={2} castShadow>
        <meshStandardMaterial color={bodyColor} metalness={0.55} roughness={0.3} />
      </RoundedBox>
      <mesh position={[0,1,-1.115]} rotation={[0,Math.PI,0]}><planeGeometry args={[1.23,.3]}/><meshStandardMaterial color="#183546" metalness={.6} roughness={.2}/></mesh>
      {[-1,1].flatMap(side=>[-1.2,1.2].map(z=><mesh key={`${side},${z}`} position={[side*1.01,.3,z]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.18,.18,.025,12]}/><meshStandardMaterial color="#aabac5" metalness={.8} roughness={.25}/></mesh>))}
      {/* Windshield */}
      <mesh position={[0, 1.0, 0.7]} rotation={[-0.3, 0, 0]}>
        <planeGeometry args={[1.4, 0.5]} />
        <meshStandardMaterial color="#183546" metalness={0.6} roughness={0.18} />
      </mesh>

      <mesh position={[0,.81,1.35]} rotation={[-.08,0,0]} castShadow><boxGeometry args={[1.72,.12,1.2]}/><meshStandardMaterial color={bodyColor} metalness={.6} roughness={.3}/></mesh>
      <mesh position={[0,.36,2.05]}><boxGeometry args={[1.7,.18,.16]}/><meshStandardMaterial color="#182331"/></mesh>
      <mesh position={[0,.55,-2.12]}><boxGeometry args={[1.5,.14,.06]}/><meshBasicMaterial color="#ff3855" toneMapped={false}/></mesh>
      {[-1,1].map(side=><group key={side}>
        <mesh position={[side*.65,.64,2.12]}><boxGeometry args={[.4,.15,.06]}/><meshBasicMaterial color="#d9faff" toneMapped={false}/></mesh>
        <mesh position={[side*.755,1,-.2]}><boxGeometry args={[.03,.36,1.5]}/><meshStandardMaterial color="#123345" metalness={.6} roughness={.2}/></mesh>
        <mesh position={[side*.97,.84,.45]}><boxGeometry args={[.22,.13,.26]}/><meshStandardMaterial color={bodyColor}/></mesh>
      </group>)}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.1,0]}><planeGeometry args={[2.3,4.8]}/><meshBasicMaterial color="#02060c" transparent opacity={.45} depthWrite={false}/></mesh>
      <pointLight position={[0,1,3.5]} color="#b4e7ff" intensity={16} distance={17} decay={2}/>
      <group ref={reverseLights}>{[-.65,.65].map(x=><mesh key={x} position={[x,.38,-2.13]}><boxGeometry args={[.22,.12,.04]}/><meshBasicMaterial color="#e7faff" toneMapped={false}/></mesh>)}</group>
      {/* Front Left */}
      <group ref={wheelFLRef} position={[-0.9, wheelRadius, 1.2]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 20]} />
          <meshLambertMaterial color={wheelColor} />
        </mesh>
      </group>
      {/* Front Right */}
      <group ref={wheelFRRef} position={[0.9, wheelRadius, 1.2]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 20]} />
          <meshLambertMaterial color={wheelColor} />
        </mesh>
      </group>
      {/* Rear Left */}
      <mesh position={[-0.9, wheelRadius, -1.2]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 20]} />
        <meshLambertMaterial color={wheelColor} />
      </mesh>
      {/* Rear Right */}
      <mesh position={[0.9, wheelRadius, -1.2]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[wheelRadius, wheelRadius, wheelWidth, 20]} />
        <meshLambertMaterial color={wheelColor} />
      </mesh>
    </group>
  );
}
