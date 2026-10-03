import { useMemo,useEffect,useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { buildRiverScene } from '../lib/riverGeometry.js';
export default function River({network,roads,buildings}){
  const scene=useMemo(()=>buildRiverScene(network,roads,buildings),[network,roads,buildings]);
  const uniforms=useMemo(()=>THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{time:{value:0}}]),[]);
  const waterMaterial=useRef();
  useFrame((_,dt)=>{if(waterMaterial.current)waterMaterial.current.uniforms.time.value+=Math.min(dt,.05);});
  useEffect(()=>()=>Object.values(scene).forEach(value=>value?.isBufferGeometry&&value.dispose()),[scene]);
  return <group>
    <mesh geometry={scene.mask} renderOrder={-10}><meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} side={THREE.DoubleSide} stencilWrite stencilRef={1} stencilFunc={THREE.AlwaysStencilFunc} stencilFail={THREE.ReplaceStencilOp} stencilZFail={THREE.ReplaceStencilOp} stencilZPass={THREE.ReplaceStencilOp}/></mesh>
    <mesh geometry={scene.water}><shaderMaterial ref={waterMaterial} uniforms={uniforms} fog side={THREE.DoubleSide} vertexShader={`
      varying vec3 riverPosition;
      #include <fog_pars_vertex>
      void main(){riverPosition=(modelMatrix*vec4(position,1.)).xyz;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`} fragmentShader={`
      uniform float time;varying vec3 riverPosition;
      #include <fog_pars_fragment>
      void main(){vec2 p=riverPosition.xz;float wave=sin(p.x*1.5+p.y*.4+time*.7)*sin(p.y*2.2-p.x*.2-time*.45);
        float ripple=pow(max(0.,wave),12.);float fresnel=pow(1.-abs(normalize(cameraPosition-riverPosition).y),3.);
        vec3 water=mix(vec3(.022,.18,.15),vec3(.07,.31,.27),wave*.3+.4);water=mix(water,vec3(.065,.15,.21),fresnel*.5);
        water+=vec3(.14,.21,.17)*ripple*.5;gl_FragColor=vec4(water,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`}/></mesh>
    <mesh geometry={scene.walkways} receiveShadow><meshStandardMaterial color="#b5a386" roughness={.94} emissive="#6a5132" emissiveIntensity={.13} side={THREE.DoubleSide}/></mesh>
    {scene.solid&&<mesh geometry={scene.solid} receiveShadow><meshStandardMaterial vertexColors roughness={.85} emissive="#534535" emissiveIntensity={.13}/></mesh>}
    {scene.foliage&&<mesh geometry={scene.foliage}><meshLambertMaterial vertexColors/></mesh>}
    {scene.lights&&<mesh geometry={scene.lights}><meshBasicMaterial vertexColors toneMapped={false}/></mesh>}
  </group>;
}
