import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { car } from '../car/state.js';

const COUNT = 4000;
const SPREAD = 120;
const HEIGHT = 80;
const SPEED = 45;

export default function Rain() {
  const ref = useRef();

  const positions = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * SPREAD;
      arr[i * 3 + 1] = Math.random() * HEIGHT;
      arr[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
    }
    return arr;
  }, []);

  useFrame((_, dt) => {
    const geo = ref.current;
    if (!geo) return;
    const pos = geo.attributes.position.array;
    const drop = SPEED * Math.min(dt, 0.05);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 1] -= drop;
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3] = car.x + (Math.random() - 0.5) * SPREAD;
        pos[i * 3 + 1] = HEIGHT;
        pos[i * 3 + 2] = car.z + (Math.random() - 0.5) * SPREAD;
      }
    }
    geo.attributes.position.needsUpdate = true;
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={ref}>
        <bufferAttribute attach="attributes-position" array={positions} count={COUNT} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#aaccdd" size={0.15} transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  );
}
