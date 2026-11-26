// flight.js — the flight model: an arcade-honest floatplane. Throttle and
// bank discipline matter (turns bleed speed, climbs cost speed, slow flight
// stalls), fuel burns faster at full throttle, and every touchdown is judged
// on sink rate, speed, surface and alignment — the landing is a grade, not
// a formality.

window.HW = window.HW || {};

HW.FLIGHT = {
  FLOAT_CLEARANCE: 2.9,   // origin height above the surface when resting
  STALL_SPEED: 13.5,      // m/s
  MAX_SPEED: 44,

  newState() {
    return {
      pos: new THREE.Vector3(300, HW.GEO.runway.alt + this.FLOAT_CLEARANCE, 1300),
      heading: 0, pitch: 0, bank: 0,
      speed: 0, vy: 0, throttle: 0,
      fuel: 100, hull: 100,
      stalled: false, engineOut: false,
      onGround: true, crashed: false, splashed: false,
      shake: 0, time: 0,
      touchdownId: 0, lastTouchdown: null,
    };
  },

  place(state, x, y, z, heading, speed, throttle) {
    state.pos.set(x, y, z);
    state.heading = heading; state.pitch = 0; state.bank = 0;
    state.speed = speed; state.vy = 0; state.throttle = throttle;
    state.onGround = false; state.crashed = false;
  },

  step(state, input, dt) {
    if (state.crashed) { state.speed = Math.max(0, state.speed - dt * 8); return; }
    state.time += dt;
    const G = HW.GEO;

    // --- throttle & fuel ---
    state.throttle = HW.clamp(state.throttle + (input.throttle || 0) * dt * 0.55, 0, 1);
    if (state.fuel > 0) {
      state.fuel = Math.max(0, state.fuel - dt * (0.1 + state.throttle * 0.42));
      if (state.fuel === 0) state.engineOut = true;
    }
    const power = state.engineOut ? 0 : state.throttle;

    // --- attitude: bank and pitch chase the pilot's targets ---
    const targetBank = (input.bank || 0) * 55;
    const targetPitch = (input.pitch || 0) * 23;
    state.bank += (targetBank - state.bank) * Math.min(1, dt * 3.2);
    state.pitch += (targetPitch - state.pitch) * Math.min(1, dt * 2.6);

    // --- stall: slow flight drops the nose and the wing ---
    state.stalled = !state.onGround && state.speed < this.STALL_SPEED;
    if (state.stalled) {
      state.pitch += (-16 - state.pitch) * Math.min(1, dt * 1.8);
      state.shake = Math.max(state.shake, 0.35);
    }

    // --- heading: banked turns, rudder for the ground and fine aim ---
    const turnRate = state.bank * 0.55 * (22 / Math.max(state.speed, 10));
    if (!state.onGround) state.heading += turnRate * dt;
    state.heading += (input.rudder || 0) * (state.onGround ? 26 : 9) * dt;
    state.heading = ((state.heading % 360) + 360) % 360;

    // --- speed: thrust against drag, gravity along the flight path ---
    const pitchRad = state.pitch * Math.PI / 180;
    let accel = power * 7.6 - 0.026 * state.speed - Math.sin(pitchRad) * 5.6;
    accel -= Math.abs(state.bank) * 0.011; // turning costs energy
    if (state.onGround) accel -= state.speed * 0.012 + (state.throttle < 0.05 ? 1.4 : 0);
    state.speed = HW.clamp(state.speed + accel * dt, 0, this.MAX_SPEED);

    // --- vertical: lift from pitch and speed, sink when stalled ---
    let vy = Math.sin(pitchRad) * state.speed * 0.94;
    if (state.stalled) vy -= (this.STALL_SPEED - state.speed) * 0.62;
    if (state.onGround) vy = 0;

    // Mount Kora's updraft: free lift over the cone, with turbulence.
    const dv = Math.hypot(state.pos.x - G.volcano.x, state.pos.z - G.volcano.z);
    if (!state.onGround && dv < 430 && state.pos.y < 640) {
      const lift = 8.5 * (1 - dv / 430);
      vy += lift;
      state.shake = Math.max(state.shake, 0.22 * (1 - dv / 430));
    }
    state.vy = vy;

    // --- integrate along the flight path, plus a light westerly drift ---
    const hRad = state.heading * Math.PI / 180;
    const fwdX = Math.sin(hRad) * Math.cos(pitchRad);
    const fwdZ = -Math.cos(hRad) * Math.cos(pitchRad);
    state.pos.x += (fwdX * state.speed - 1.4) * dt;
    state.pos.z += fwdZ * state.speed * dt;
    if (!state.onGround) state.pos.y += vy * dt;

    // --- ground contact ---
    const groundY = HW.groundAt(state.pos.x, state.pos.z) + this.FLOAT_CLEARANCE;
    if (state.pos.y <= groundY) {
      if (!state.onGround) this.touchdown(state);
      state.pos.y = groundY;
      if (state.onGround && state.speed >= 17 && state.pitch > 3 && !state.crashed) {
        state.onGround = false; // rotate: she lifts off
        state.pos.y += 0.4;
      }
    } else if (state.pos.y > groundY + 0.6) {
      state.onGround = false;
    }

    state.shake = Math.max(0, state.shake - dt * 1.4);
  },

  touchdown(state) {
    const G = HW.GEO;
    const onRwy = HW.onRunway(state.pos.x, state.pos.z);
    const terrainH = HW.heightAt(state.pos.x, state.pos.z);
    const onWater = !onRwy && terrainH < 0.4;
    // Rough ground? Sample the slope under the floats.
    const rough = Math.max(
      Math.abs(HW.heightAt(state.pos.x + 7, state.pos.z) - terrainH),
      Math.abs(HW.heightAt(state.pos.x, state.pos.z + 7) - terrainH)
    ) > 4;
    const sink = state.vy;
    let grade, score, crash = false;

    if (sink < -10.5 || Math.abs(state.bank) > 38 || state.pitch < -26) {
      grade = 'CRASH'; score = 0; crash = true;
    } else if (rough && !onWater && sink < -3.5) {
      grade = 'CRASH'; score = 0; crash = true;
    } else if (onRwy) {
      const align = Math.min(Math.abs(((state.heading + 180) % 360) - 180), Math.abs(state.heading));
      const offCentre = Math.abs(state.pos.x - G.runway.x);
      if (sink > -1.9 && state.speed < 24 && align < 14 && offCentre < 9) { grade = 'PERFECT'; score = 500; }
      else if (sink > -3.2 && state.speed < 28 && align < 24) { grade = 'SMOOTH'; score = 380; }
      else if (sink > -5.2) { grade = 'FIRM'; score = 240; }
      else { grade = 'ROUGH'; score = 110; }
    } else if (onWater) {
      if (sink > -2.4 && state.speed < 26) { grade = 'SMOOTH'; score = 300; }
      else if (sink > -4.4 && state.speed < 32) { grade = 'FIRM'; score = 180; }
      else if (sink > -6.5) { grade = 'ROUGH'; score = 90; }
      else { grade = 'CRASH'; score = 0; crash = true; }
    } else {
      grade = sink > -3.4 ? 'FIRM' : 'ROUGH';
      score = sink > -3.4 ? 120 : 50;
    }

    if (!crash && sink < -3.4) {
      state.hull = Math.max(5, state.hull - Math.round((-sink - 3.4) * 7));
      state.shake = Math.max(state.shake, 0.5);
    }
    if (crash) {
      state.hull = 0; state.crashed = true; state.shake = 1;
    }
    state.onGround = true;
    state.splash = onWater;
    state.touchdownId += 1;
    state.lastTouchdown = {
      grade, score, onRunway: onRwy, onWater, rough,
      sink, speed: state.speed, x: state.pos.x, z: state.pos.z,
    };
  },
};
