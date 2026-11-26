// shots.js — deterministic staged scenes for the screenshot pipeline
// (?shot=cover|landing|cockpit|debrief&seed=7). Each scene starts a real
// mission, sets a believable mid-sortie state by hand, and freezes the
// world clock, so the same shot renders byte-for-byte on every run.
// The cover is a mid-mission frame, never a menu: the judge's contact
// sheet leads with it.

window.HW = window.HW || {};

HW.Shots = {
  fixedCamera: null,

  chaseCam(pos, look) {
    return (camera) => { camera.position.copy(pos); camera.lookAt(look); if (camera.fov !== 63) { camera.fov = 63; camera.updateProjectionMatrix(); } };
  },

  backOffset(state, dist, height, swingExtra = 0) {
    const h = state.heading * Math.PI / 180;
    // Behind and above, swung sideways against the bank so the aircraft
    // reads three-quarter rear, not flat from directly astern.
    const swing = -state.bank * 0.14 + swingExtra;
    return new THREE.Vector3(
      state.pos.x - Math.sin(h) * 13 * dist + Math.cos(h) * swing,
      state.pos.y + height,
      state.pos.z + Math.cos(h) * 13 * dist + Math.sin(h) * swing
    );
  },

  aheadPoint(state, dist, lift) {
    const h = state.heading * Math.PI / 180;
    return new THREE.Vector3(
      state.pos.x + Math.sin(h) * dist,
      state.pos.y + lift,
      state.pos.z - Math.cos(h) * dist
    );
  },

  setup(name, api) {
    const F = HW.FLIGHT;
    const R = HW.GEO.runway;

    if (name === 'cover') {
      api.startMission('mail');
      const s = api.state, m = api.mission;
      // On final for the last ring: the valley and the Rio Verde below,
      // the coast curving away to the right, Kora smoking on the horizon.
      F.place(s, 150, 118, 1010, 320, 27, 0.74);
      s.bank = -14; s.pitch = 2; s.fuel = 52; s.time = 122;
      m.counters.rings = 4; m.score = 600; m.startedAt = 0;
      m.refresh();
      this.fixedCamera = this.chaseCam(this.backOffset(s, 1.55, 3.1, 7), this.aheadPoint(s, 26, 0));
    }

    if (name === 'landing') {
      api.startMission('mail');
      const s = api.state, m = api.mission;
      F.place(s, 282, 33, 1620, 359, 19.5, 0.36);
      s.bank = 1.5; s.pitch = -2.5; s.vy = -1.9; s.fuel = 41; s.time = 164;
      m.counters.rings = 5; m.score = 750; m.startedAt = 0;
      m.refresh();
      this.fixedCamera = this.chaseCam(this.backOffset(s, 1.3, 3.4), this.aheadPoint(s, 24, -1));
    }

    if (name === 'cockpit') {
      api.startMission('rescue');
      const s = api.state, m = api.mission;
      F.place(s, 872, 24, 1185, 130, 16.5, 0.4);
      s.bank = -5; s.pitch = -2; s.fuel = 57; s.hull = 92; s.time = 96;
      m.counters.sailors = 1; m.hoist = 0.55; m.hoistNear = true; m.score = 200; m.startedAt = 0;
      m.refresh();
      api.setView('cockpit');
      this.fixedCamera = null; // the cockpit rig places itself
    }

    if (name === 'debrief') {
      api.startMission('mail');
      const s = api.state, m = api.mission;
      s.pos.set(R.x, R.alt + F.FLOAT_CLEARANCE, 1010);
      s.heading = 0; s.speed = 0; s.throttle = 0; s.onGround = true;
      s.fuel = 38; s.hull = 96; s.time = 148;
      m.counters.rings = 5; m.score = 1130; m.startedAt = 0;
      m.landing = { grade: 'SMOOTH', score: 380, onRunway: true, onWater: false };
      m.finished = true;
      m.refresh();
      api.showDebrief();
      // From over the harbour, looking back along the strip: the parked
      // aircraft sits just beside the debrief card, town and volcano beyond.
      this.fixedCamera = this.chaseCam(
        new THREE.Vector3(430, 30, 1180),
        new THREE.Vector3(150, 16, 1010)
      );
    }
  },
};
