import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function builder(){
  const stone=[],glass=[],lights=[];
  const add=(geometry,color,target=stone)=>{const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();const c=new THREE.Color(color),colors=new Float32Array(g.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));target.push(g);};
  const box=(x,y,z,w,h,d,color,target=stone)=>add(new THREE.BoxGeometry(w,h,d).translate(x,y,z),color,target);
  const cylinder=(x,y,z,top,bottom,height,color,target=stone,segments=48)=>add(new THREE.CylinderGeometry(top,bottom,height,segments).translate(x,y,z),color,target);
  const finish=()=>[stone,glass,lights].map(items=>{if(!items.length)return null;const merged=mergeGeometries(items,false);items.forEach(g=>g.dispose());return merged;});
  return {add,box,cylinder,finish,glass,lights};
}
export function buildTower(){
  const {add,box,cylinder,finish,glass,lights}=builder();
  cylinder(0,.35,0,14.8,14.8,.7,'#afa18a');
  cylinder(0,2.2,0,13.5,13.5,3.5,'#b8afa0');
  cylinder(0,2.6,0,13.55,13.55,1.9,'#31545d',glass);
  cylinder(0,4.2,0,13.9,14.2,.5,'#b4b5a7');
  cylinder(0,88,0,4.8,5.4,172,'#bcb5a7');
  // Fluted concrete core and a restrained elevator glazing strip.
  for(let i=0;i<8;i++){const a=i*Math.PI/4;cylinder(Math.sin(a)*5.05,88,Math.cos(a)*5.05,.46,.6,169,'#d0c5af',undefined,10);}
  box(0,88,5.43,1.25,165,.18,'#335761',glass);
  cylinder(0,174,0,18.6,5.8,8,'#b5b5a8');
  cylinder(0,178.7,0,19,19,1.4,'#d1c4a8');
  cylinder(0,181.5,0,18.35,18.35,4.2,'#41656a',glass);
  cylinder(0,184,0,19.1,19.1,.9,'#d1c4a8');
  cylinder(0,186.3,0,17.8,17.8,3.5,'#587874',glass);
  cylinder(0,189.1,0,19.9,18.3,1.8,'#b7b7a6');
  cylinder(0,190.7,0,14.9,19.9,1.4,'#899c91');
  cylinder(0,178.1,0,19.05,19.05,.16,'#f8d296',lights);
  cylinder(0,188.2,0,18.55,18.55,.12,'#bbddd1',lights);
  for(let i=0;i<36;i++){
    const a=i*Math.PI*2/36,x=Math.sin(a)*18.4,z=Math.cos(a)*18.4;
    cylinder(x,181.5,z,.1,.1,4.25,'#c2b69a',undefined,6);
  }
  cylinder(0,209.8,0,.17,.38,37.6,'#a0aaa4',undefined,10);
  add(new THREE.SphereGeometry(.42,10,6).translate(0,228.6,0),'#f66e68',lights);
  return finish();
}
export function alamoFacadeShape(){
  const s=new THREE.Shape();s.moveTo(-11.5,0);s.lineTo(11.5,0);s.lineTo(11.5,9.4);s.lineTo(7.2,9.4);
  s.bezierCurveTo(7.1,10.1,5.1,9.8,4.5,11.2);s.bezierCurveTo(3.4,14,-3.4,14,-4.5,11.2);s.bezierCurveTo(-5.1,9.8,-7.1,10.1,-7.2,9.4);s.lineTo(-11.5,9.4);s.closePath();
  const door=new THREE.Path();door.moveTo(-1.5,.1);door.lineTo(1.5,.1);door.lineTo(1.5,3.2);door.absarc(0,3.2,1.5,0,Math.PI,false);door.closePath();s.holes.push(door);
  return s;
}
export function buildAlamo(){
  const {add,box,cylinder,finish,glass}=builder();
  // The broad nave extends behind the west-facing church facade.
  box(0,4.4,-9,22,8.8,32,'#c4b398');
  box(0,8.85,-9,21.4,.28,31,'#8e9389');
  box(-11.2,4.2,-8,1.2,8.4,30,'#bbaa8e');box(11.2,4.2,-8,1.2,8.4,30,'#bbaa8e');
  const shape=alamoFacadeShape();add(new THREE.ExtrudeGeometry(shape,{depth:.75,bevelEnabled:false,curveSegments:18}).translate(0,0,7.1),'#dfc9a5');
  const door=new THREE.Shape();door.moveTo(-1.5,.1);door.lineTo(1.5,.1);door.lineTo(1.5,3.2);door.absarc(0,3.2,1.5,0,Math.PI,false);door.closePath();add(new THREE.ExtrudeGeometry(door,{depth:.06,bevelEnabled:false,curveSegments:16}).translate(0,0,7.28),'#483a2b');
  box(0,2,7.38,.045,3.8,.06,'#1b292a');
  add(new THREE.TorusGeometry(1.7,.16,6,24,Math.PI).translate(0,3.2,7.98),'#bda580');
  for(const side of [-1,1]){
    for(const x of [2.25,3.05]){
      cylinder(side*x,2.85,8.05,.22,.25,5.2,'#ccb38c',undefined,12);
      box(side*x,.38,8.05,.6,.5,.62,'#b79e79');box(side*x,5.35,8.05,.66,.35,.7,'#e0cbaa');
    }
    cylinder(side*2.6,7.2,8.02,.17,.2,2.3,'#c4aa82',undefined,12);
    box(side*5.6,4.5,7.91,1.1,2,.06,'#88795e');
    add(new THREE.CircleGeometry(.55,16,0,Math.PI).translate(side*5.6,5.5,7.95),'#88795e');
    box(side*5.6,3.4,8.0,1.5,.2,.4,'#dcc39b');
    box(side*10.8,4.7,7.95,.42,9.4,.3,'#c4ac88');
    // Selective limestone courses; no large textures or per-stone components.
    for(let row=1;row<10;row++)box(side*8.9,row*.88,7.88,4.2,.035,.025,'#bda989');
  }
  box(0,5.65,8.1,7,.35,.75,'#d8be96');box(0,8.55,8.0,6.2,.3,.55,'#dbc6a3');
  add(new THREE.CircleGeometry(.7,24).translate(0,7.25,7.93),'#304449',glass);
  add(new THREE.TorusGeometry(.85,.17,8,24).translate(0,7.25,8.03),'#baa180');
  box(0,7.25,8.05,.055,1.4,.03,'#a8997d');box(0,7.25,8.05,1.4,.055,.03,'#a8997d');
  return finish();
}
