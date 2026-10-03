// Four fingers, independent of screen rotation or thumb pose. World landmarks
// use metric XYZ; normalized XYZ is a fallback when world data is unavailable.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
function straight(a,b,c) {
  const u=[a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)],v=[c.x-b.x,c.y-b.y,(c.z||0)-(b.z||0)];
  const len=Math.hypot(...u)*Math.hypot(...v);
  return len>1e-8 && u.reduce((s,n,i)=>s+n*v[i],0)/len < -.72;
}
export function isOpenHand(points) {
  if(!points || points.length<21)return false;
  let extended=0;
  for(const m of [5,9,13,17]) {
    const [base,pip,dip,tip]=points.slice(m,m+4);
    if(straight(base,pip,dip)&&straight(pip,dip,tip)&&distance(points[0],tip)>distance(points[0],pip)*1.12)extended++;
  }
  return extended>=3;
}
export function createGearGesture(){return {reverse:false,candidate:null,since:0,last:null};}
export function updateGearGesture(state,hands,time) {
  // Missing tracking cannot count toward either stable transition.
  if(!hands||hands.length!==2){state.candidate=null;state.last=null;return state.reverse;}
  if(state.last!==null && time-state.last>120)state.candidate=null;
  state.last=time;
  const open=hands.every(isOpenHand);
  if(open!==state.candidate){state.candidate=open;state.since=time;}
  if(time-state.since>=160)state.reverse=open;
  return state.reverse;
}
