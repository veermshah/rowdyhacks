import assert from 'node:assert/strict';
import { isOpenHand,isFist,createGestureState,updateGestureState,rearViewActive } from '../src/input/gestures.js';
import { policeTargetSpeed,angleDelta,updatePoliceBoost } from '../src/game/policeDriving.js';
import { POLICE_CONFIG as C } from '../src/config/policeConfig.js';
function hand(open=false){
  const h=Array.from({length:21},()=>({x:0,y:0,z:0}));
  for(const [i,m] of [5,9,13,17].entries())for(let j=0;j<4;j++)h[m+j]={x:(i-1.5)*.3,y:open?1+j:[1,2,1.5,.9][j],z:0};
  for(const [i,p] of [[-.6,.9],[-.8,.5],[-1,-.1],[-1.2,-.7]].entries())h[i+1]={x:p[0],y:p[1],z:0};
  return h;
}
// Rear view is now "one fist + one open hand" in the unified gesture state
// machine (gestures.js), not a dedicated thumbs-up detector - isThumbsUp no
// longer exists. isFist only looks at the four fingers (not the thumb), so
// this keeps the mirror/scale invariance checks but drops the old
// thumb-orientation-specific sub-cases (sideways/down/folded thumb), which
// have no isFist analog.
const fistHand=hand(),openHand=hand(true);
for(const mirror of [-1,1])for(const scale of [.1,1,3]){
  const h=fistHand.map(p=>({x:p.x*mirror*scale,y:p.y*scale,z:0}));
  assert(isFist(h));assert(!isOpenHand(h));
}
assert(!isFist(openHand),'open reverse/steering hand is not a fist');
// Enter/leave rear view through the same state machine reverse uses, with
// ENTER_REAR_MS=220 / LEAVE_REAR_MS=180 (consecutive calls kept within
// MAX_FRAME_GAP=200ms, same as real per-frame polling, so the tracking-loss
// gap-reset path doesn't fire early).
const rg=createGestureState();
const rearAt=(hands,t)=>updateGestureState(rg,hands,t).rearView;
for(const t of [0,40,80,120,160,200])assert.equal(rearAt([fistHand,openHand],t),false);
assert.equal(rearAt([fistHand,openHand],240),true,'held one-fist-one-open 220ms+ enters rear view');
for(const t of [260,300,340,380,420])assert.equal(rearAt([fistHand,fistHand],t),true);
assert.equal(rearAt([fistHand,fistHand],460),false,'held closed 180ms+ leaves rear view');
assert(!rearViewActive({rearView:true,rearViewUpdatedAt:0},301),'stalled tracker releases camera');
const player={maxSpeed:25,v:20},cop={x:0,z:0,yaw:0,index:0,route:{points:[{x:0,z:15},{x:0,z:40}]}};
assert.equal(policeTargetSpeed(cop,player),23.5);
updatePoliceBoost(cop,{...player,v:0},185,1/60);assert.equal(policeTargetSpeed(cop,{...player,v:0}),26.75);
for(let i=0;i<241;i++)updatePoliceBoost(cop,{...player,v:0},185,1/60);assert.equal(cop.boostRemaining,0);assert(cop.boostCooldown>7);
assert.equal(policeTargetSpeed(cop,{...player,v:0}),23.5);
const distant={...cop,boostCooldown:0,boostRemaining:0};updatePoliceBoost(distant,player,300,1/60);assert(distant.boostRemaining>0);assert(policeTargetSpeed(distant,player)<=27.5);
updatePoliceBoost(distant,player,100,1/60);assert.equal(distant.boostRemaining,0,'close-range good driving cancels boost');
assert(policeTargetSpeed(cop,player)<player.maxSpeed,'good driving gains distance');
cop.route.points[1]={x:25,z:15};assert.equal(policeTargetSpeed(cop,player),23.5*C.sharpTurnRatio);
cop.route.points[1]={x:20,z:35};assert(Math.abs(policeTargetSpeed(cop,player)-23.5*C.moderateTurnRatio)<1e-6);
assert(Math.abs(angleDelta(-Math.PI+.1,Math.PI-.1)-.2)<1e-6);
assert(C.spawnDistance>=170&&C.spawnDistance<=220);assert(C.routeUpdateMin>=.4&&C.routeUpdateMax<=.8);
console.log('PASS: mirrored/scaled fist detection, open-hand rejection, rear-view enter/leave debounce, tracking loss, pursuit speed caps and corner braking');
