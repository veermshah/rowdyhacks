import * as THREE from 'three';
function grassShader(shader){
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 grassPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ngrassPosition=position.xy;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 grassPosition;').replace('#include <color_fragment>',`#include <color_fragment>
    float broad=sin(grassPosition.x*.047+sin(grassPosition.y*.023)*2.)*sin(grassPosition.y*.061);
    float grain=fract(sin(dot(floor(grassPosition*3.),vec2(12.9898,78.233)))*43758.5453);
    diffuseColor.rgb*=.88+broad*.16+grain*.12;`);
}

export default function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[5000, 5000]} />
      <meshLambertMaterial color="#354f32" onBeforeCompile={grassShader} stencilWrite stencilRef={1} stencilFunc={THREE.NotEqualStencilFunc} stencilFail={THREE.KeepStencilOp} stencilZFail={THREE.KeepStencilOp} stencilZPass={THREE.KeepStencilOp} />
    </mesh>
  );
}
