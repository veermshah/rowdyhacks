/**
 * Arcade bicycle-model car physics.
 * Reads from the shared input state, mutates car state.
 */
export function createCar() {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    v: 0,
    maxSpeed: 25, // m/s ≈ 56 mph
    offroad: false,
    nearestRoadDist: 0,
  };
}

export function stepCar(car, input, dt) {
  // Clamp dt to avoid physics explosions on tab-switch
  dt = Math.min(dt, 0.05);

  const normalized = input.steer;

  // Non-linear steering response: small inputs = small corrections
  let steering = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1.5);

  // Speed-sensitive steering reduction
  steering /= 1 + Math.abs(car.v) * 0.05;

  const wheelAngle = steering * 0.6;

  // Signed speed gives reversed bicycle steering naturally. Gear changes brake
  // to zero first; service braking never accelerates a stationary vehicle.
  const direction=input.reverse?-1:1;
  const opposite=car.v*direction < 0;
  const braking=input.brake*12+(opposite?9:0);
  const old=car.v;
  if(braking>0)car.v=Math.sign(car.v)*Math.max(0,Math.abs(car.v)-braking*dt);
  if(!opposite && !input.brake)car.v+=direction*input.gas*6*dt;
  car.v*=Math.max(0,1-.15*dt);
  if(opposite && old*car.v<0)car.v=0;
  car.v=Math.max(-car.maxSpeed*.3,Math.min(car.v,car.maxSpeed));

  // Bicycle model yaw update (wheelbase ≈ 2.7m)
  car.yaw -= (car.v / 2.7) * Math.tan(wheelAngle) * dt;

  // Position update
  car.x += Math.sin(car.yaw) * car.v * dt;
  car.z += Math.cos(car.yaw) * car.v * dt;
}
