import { useMemo } from 'react';
import * as THREE from 'three';
import { buildRibbon, mergeRibbons } from '../lib/ribbon.js';

const RIVER_WIDTH = 12; // meters
const WATER_Y = 0.022;
const WALKWAY_Y = 0.025;
const WALKWAY_WIDTH = 3;

export default function River({ water }) {
  const { waterGeom, walkwayGeom } = useMemo(() => {
    if (!water || water.length === 0) return {};

    const waterRibbons = [];
    const walkRibbons = [];

    for (const w of water) {
      if (w.points.length < 2) continue;

      // Water surface
      const waterR = buildRibbon(w.points, RIVER_WIDTH, WATER_Y);
      if (waterR) waterRibbons.push(waterR);

      // Walkways on both sides
      const walkL = w.points.map(p => ({
        x: p.x - RIVER_WIDTH / 2 - WALKWAY_WIDTH / 2,
        z: p.z,
      }));
      const walkR = w.points.map(p => ({
        x: p.x + RIVER_WIDTH / 2 + WALKWAY_WIDTH / 2,
        z: p.z,
      }));

      const wlr = buildRibbon(walkL, WALKWAY_WIDTH, WALKWAY_Y);
      const wrr = buildRibbon(walkR, WALKWAY_WIDTH, WALKWAY_Y);
      if (wlr) walkRibbons.push(wlr);
      if (wrr) walkRibbons.push(wrr);
    }

    const wg = waterRibbons.length > 0 ? mergeRibbons(waterRibbons) : null;
    const wkg = walkRibbons.length > 0 ? mergeRibbons(walkRibbons) : null;

    function toGeom(merged) {
      if (!merged) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(merged.positions, 3));
      g.setIndex(merged.indices);
      g.computeVertexNormals();
      return g;
    }

    return { waterGeom: toGeom(wg), walkwayGeom: toGeom(wkg) };
  }, [water]);

  return (
    <group>
      {waterGeom && (
        <mesh geometry={waterGeom}>
          <meshLambertMaterial color="#123d50" emissive="#146e82" emissiveIntensity={0.45} />
        </mesh>
      )}
      {walkwayGeom && (
        <mesh geometry={walkwayGeom}>
          <meshLambertMaterial color="#697a80" />
        </mesh>
      )}
    </group>
  );
}
