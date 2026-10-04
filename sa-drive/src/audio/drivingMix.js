const clamp = (n, lo=0, hi=1) => Math.max(lo, Math.min(hi, n));

// Pure control-rate mix; no sound nodes, physics changes or React updates.
export function drivingMix(car, input, game) {
  const speed = Math.abs(car.v), motion = clamp(speed / car.maxSpeed);
  const throttle = clamp(input.gas), braking = clamp(input.brake + (car.v * (input.reverse ? -1 : 1) < -0.5 ? 1 : 0));
  // Virtual gears are audio-only: revs climb then drop at each upshift.
  const gear = car.v < 0 ? 0 : Math.min(4,Math.floor(speed/8));
  const rev = clamp((speed-gear*8)/10);
  const distance = game.police ? Math.hypot(game.police.x-car.x, game.police.z-car.z) : Infinity;
  const pan = game.police ? clamp(((game.police.x-car.x)*Math.cos(car.yaw)-(game.police.z-car.z)*Math.sin(car.yaw))/Math.max(distance,1),-1,1) : 0;
  return {
    active: game.ready && game.started && !game.caught && !game.paused,
    engineHz: 32 + rev*100 + throttle*32,
    throttle,
    engine: .055 + throttle*.045 + motion*.025,
    road: car.offroad ? 0 : motion*.075,
    grass: car.offroad ? clamp(speed/15)*.17 : 0,
    wind: motion*motion*.045,
    skid: speed>4 ? clamp(braking*.8 + Math.abs(input.steer)*motion-.45)*.09 : 0,
    brake: braking*clamp(speed/10)*.035,
    reverse: input.reverse && car.v<-.3,
    siren: game.police?.active ? .022/(1+(distance/65)**1.5) : 0,
    pan,
  };
}
