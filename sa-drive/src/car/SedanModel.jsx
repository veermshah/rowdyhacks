import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { MeshBasicMaterial, MeshStandardMaterial } from 'three';

const MODEL = '/models/car-sedan-01.glb';
// The supplied sedan faces +Z. Scaled up ~30% from original 4.2 m length.
const SCALE = 5.5 / (2.30945 + .7475);
export default function SedanModel() {
  const { scene } = useGLTF(MODEL, '/draco/');
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geometry = mesh.geometry.clone();
      const positions = geometry.attributes.position;
      const colors = geometry.attributes.color;
      const index = geometry.index;
      const groups = [[], [], []];
      // Assign the model's actual lamp faces luminous materials; retain its paint/glass.
      for (let i = 0; i < index.count; i += 3) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        const head = ids.every(v => positions.getZ(v) > 2.18 && positions.getY(v) > .47 && colors.getX(v) > .8 && colors.getY(v) > .65 && colors.getZ(v) > .4);
        const tail = ids.every(v => positions.getZ(v) < -.45 && colors.getX(v) > .45 && colors.getY(v) < .1 && colors.getZ(v) < .1);
        groups[head ? 1 : tail ? 2 : 0].push(...ids);
      }
      geometry.setIndex(groups.flat());
      geometry.clearGroups();
      let start = 0;
      groups.forEach((indices, material) => {
        geometry.addGroup(start, indices.length, material);
        start += indices.length;
      });
      mesh.geometry = geometry;
      mesh.material = [new MeshStandardMaterial({ color: '#0a0a0a', metalness: 0.8, roughness: 0.2 }), new MeshBasicMaterial({ color: '#d9faff', toneMapped: false }), new MeshBasicMaterial({ color: '#ff3855', toneMapped: false })];
      // Remove the export offset; place tire bottoms on the road and center the body.
      mesh.position.set(0, -.003258744, -.780974954);
    });
    return clone;
  }, [scene]);
  return <primitive object={model} scale={SCALE} />;
}
useGLTF.preload(MODEL, '/draco/');
