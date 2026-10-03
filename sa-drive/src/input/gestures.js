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
// Joint geometry uses world coordinates; upward direction uses the unmirrored
// image (y increases down). Neither test depends on left/right handedness.
export function isThumbsUp(points,image=points) {
  if(!points||points.length<21||!image||image.length<21)return false;
  const scale=distance(points[0],points[9]);if(scale<1e-6)return false;
  for(const m of [5,9,13,17]) {
    const [base,pip,dip,tip]=points.slice(m,m+4);
    if(straight(base,pip,dip)||distance(tip,base)>distance(pip,base)*1.25||distance(tip,points[0])>distance(pip,points[0])*1.05)return false;
  }
  if(!straight(points[1],points[2],points[3])||!straight(points[2],points[3],points[4]))return false;
  if(distance(points[4],points[5])<scale*.65||distance(points[4],points[0])<distance(points[2],points[0])*1.2)return false;
  const up=image[2].y-image[4].y,side=Math.abs(image[4].x-image[2].x);
  const imageScale=Math.hypot(image[0].x-image[9].x,image[0].y-image[9].y);
  return up>imageScale*.35&&up>side*1.4&&image[4].y<image[5].y-imageScale*.15;
}
export function createRearGesture(){return {active:false,candidate:false,since:0,last:null};}
export function updateRearGesture(state,valid,time){
  if(state.last!==null&&time-state.last>120){state.candidate=false;state.since=time;if(time-state.last>300)state.active=false;}
  state.last=time;
  if(valid!==state.candidate){state.candidate=valid;state.since=time;}
  if(time-state.since>=(valid?200:160))state.active=valid;
  return state.active;
}
export function rearViewActive(state,time){return state.rearView&&time-state.rearViewUpdatedAt<300;}
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
