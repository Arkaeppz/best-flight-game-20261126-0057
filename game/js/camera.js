// camera.js — two cameras that never fight the pilot: a damped chase view
// that leans into banks and stretches with speed, and a cockpit view over
// the nose with the dash in frame. Both take the flight model's shake
// (stall buffet, ash turbulence, touchdown thump) as small offsets.

window.HW = window.HW || {};

HW.CameraRig = {
  mode: 'chase',
  pos: new THREE.Vector3(300, 60, 1450),
  look: new THREE.Vector3(300, 20, 1000),
  fov: 62,

  reset(state) {
    const back = this.backVector(state, 1);
    this.pos.copy(state.pos).add(back);
    this.look.copy(state.pos);
  },

  backVector(state, dist) {
    const h = state.heading * Math.PI / 180;
    // Behind and above, swung slightly by bank so turns feel carved.
    const swing = -state.bank * 0.05;
    return new THREE.Vector3(
      -Math.sin(h) * 12.5 * dist + Math.cos(h) * swing,
      4.6 * dist,
      Math.cos(h) * 12.5 * dist + Math.sin(h) * swing
    );
  },

  setMode(mode, plane) {
    this.mode = mode;
    plane.userData.cockpit.visible = mode === 'cockpit';
    for (const part of plane.userData.hideInCockpit || []) {
      part.visible = mode !== 'cockpit';
    }
    for (const blade of plane.userData.propBlades || []) {
      blade.visible = mode !== 'cockpit';
    }
  },

  update(dt, state, plane, camera, t) {
    const shakeAmp = state.shake * 0.5;
    const shX = Math.sin(t * 39.7) * shakeAmp, shY = Math.cos(t * 47.3) * shakeAmp * 0.7;

    if (this.mode === 'cockpit') {
      // Seated high over the nose, ahead of the wing's leading edge, with
      // the dash low in frame and the cowl below — an open seaplane cockpit.
      const local = new THREE.Vector3(shX * 0.2, 1.78 + shY * 0.2, -2.25);
      const world = local.clone();
      plane.localToWorld(world);
      camera.position.copy(world);
      const ahead = new THREE.Vector3(0, 0.7, -30);
      plane.localToWorld(ahead);
      camera.lookAt(ahead.x, ahead.y + shY, ahead.z);
      this.setFov(camera, 66);
      return;
    }

    const stretch = 1 + HW.clamp(state.speed / HW.FLIGHT.MAX_SPEED, 0, 1) * 0.22;
    const desired = state.pos.clone().add(this.backVector(state, stretch));
    // Never let the chase camera sink into a hillside.
    const minY = HW.heightAt(desired.x, desired.z) + 3.2;
    if (desired.y < minY) desired.y = minY;
    const k = 1 - Math.exp(-dt * 5.2);
    this.pos.lerp(desired, k);
    camera.position.set(this.pos.x + shX, this.pos.y + shY, this.pos.z);

    const h = state.heading * Math.PI / 180;
    const ahead = new THREE.Vector3(
      state.pos.x + Math.sin(h) * 16,
      state.pos.y + 1.2 + Math.sin(state.pitch * Math.PI / 180) * 8,
      state.pos.z - Math.cos(h) * 16
    );
    this.look.lerp(ahead, 1 - Math.exp(-dt * 7));
    camera.lookAt(this.look);
    this.setFov(camera, 62 + HW.clamp(state.speed / HW.FLIGHT.MAX_SPEED, 0, 1) * 7);
  },

  setFov(camera, fov) {
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  },
};
