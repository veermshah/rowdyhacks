import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fromOsmId } from './seededRandom.js';
const palette=['#354450','#475366','#645b60','#586575','#4b6265','#77665c','#897d69','#686953','#604d45','#687477'];
function colored(g,color){const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;}
function box(w,h,d,x,y,z,color,angle=0){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.rotateY(angle);g.translate(x,y,z);return colored(g,color);}
function merge(items){if(!items.length)return null;const g=mergeGeometries(items,false);items.forEach(a=>a.dispose());return g;}

// Pre-allocate window quad data into raw arrays instead of creating PlaneGeometry per window.
// Each window = 2 triangles = 6 vertices (non-indexed for vertex colors).
function buildWindowBuffer(windowData) {
  if (windowData.length === 0) return null;
  const count = windowData.length;
  const positions = new Float32Array(count * 18); // 6 verts × 3 coords
  const colors = new Float32Array(count * 18);
  const normals = new Float32Array(count * 18);

  for (let i = 0; i < count; i++) {
    const w = windowData[i];
    const { x, y, z, hw, hh, angle, color } = w;
    const c = new THREE.Color(color);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    // Normal facing outward (along the angle direction)
    const nx = sin, nz = cos;
    // Quad corners: left-bottom, right-bottom, right-top, left-top
    // Width along the wall (perpendicular to normal), height along Y
    const lx = -cos * hw, lz = sin * hw;
    const rx = cos * hw, rz = -sin * hw;
    const verts = [
      x + lx, y - hh, z + lz, // 0: left-bottom
      x + rx, y - hh, z + rz, // 1: right-bottom
      x + rx, y + hh, z + rz, // 2: right-top
      x + lx, y - hh, z + lz, // 3: left-bottom
      x + rx, y + hh, z + rz, // 4: right-top
      x + lx, y + hh, z + lz, // 5: left-top
    ];
    const off = i * 18;
    for (let j = 0; j < 18; j++) positions[off + j] = verts[j];
    for (let j = 0; j < 18; j += 3) { normals[off+j]=nx; normals[off+j+1]=0; normals[off+j+2]=nz; }
    for (let j = 0; j < 18; j += 3) { colors[off+j]=c.r; colors[off+j+1]=c.g; colors[off+j+2]=c.b; }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function buildBuildingGeometry(buildings,cellSize=Infinity){
    const tiles=new Map();
    for(const b of buildings){
      const pts=b.points;if(pts.length<3)continue;
      const rng=fromOsmId(b.id),height=b.height||b.levels*3.3||(3+Math.floor(rng()*6))*3.3,min=b.minHeight||0;
      if(height<=min)continue;
      const cx=pts.reduce((v,p)=>v+p.x,0)/pts.length,cz=pts.reduce((v,p)=>v+p.z,0)/pts.length;
      const key=`${Math.floor(cx/cellSize)},${Math.floor(cz/cellSize)}`;
      if(!tiles.has(key))tiles.set(key,{bodies:[],details:[],lights:[],windows:[]});
      const tile=tiles.get(key);
      const area=pts.reduce((sum,a,i)=>{const b=pts[(i+1)%pts.length];return sum+a.x*b.z-b.x*a.z;},0),outward=area>=0?1:-1;
      const shape=new THREE.Shape(pts.map(p=>new THREE.Vector2(p.x,-p.z)));
      const g=new THREE.ExtrudeGeometry(shape,{depth:height-min,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,min,0);
      tile.bodies.push(colored(g,palette[Math.floor(rng()*palette.length)]));
      if(height>25){
        const roof=new THREE.ExtrudeGeometry(shape,{depth:2,bevelEnabled:false});roof.rotateX(-Math.PI/2);roof.translate(-cx,0,-cz);roof.scale(.86,1,.86);roof.translate(cx,height,cz);tile.bodies.push(colored(roof,'#334553'));
      }
      const style=Math.floor(rng()*3),spacing=[2.5,3.3,4.1][style],floorHeight=3.25+rng()*.4;
      const glow=['#f0cd98','#a1c8c5','#e2d9b3'][style];
      if(height>12){
        const cap=new THREE.ExtrudeGeometry(shape,{depth:1.5+rng()*3,bevelEnabled:false});cap.rotateX(-Math.PI/2);cap.translate(-cx,0,-cz);cap.scale(.5+style*.1,1,.5+style*.1);cap.translate(cx,height+(height>25?2:0),cz);tile.bodies.push(colored(cap,'#34454c'));
      }
      const winW=[1.3,1.65,2.2][style]/2, winH=[1.65,1.9,1.4][style]/2;
      for(let i=0;i<pts.length;i++){
        const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<1)continue;
        const angle=-Math.atan2(dz,dx),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
        tile.details.push(box(len,.5,.45,mx,height,mz,'#7b8895',angle));
        if(height>22)tile.lights.push(box(len,.12,.5,mx,height-.5,mz,glow,angle));
        if(style===1&&len>6)for(let d=2;d<len-1;d+=6)tile.details.push(box(.23,height-min,.35,a.x+dx*d/len,min+(height-min)/2,a.z+dz*d/len,'#79847f',angle));
        if(style===2)for(let y=min+4;y<height;y+=7)tile.details.push(box(len,.22,.35,mx,y,mz,'#899189',angle));
        // Windows — collect data, build buffer once at end
        const floors=Math.min(30,Math.floor((height-min-2)/floorHeight));
        for(let floor=0;floor<floors;floor++)for(let d=1.7;d<len-1.2;d+=spacing){
          const lit=rng()>.28,color=lit?glow:'#203a46';
          tile.windows.push({
            x:a.x+dx*d/len+dz/len*.1*outward,
            y:min+2.4+floor*floorHeight,
            z:a.z+dz*d/len-dx/len*.1*outward,
            hw:winW, hh:winH, angle, color
          });
        }
      }
    }
    const chunks=[...tiles.values()].map(tile=>{
      const bodyGeo = merge([...tile.bodies,...tile.details]);
      const windowGeo = buildWindowBuffer(tile.windows);
      // Merge box lights with window buffer
      let lightGeo;
      if(tile.lights.length && windowGeo) {
        const boxLights = merge(tile.lights);
        if(boxLights) { lightGeo = mergeGeometries([boxLights, windowGeo], false); boxLights.dispose(); windowGeo.dispose(); }
        else lightGeo = windowGeo;
      } else if(windowGeo) {
        lightGeo = windowGeo;
      } else {
        lightGeo = merge(tile.lights);
      }
      return [bodyGeo, lightGeo];
    });
    return cellSize===Infinity?(chunks[0]||[null,null]):chunks;
}
