/**
 * Convert a polyline + width into a ribbon (flat quad strip) geometry.
 * Returns { positions, indices } for BufferGeometry.
 */
export function buildRibbon(points, width, yOffset = 0) {
  // Independent segment rectangles plus round joins form a capsule union.
  // Unlike length-weighted strip normals, uneven OSM samples cannot pinch
  // the width or produce unbounded miter spikes. Opaque coplanar pieces share
  // identical normals/materials, so overlap does not create visible seams.
  const clean=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z)>.001);
  if(clean.length<2||width<=0)return null;
  const positions=[],indices=[],half=width/2;
  const vertex=(x,z)=>{const id=positions.length/3;positions.push(x,yOffset,z);return id;};
  for(let i=1;i<clean.length;i++){
    const a=clean[i-1],b=clean[i],len=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/len*half,nz=(b.x-a.x)/len*half;
    const k=vertex(a.x-nx,a.z-nz);vertex(a.x+nx,a.z+nz);vertex(b.x-nx,b.z-nz);vertex(b.x+nx,b.z+nz);
    indices.push(k,k+1,k+2,k+1,k+3,k+2);
  }
  const arc=(p,start,sweep)=>{
    const center=vertex(p.x,p.z),steps=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/6)));
    for(let j=0;j<=steps;j++){const angle=start+j/steps*sweep;vertex(p.x+Math.cos(angle)*half,p.z+Math.sin(angle)*half);if(j){if(sweep>0)indices.push(center,center+j+1,center+j);else indices.push(center,center+j,center+j+1);}}
  };
  for(let i=0;i<clean.length;i++){
    const p=clean[i];
    if(i===0){const b=clean[1];arc(p,Math.atan2(b.z-p.z,b.x-p.x)+Math.PI/2,Math.PI);}
    else if(i===clean.length-1){const a=clean[i-1];arc(p,Math.atan2(p.z-a.z,p.x-a.x)-Math.PI/2,Math.PI);}
    else {
      const a=clean[i-1],b=clean[i+1],incoming=Math.atan2(p.z-a.z,p.x-a.x),outgoing=Math.atan2(b.z-p.z,b.x-p.x);
      const turn=Math.atan2(Math.sin(outgoing-incoming),Math.cos(outgoing-incoming));
      if(Math.abs(turn)>.001)arc(p,incoming-Math.sign(turn)*Math.PI/2,turn);
    }
  }
  return {positions:new Float32Array(positions),indices};
}

/**
 * Merge multiple ribbons into a single geometry.
 */
export function mergeRibbons(ribbons) {
  let totalVerts = 0;
  let totalIdx = 0;

  for (const r of ribbons) {
    if (!r) continue;
    totalVerts += r.positions.length;
    totalIdx += r.indices.length;
  }

  const positions = new Float32Array(totalVerts);
  const indices = [];
  let vOffset = 0;
  let iVertOffset = 0;

  for (const r of ribbons) {
    if (!r) continue;
    positions.set(r.positions, vOffset);
    for (const idx of r.indices) {
      indices.push(idx + iVertOffset);
    }
    vOffset += r.positions.length;
    iVertOffset += r.positions.length / 3;
  }

  return { positions, indices };
}
