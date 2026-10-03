import { ROUTE_WIDTH_RATIO } from '../config/routeStyle.js';
// A continuous, variable-width ribbon. Shared mitered vertices avoid cracks
// and transparent overlap seams between the route's short graph edges.
export function buildRouteRibbon(points,y=.115){
  const positions=[],indices=[];
  for(let i=0;i<points.length;i++){
    const at=points[i],before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
    let ax=at.x-before.x,az=at.z-before.z,bx=after.x-at.x,bz=after.z-at.z;
    let al=Math.hypot(ax,az),bl=Math.hypot(bx,bz);
    if(al<.001){ax=bx;az=bz;al=bl;}if(bl<.001){bx=ax;bz=az;bl=al;}
    ax/=al||1;az/=al||1;bx/=bl||1;bz/=bl||1;
    let nx=-az-bz,nz=ax+bx;const nl=Math.hypot(nx,nz);
    if(nl<.001){nx=-bz;nz=bx;}else{nx/=nl;nz/=nl;}
    const half=((at.width||12)*ROUTE_WIDTH_RATIO)/2;
    const miter=half/Math.max(.55,Math.abs(nx*(-bz)+nz*bx));
    positions.push(at.x-nx*miter,y,at.z-nz*miter,at.x+nx*miter,y,at.z+nz*miter);
    if(i){const k=(i-1)*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  return {positions:new Float32Array(positions),indices};
}
