// 2D footprint broad phase; no per-triangle physics. A conservative circle
// contains the entire 4.2 x 1.8m vehicle at every heading.
export const CAR_RADIUS = 2.3;
const CELL = 32;
export function buildBuildingGrid(buildings) {
  const grid = new Map();
  for (const b of buildings) {
    if (b.minHeight > 2 || b.points.length < 3) continue;
    const xs=b.points.map(p=>p.x), zs=b.points.map(p=>p.z);
    for(let x=Math.floor((Math.min(...xs)-CAR_RADIUS)/CELL);x<=Math.floor((Math.max(...xs)+CAR_RADIUS)/CELL);x++)
      for(let z=Math.floor((Math.min(...zs)-CAR_RADIUS)/CELL);z<=Math.floor((Math.max(...zs)+CAR_RADIUS)/CELL);z++) {
        const k=`${x},${z}`; if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(b.points);
      }
  }
  return grid;
}
export function overlapsBuilding(grid,x,z,radius=CAR_RADIUS) {
  for(const pts of grid?.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`) || []) {
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++) {
      const a=pts[j],b=pts[i], dx=b.x-a.x,dz=b.z-a.z;
      if((a.z>z)!==(b.z>z) && x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x) inside=!inside;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
      if(Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<radius) return true;
    }
    if(inside) return true;
  }
  return false;
}
export function safeRoadSpawn(roads, grid, target) {
  let best=null, distance=Infinity;
  for(const road of roads) {
    if(!road.drivable) continue;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],len=Math.hypot(b.x-a.x,b.z-a.z);
      const steps=Math.max(1,Math.ceil(len/5));
      for(let n=0;n<=steps;n++) {
        const x=a.x+(b.x-a.x)*n/steps,z=a.z+(b.z-a.z)*n/steps;
        const d=Math.hypot(x-target.x,z-target.z);
        if(d<distance && !overlapsBuilding(grid,x,z)) { distance=d; best={x,z,yaw:Math.atan2(b.x-a.x,b.z-a.z)}; }
      }
    }
  }
  return best;
}
export function moveWithCollision(car, input, dt, grid, step) {
  if(overlapsBuilding(grid,car.x,car.z)) {
    if(car.safePosition) Object.assign(car,car.safePosition);
    car.v=0; return;
  }
  const count=Math.max(1,Math.ceil(Math.min(dt,.05)*Math.max(Math.abs(car.v),1)/.35));
  for(let i=0;i<count;i++) {
    const x=car.x,z=car.z;
    step(car,input,Math.min(dt,.05)/count);
    if(overlapsBuilding(grid,car.x,car.z)) {
      car.impactSpeed=Math.abs(car.v);car.impactSerial=(car.impactSerial||0)+1;
      car.x=x;car.z=z;car.v=0;break;
    }
  }
  car.safePosition={x:car.x,z:car.z,yaw:car.yaw};
}
