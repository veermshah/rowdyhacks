import { buildBuildingGrid, overlapsBuilding } from '../lib/collision.js';
import { buildRoadGrid, queryNearestRoad } from '../lib/grid.js';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { seededRandom } from '../lib/seededRandom.js';

const TREE_COUNT = 1050;

// Tree colors (live oak, cypress, palm)
const FOLIAGE_COLORS = [
  new THREE.Color('#3a7d44'), // dark green (live oak)
  new THREE.Color('#4a8c5c'), // medium green
  new THREE.Color('#5a9c6c'), // lighter green
  new THREE.Color('#2d6b3a'), // deep green (cypress)
];

const TRUNK_COLOR = new THREE.Color('#6b4226');

export default function Trees({ roads, buildings, bounds }) {
  const { trunkGeom, foliageGeom } = useMemo(() => {
    if (!bounds) return {};

    const rng = seededRandom(42);
    const roadGrid=buildRoadGrid(roads),buildingGrid=buildBuildingGrid(buildings);

    // Build a simple set of positions avoiding roads
    const positions = [];
    const xMin = bounds.xMin || -900;
    const xMax = bounds.xMax || 900;
    const zMin = bounds.zMin || -900;
    const zMax = bounds.zMax || 900;

    // Generate candidate positions
    for (let i = 0; i < TREE_COUNT * 3 && positions.length < TREE_COUNT; i++) {
      const x = xMin + rng() * (xMax - xMin);
      const z = zMin + rng() * (zMax - zMin);

      const road=queryNearestRoad(roadGrid,x,z);
      const tooClose=road.onRoad || road.distance<10 || overlapsBuilding(buildingGrid,x,z,3);

      if (!tooClose) {
        const scale = 0.7 + rng() * 0.8;
        const colorIdx = Math.floor(rng() * FOLIAGE_COLORS.length);
        positions.push({ x, z, scale, colorIdx });
      }
    }

    // Build instanced geometries
    // Trunk: thin cylinder
    const trunkBaseGeom = new THREE.CylinderGeometry(0.15, 0.2, 3, 6);
    trunkBaseGeom.translate(0, 1.5, 0);

    // Foliage: sphere/cone
    const foliageBaseGeom = new THREE.SphereGeometry(1.8, 10, 8);
    foliageBaseGeom.translate(0, 4, 0);

    // Create instanced meshes data
    const trunkMatrices = [];
    const foliageMatrices = [];
    const foliageColors = [];

    const mat4 = new THREE.Matrix4();

    for (const pos of positions) {
      mat4.makeScale(pos.scale, pos.scale, pos.scale);
      mat4.setPosition(pos.x, 0, pos.z);
      trunkMatrices.push(mat4.clone());
      foliageMatrices.push(mat4.clone());
      foliageColors.push(FOLIAGE_COLORS[pos.colorIdx]);
    }

    return {
      trunkGeom: { base: trunkBaseGeom, matrices: trunkMatrices },
      foliageGeom: { base: foliageBaseGeom, matrices: foliageMatrices, colors: foliageColors },
    };
  }, [roads, buildings, bounds]);

  const trunkRef = useRef();
  const foliageRef = useRef();



  if (!trunkGeom || !foliageGeom) return null;

  return (
    <group>
      <instancedMesh
        ref={ref => {
          if (!ref || trunkRef.current === ref) return;
          trunkRef.current = ref;
          for (let i = 0; i < trunkGeom.matrices.length; i++) {
            ref.setMatrixAt(i, trunkGeom.matrices[i]);
          }
          ref.instanceMatrix.needsUpdate = true;
        }}
        args={[trunkGeom.base, undefined, trunkGeom.matrices.length]}
        castShadow
      >
        <meshLambertMaterial color={TRUNK_COLOR} />
      </instancedMesh>

      <instancedMesh
        ref={ref => {
          if (!ref || foliageRef.current === ref) return;
          foliageRef.current = ref;
          for (let i = 0; i < foliageGeom.matrices.length; i++) {
            ref.setMatrixAt(i, foliageGeom.matrices[i]);
            ref.setColorAt(i, foliageGeom.colors[i]);
          }
          ref.instanceMatrix.needsUpdate = true;
          ref.instanceColor.needsUpdate = true;
        }}
        args={[foliageGeom.base, undefined, foliageGeom.matrices.length]}
        castShadow
      >
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}
