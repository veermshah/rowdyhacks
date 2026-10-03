import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fromOsmId } from './seededRandom.js';
const palette=['#354450','#475366','#645b60','#586575','#4b6265','#77665c','#897d69','#686953','#604d45','#687477'];
function colored(g,color){const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function box(w,h,d,x,y,z,color,angle=0){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.rotateY(angle);g.translate(x,y,z);return colored(g,color);}
function merge(items){if(!items.length)return null;const g=mergeGeometries(items,false);items.forEach(a=>a.dispose());return g;}
export function buildBuildingGeometry(buildings,cellSize=Infinity){
    const tiles=new Map();
    for(const b of buildings){
      const pts=b.points;if(pts.length<3)continue;
      const rng=fromOsmId(b.id),height=b.height||b.levels*3.3||(3+Math.floor(rng()*6))*3.3,min=b.minHeight||0;
      if(height<=min)continue;
      const cx=pts.reduce((v,p)=>v+p.x,0)/pts.length,cz=pts.reduce((v,p)=>v+p.z,0)/pts.length;
      const key=`${Math.floor(cx/cellSize)},${Math.floor(cz/cellSize)}`;
      if(!tiles.has(key))tiles.set(key,[[],[],[]]);
      const [bodies,details,lights]=tiles.get(key);
      // OSM winding selects the exterior. The former second window plane
      // was buried inside each opaque building and doubled window geometry.
      const area=pts.reduce((sum,a,i)=>{const b=pts[(i+1)%pts.length];return sum+a.x*b.z-b.x*a.z;},0),outward=area>=0?1:-1;
      // Shape Y becomes world -Z after rotation, so negate projected Z here.
      const shape=new THREE.Shape(pts.map(p=>new THREE.Vector2(p.x,-p.z)));
      const g=new THREE.ExtrudeGeometry(shape,{depth:height-min,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,min,0);
      bodies.push(colored(g,palette[Math.floor(rng()*palette.length)]));
      if(height>25){
        const cx=pts.reduce((v,p)=>v+p.x,0)/pts.length,cz=pts.reduce((v,p)=>v+p.z,0)/pts.length;
        const roof=new THREE.ExtrudeGeometry(shape,{depth:2,bevelEnabled:false});roof.rotateX(-Math.PI/2);roof.translate(-cx,0,-cz);roof.scale(.86,1,.86);roof.translate(cx,height,cz);bodies.push(colored(roof,'#334553'));
      }
      const style=Math.floor(rng()*3),spacing=[2.5,3.3,4.1][style],floorHeight=3.25+rng()*.4;
      const glow=['#f0cd98','#a1c8c5','#e2d9b3'][style];
      if(height>12){
        const cx=pts.reduce((v,p)=>v+p.x,0)/pts.length,cz=pts.reduce((v,p)=>v+p.z,0)/pts.length;
        const cap=new THREE.ExtrudeGeometry(shape,{depth:1.5+rng()*3,bevelEnabled:false});cap.rotateX(-Math.PI/2);cap.translate(-cx,0,-cz);cap.scale(.5+style*.1,1,.5+style*.1);cap.translate(cx,height+(height>25?2:0),cz);bodies.push(colored(cap,'#34454c'));
      }
      for(let i=0;i<pts.length;i++){
        const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<1)continue;
        const angle=-Math.atan2(dz,dx),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
        details.push(box(len,.5,.45,mx,height,mz,'#7b8895',angle));
        if(height>22)lights.push(box(len,.12,.5,mx,height-.5,mz,glow,angle));
        if(style===1&&len>6)for(let d=2;d<len-1;d+=6)details.push(box(.23,height-min,.35,a.x+dx*d/len,min+(height-min)/2,a.z+dz*d/len,'#79847f',angle));
        if(style===2)for(let y=min+4;y<height;y+=7)details.push(box(len,.22,.35,mx,y,mz,'#899189',angle));
        // Thin boxes straddle the wall: both footprint windings remain valid.
        const floors=Math.min(30,Math.floor((height-min-2)/floorHeight));
        for(let floor=0;floor<floors;floor++)for(let d=1.7;d<len-1.2;d+=spacing){
          const lit=rng()>.28,color=lit?glow:'#203a46';
          const window=new THREE.PlaneGeometry([1.3,1.65,2.2][style],[1.65,1.9,1.4][style]).toNonIndexed();
          window.rotateY(angle);window.translate(a.x+dx*d/len+dz/len*.1*outward,min+2.4+floor*floorHeight,a.z+dz*d/len-dx/len*.1*outward);
          lights.push(colored(window,color));
        }
      }
    }
    const chunks=[...tiles.values()].map(([bodies,details,lights])=>[merge([...bodies,...details]),merge(lights)]);
    return cellSize===Infinity?(chunks[0]||[null,null]):chunks;
}
