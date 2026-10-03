import * as THREE from 'three';
import { GROUND_COLOR } from '../config/worldConfig.js';

export default function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[2000, 2000]} />
      <meshLambertMaterial color={GROUND_COLOR} stencilWrite stencilRef={1} stencilFunc={THREE.NotEqualStencilFunc} stencilFail={THREE.KeepStencilOp} stencilZFail={THREE.KeepStencilOp} stencilZPass={THREE.KeepStencilOp} />
    </mesh>
  );
}
