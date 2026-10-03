import { POLICE_CONFIG as C } from '../config/policeConfig.js';
export const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
export function policeTargetSpeed(cop,player){
  let ratio=cop.boostRemaining>0?(Math.abs(player.v)<C.slowPlayerThreshold?C.slowPlayerSpeedRatio:C.maxCatchupRatio):C.normalSpeedRatio;
  const points=cop.route?.points||[];
  let previous=cop,heading=cop.yaw,distance=0,severity=0;
  for(let i=cop.index;i<points.length&&distance<C.cornerLookahead;i++){
    const next=points[i],dx=next.x-previous.x,dz=next.z-previous.z,len=Math.hypot(dx,dz);
    if(len>.05){const angle=Math.atan2(dx,dz);severity=Math.max(severity,Math.abs(angleDelta(angle,heading)));heading=angle;distance+=len;}
    previous=next;
  }
  if(severity>Math.PI/3)ratio*=C.sharpTurnRatio;
  else if(severity>Math.PI/6)ratio*=C.moderateTurnRatio;
  return player.maxSpeed*ratio;
}
export function updatePoliceBoost(cop,player,gap,dt){
  cop.boostCooldown=Math.max(0,(cop.boostCooldown||0)-dt);
  cop.boostRemaining=Math.max(0,(cop.boostRemaining||0)-dt);
  const slow=Math.abs(player.v)<C.slowPlayerThreshold;
  if(!slow&&gap<C.catchupReleaseDistance)cop.boostRemaining=0;
  if(!cop.boostRemaining&&!cop.boostCooldown&&(slow||gap>C.catchupDistance)){
    cop.boostRemaining=C.boostDuration;cop.boostCooldown=C.boostDuration+C.boostCooldown;
  }
}
