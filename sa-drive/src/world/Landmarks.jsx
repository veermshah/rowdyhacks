import { useMemo } from 'react';
import { LANDMARKS } from '../config/landmarkConfig.js';
import { toLocal } from '../config/worldConfig.js';

/** Tower of the Americas — built from primitives */
function TowerOfAmericas() {
  const pos = useMemo(() => {
    const cfg = LANDMARKS.towerOfAmericas;
    const local = toLocal(cfg.lat, cfg.lon);
    return [local.x + cfg.anchorOffset.x, cfg.anchorOffset.y, local.z + cfg.anchorOffset.z];
  }, []);

  return (
    <group position={pos}>
      {/* Base platform */}
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[12, 15, 4, 8]} />
        <meshLambertMaterial color="#c8bfb0" />
      </mesh>
      {/* Tower shaft */}
      <mesh position={[0, 100, 0]} castShadow>
        <cylinderGeometry args={[2.5, 3, 196, 20]} />
        <meshLambertMaterial color="#d4cdc0" />
      </mesh>
      {/* Observation deck */}
      <mesh position={[0, 175, 0]} castShadow>
        <cylinderGeometry args={[14, 12, 16, 24]} />
        <meshLambertMaterial color="#668996" emissive="#41b9cf" emissiveIntensity={.7} />
      </mesh>
      {/* Top restaurant ring */}
      <mesh position={[0, 186, 0]} castShadow>
        <cylinderGeometry args={[10, 14, 6, 24]} />
        <meshLambertMaterial color="#d4cdc0" />
      </mesh>
      {/* Antenna */}
      <mesh position={[0, 215, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 50, 4]} />
        <meshLambertMaterial color="#999" />
      </mesh>
    </group>
  );
}

/** The Alamo — simplified iconic facade */
function Alamo() {
  const pos = useMemo(() => {
    const cfg = LANDMARKS.alamo;
    const local = toLocal(cfg.lat, cfg.lon);
    return [local.x + cfg.anchorOffset.x, cfg.anchorOffset.y, local.z + cfg.anchorOffset.z];
  }, []);

  const limestone = '#e8dcc8';
  const limestoneDark = '#d4c4a8';

  return (
    <group position={pos}>
      {/* Main building body */}
      <mesh position={[0, 4, 0]} castShadow>
        <boxGeometry args={[22, 8, 14]} />
        <meshLambertMaterial color={limestone} emissive="#c18a4a" emissiveIntensity={.35} />
      </mesh>

      {/* Facade — the iconic curved-top front */}
      <mesh position={[0, 9, 7.5]} castShadow>
        <boxGeometry args={[16, 10, 1]} />
        <meshLambertMaterial color={limestone} emissive="#c18a4a" emissiveIntensity={.35} />
      </mesh>

      {/* Curved parapet top (simplified as a sphere segment) */}
      <mesh position={[0, 14.5, 7.5]} castShadow>
        <sphereGeometry args={[5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color={limestone} emissive="#c18a4a" emissiveIntensity={.35} />
      </mesh>

      {/* Entrance arch */}
      <mesh position={[0, 3, 7.6]}>
        <boxGeometry args={[3, 5, 0.5]} />
        <meshLambertMaterial color={limestoneDark} />
      </mesh>

      {/* Left column */}
      <mesh position={[-5.5, 5, 7.3]} castShadow>
        <boxGeometry args={[1.5, 10, 1.5]} />
        <meshLambertMaterial color={limestoneDark} />
      </mesh>
      {/* Right column */}
      <mesh position={[5.5, 5, 7.3]} castShadow>
        <boxGeometry args={[1.5, 10, 1.5]} />
        <meshLambertMaterial color={limestoneDark} />
      </mesh>

      {/* Side wings */}
      <mesh position={[-14, 3, 0]} castShadow>
        <boxGeometry args={[6, 6, 10]} />
        <meshLambertMaterial color={limestone} emissive="#c18a4a" emissiveIntensity={.35} />
      </mesh>
      <mesh position={[14, 3, 0]} castShadow>
        <boxGeometry args={[6, 6, 10]} />
        <meshLambertMaterial color={limestone} emissive="#c18a4a" emissiveIntensity={.35} />
      </mesh>
    </group>
  );
}

export default function Landmarks() {
  return (
    <group>
      <TowerOfAmericas />
      <Alamo />
    </group>
  );
}
