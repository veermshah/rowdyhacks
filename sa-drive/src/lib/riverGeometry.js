import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildRibbon,mergeRibbons } from './ribbon.js';
import { nearestRiver,offsetPath,RIVER_WIDTH,WALKWAY_WIDTH,WATER_Y,WALKWAY_Y,CHANNEL_HALF } from './riverNetwork.js';
import { buildBuildingGrid,overlapsBuilding } from './collision.js';
import { buildRoadGrid,queryNearestRoad } from './grid.js';
function ribbonGeometry(ribbons){const data=mergeRibbons(ribbons.filter(Boolean)),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(data.positions,3));g.setIndex(data.indices);g.computeVertexNormals();return g;}
function colorGeometry(geometry,color){const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();const c=new THREE.Color(color),values=new Float32Array(g.attributes.position.count*3);for(let i=0;i<values.length;i+=3){values[i]=c.r;values[i+1]=c.g;values[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(values,3));return g;}
function merge(items){if(!items.length)return null;const g=mergeGeometries(items,false);items.forEach(g=>g.dispose());return g;}
export function buildRiverScene(network,roads,buildings){
  const water=[],walkways=[],mask=[],solid=[],lights=[],foliage=[],bridges=[];
  const obstacles=buildBuildingGrid(buildings),roadGrid=buildRoadGrid(roads);
  const add=(g,color,target=solid)=>target.push(colorGeometry(g,color));
  const box=(x,y,z,w,h,d,color)=>add(new THREE.BoxGeometry(w,h,d).translate(x,y,z),color);
  const beam=(a,b,w,h,color,target=solid)=>{const start=new THREE.Vector3(a.x,a.y,a.z),end=new THREE.Vector3(b.x,b.y,b.z),delta=end.clone().sub(start),g=new THREE.BoxGeometry(w,h,delta.length());g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);add(g,color,target);};
  for(const path of network.paths){
    water.push(buildRibbon(path,RIVER_WIDTH,WATER_Y));mask.push(buildRibbon(path,CHANNEL_HALF*2+.3,.2));
    for(const side of [-1,1]){
      const inner=offsetPath(path,side*RIVER_WIDTH/2),outer=offsetPath(path,side*CHANNEL_HALF),walk=offsetPath(path,side*(RIVER_WIDTH/2+WALKWAY_WIDTH/2));
      walkways.push(buildRibbon(walk,WALKWAY_WIDTH,WALKWAY_Y));
      for(let i=1;i<path.length;i++){
        beam({...inner[i-1],y:-2.85},{...inner[i],y:-2.85},.32,1.5,'#8e907f');
        beam({...outer[i-1],y:-1.2},{...outer[i],y:-1.2},.5,2.5,'#8e8570');
        beam({...outer[i-1],y:.06},{...outer[i],y:.06},.65,.18,'#c1b08b');
        beam({...inner[i-1],y:-2.08},{...inner[i],y:-2.08},.42,.15,'#c4b28b');
      }
    }
  }
  // Reuse OSM crossings: pedestrian bridges rise from the lower promenade;
  // road bridges keep the same flat drivable surface with arched stone spandrels.
  const used=new Set();
  for(const road of roads){
    if(!road.bridge||road.type.startsWith('motorway'))continue;
    const a=road.points[0],b=road.points.at(-1),len=Math.hypot(b.x-a.x,b.z-a.z),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
    if(len<8||len>70||nearestRiver(network,mx,mz).distance>7)continue;
    const key=`${Math.round(mx/12)},${Math.round(mz/12)}`;if(used.has(key))continue;used.add(key);
    const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,width=road.drivable?road.width:3.0,steps=16;
    const at=(t,side=0,up=0)=>({x:a.x+(b.x-a.x)*t-dz*side,y:(road.drivable?-.08:WALKWAY_Y+2.3*Math.sin(Math.PI*t))+up,z:a.z+(b.z-a.z)*t+dx*side});
    if(!road.drivable)for(let i=0;i<steps;i++)beam(at(i/steps),at((i+1)/steps),width,.38,'#b1a082');
    for(const side of [-1,1]){
      const edge=side*(width/2+.12);
      for(let i=0;i<steps;i++){
        beam(at(i/steps,edge,.9),at((i+1)/steps,edge,.9),.17,.2,'#cbbb99');
        if(i%2===0){const p=at(i/steps,edge,.45);box(p.x,p.y,p.z,.17,.85,.17,'#ac9879');}
      }
      if(road.drivable){
        const shape=new THREE.Shape();shape.moveTo(-len/2,-.05);shape.lineTo(len/2,-.05);shape.lineTo(len/2,-3.4);shape.quadraticCurveTo(0,2,-len/2,-3.4);shape.closePath();
        const g=new THREE.ExtrudeGeometry(shape,{depth:.45,bevelEnabled:false,curveSegments:18});g.translate(0,0,-.225);g.rotateY(-Math.atan2(dz,dx));g.translate(mx-dz*edge,0,mz+dx*edge);add(g,'#aa9879');
      }
    }
    bridges.push({x:mx,z:mz,length:len,drivable:!!road.drivable});
  }
  let propCount=0;const propCells=new Set();
  for(const {a,b,len} of network.segments){
    if(Math.abs(a.x)>650||Math.abs(a.z)>750)continue;
    const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len;
    for(let distance=12;distance<len;distance+=30){
      const center={x:a.x+dx*distance,z:a.z+dz*distance},key=`${Math.round(center.x/24)},${Math.round(center.z/24)}`;
      if(propCells.has(key)||queryNearestRoad(roadGrid,center.x,center.z,5).onRoad)continue;
      propCells.add(key);const side=propCount%2?1:-1,offset=side*(CHANNEL_HALF-.65),x=center.x-dz*offset,z=center.z+dx*offset;
      if(overlapsBuilding(obstacles,x,z,1))continue;
      // Cypress silhouette: flared trunk and staggered, elongated leaf clusters.
      add(new THREE.CylinderGeometry(.2,.5,5.5,8).translate(x,.6,z),'#655346');
      for(let tier=0;tier<3;tier++){
        const g=new THREE.SphereGeometry(1,10,7);g.scale(1.5-tier*.25,2.2-tier*.2,1.25-tier*.17);g.translate(x+.25*tier,3.2+tier*1.25,z);add(g,['#28614e','#31725a','#438169'][tier],foliage);
      }
      const lx=center.x+dz*(CHANNEL_HALF-.55)*side,lz=center.z-dx*(CHANNEL_HALF-.55)*side;
      add(new THREE.CylinderGeometry(.065,.1,3,6).translate(lx,-.65,lz),'#354746');
      add(new THREE.SphereGeometry(.19,8,6).translate(lx,.9,lz),'#ffe1a7',lights);
      if(propCount%3===0){
        const px=center.x-dz*(RIVER_WIDTH/2+1.5)*side,pz=center.z+dx*(RIVER_WIDTH/2+1.5)*side;
        box(px,-1.85,pz,1.7,.5,.6,'#70604c');box(px,-1.45,pz+.22,1.7,.55,.14,'#9d896b');
      }
      if(propCount%7===0){
        const px=center.x-dz*(RIVER_WIDTH/2+1.55)*side,pz=center.z+dx*(RIVER_WIDTH/2+1.55)*side;
        add(new THREE.CylinderGeometry(.7,.7,.1,12).translate(px,-1.38,pz),'#b29a76');
        add(new THREE.CylinderGeometry(.08,.1,.8,6).translate(px,-1.78,pz),'#4b5146');
        add(new THREE.ConeGeometry(1.65,.6,12).translate(px,.3,pz),'#9c6f51');
        add(new THREE.CylinderGeometry(.045,.045,2.3,6).translate(px,-.9,pz),'#75654e');
        const left={x:px-dx*4,y:.75,z:pz-dz*4},right={x:px+dx*4,y:.75,z:pz+dz*4};
        beam(left,right,.025,.025,'#3e4e47');
        for(let j=0;j<7;j++)add(new THREE.SphereGeometry(.085,6,4).translate(left.x+dx*j*1.33,.7-Math.sin(j/6*Math.PI)*.35,left.z+dz*j*1.33),'#ffdfa0',lights);
      }
      if(++propCount>=100)break;
    }
    if(propCount>=100)break;
  }
  return {water:ribbonGeometry(water),walkways:ribbonGeometry(walkways),mask:ribbonGeometry(mask),solid:merge(solid),lights:merge(lights),foliage:merge(foliage),bridges,propCount};
}
