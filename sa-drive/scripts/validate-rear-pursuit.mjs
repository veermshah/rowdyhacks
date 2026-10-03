import assert from 'node:assert/strict';
import { isThumbsUp,isOpenHand,createRearGesture,updateRearGesture,rearViewActive } from '../src/input/gestures.js';
import { policeTargetSpeed,angleDelta } from '../src/game/policeDriving.js';
import { POLICE_CONFIG as C } from '../src/config/policeConfig.js';
function hand(open=false){
  const h=Array.from({length:21},()=>({x:0,y:0,z:0}));
  for(const [i,m] of [5,9,13,17].entries())for(let j=0;j<4;j++)h[m+j]={x:(i-1.5)*.3,y:open?1+j:[1,2,1.5,.9][j],z:0};
  for(const [i,p] of [[-.6,.9],[-.8,.5],[-1,-.1],[-1.2,-.7]].entries())h[i+1]={x:p[0],y:p[1],z:0};
  return h;
}
for(const mirror of [-1,1])for(const scale of [.1,1,3]){
  const h=hand().map(p=>({x:p.x*mirror*scale,y:p.y*scale,z:0}));
  assert(isThumbsUp(h));assert(!isOpenHand(h));
  assert(!isThumbsUp(hand(true)),'open reverse/steering hands are not thumbs-up');
  const sideways=h.map(p=>({x:-p.y,y:p.x,z:0}));assert(!isThumbsUp(sideways));
  const down=h.map(p=>({x:p.x,y:-p.y,z:0}));assert(!isThumbsUp(down));
  h[4]={...h[2]};assert(!isThumbsUp(h),'folded thumb rejected');
}
const g=createRearGesture();
for(const t of [0,40,80,120,160])assert(!updateRearGesture(g,true,t));
assert(updateRearGesture(g,true,200));
for(const t of [240,280,320,360])assert(updateRearGesture(g,false,t));
assert(!updateRearGesture(g,false,400));
updateRearGesture(g,true,450);updateRearGesture(g,false,500);assert(!updateRearGesture(g,true,550),'brief gesture cannot activate');
assert(!updateRearGesture(g,true,1000),'missing frames cannot count toward activation');
assert(!rearViewActive({rearView:true,rearViewUpdatedAt:0},301),'stalled tracker releases camera');
const player={maxSpeed:25,v:20},cop={x:0,z:0,yaw:0,index:0,route:{points:[{x:0,z:15},{x:0,z:40}]}};
assert.equal(policeTargetSpeed(cop,player),20);
assert.equal(policeTargetSpeed(cop,{...player,v:0}),23.75);
assert(policeTargetSpeed(cop,player)<player.maxSpeed,'good driving gains distance');
cop.route.points[1]={x:25,z:15};assert.equal(policeTargetSpeed(cop,player),20*C.sharpTurnRatio);
cop.route.points[1]={x:20,z:35};assert(Math.abs(policeTargetSpeed(cop,player)-20*C.moderateTurnRatio)<1e-6);
assert(Math.abs(angleDelta(-Math.PI+.1,Math.PI-.1)-.2)<1e-6);
assert(C.spawnDistance>=170&&C.spawnDistance<=220);assert(C.routeUpdateMin>=.8&&C.routeUpdateMax<=1.5);
console.log('PASS: mirrored/scaled thumbs-up, curled fingers/upward thumb, open/sideways/down rejection, press/release debounce, tracking loss, pursuit speed caps and corner braking');
