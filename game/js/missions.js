// missions.js — the three Harbor Wings sorties. Each mission owns its rings,
// beacon and scoring, and derives its checklist from plain counters so the
// staged screenshot scenes can set a believable mid-mission state.
//
//   MAIL RUN       — thread five rings over the coast, river and lighthouse,
//                    then land the mail on the Port Azure runway.
//   HARBOR RESCUE  — hoist three sailors off a sinking fishing boat: low,
//                    slow and steady over her deck, then bring them home.
//   VOLCANO SURVEY — photograph four vents on Mount Kora through the
//                    updrafts while the ash chews at the engine.

window.HW = window.HW || {};

const RING_Y = (x, z, agl) => Math.max(HW.heightAt(x, z) + agl, agl + 6);

HW.MISSION_DEFS = {
  mail: {
    title: 'MAIL RUN',
    objective: 'Thread all five rings, then land the mail at Port Azure.',
    color: 0xffb648,
    rings: [
      [620, 700], [390, 1405], [-150, 350], [-700, -150], [-60, 760],
    ],
  },
  rescue: {
    title: 'HARBOR RESCUE',
    objective: 'Hoist three sailors off the sinking boat, then land them safely.',
    color: 0xff5d47,
  },
  survey: {
    title: 'VOLCANO SURVEY',
    objective: 'Photograph four vents on Mount Kora, then land at Port Azure.',
    color: 0xb98cff,
  },
};

HW.startMission = function (id, scene) {
  const def = HW.MISSION_DEFS[id];
  const G = HW.GEO;
  const inst = {
    id, def, title: def.title, objective: def.objective,
    group: new THREE.Group(),
    score: 0, finished: false, failed: false, failReason: '',
    hoist: null, target: null, steps: [],
    counters: { rings: 0, sailors: 0, gates: 0, hoistProgress: 0 },
    bursts: [],
    lastTouchdownId: 0, landing: null, startedAt: null,
  };
  scene.add(inst.group);

  const beacon = HW.makeBeacon(def.color);
  inst.group.add(beacon);
  inst.beacon = beacon;

  // --- build the course ---
  inst.ringMeshes = [];
  inst.ringGlows = [];
  // A soft glow ellipse on the surface under each ring: it anchors
  // the hoop to the world, so at range the target reads as a place
  // in the landscape, not a shape pasted on the sky.
  const addGlow = (x, z) => {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ map: HW.ringGlowTexture(), color: def.color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, Math.max(HW.heightAt(x, z), 0) + 1.2, z);
    glow.renderOrder = 2;
    inst.group.add(glow);
    inst.ringGlows.push(glow);
  };
  if (id === 'mail') {
    def.rings.forEach(([x, z], i) => {
      const ring = HW.makeRing(i === 0 ? 0xffb648 : 0xffd98a);
      ring.position.set(x, RING_Y(x, z, 58), z);
      const next = def.rings[i + 1] || [G.runway.x, G.runway.z0];
      ring.lookAt(next[0], ring.position.y, next[1]);
      inst.group.add(ring);
      inst.ringMeshes.push(ring);
      addGlow(x, z);
    });
  }
  if (id === 'survey') {
    const gates = [];
    for (let i = 0; i < 4; i++) {
      const a = (20 + i * 90) * Math.PI / 180;
      const gx = G.volcano.x + Math.cos(a) * 335;
      const gz = G.volcano.z + Math.sin(a) * 335;
      gates.push([gx, gz]);
      const ring = HW.makeRing(0xb98cff);
      ring.position.set(gx, Math.max(HW.heightAt(gx, gz) + 74, 300), gz);
      ring.lookAt(G.volcano.x, ring.position.y, G.volcano.z);
      inst.group.add(ring);
      inst.ringMeshes.push(ring);
      addGlow(gx, gz);
    }
    inst.gates = gates;
  }

  const runwayTarget = new THREE.Vector3(G.runway.x, G.runway.alt + 26, G.runway.z0 + 60);
  const boatTarget = new THREE.Vector3(G.boat.x, 30, G.boat.z);

  inst.refresh = function () {
    const c = inst.counters;
    if (id === 'mail') {
      inst.steps = def.rings.map((_, i) => ({
        label: `Ring ${i + 1} of 5`,
        state: i < c.rings ? 'done' : i === c.rings ? 'active' : 'todo',
      }));
      inst.steps.push({ label: 'Land at Port Azure runway', state: c.rings >= 5 ? 'active' : 'todo' });
      const cur = def.rings[c.rings];
      inst.target = cur ? inst.ringMeshes[c.rings].position.clone() : runwayTarget.clone();
    } else if (id === 'rescue') {
      inst.steps = [
        { label: 'Reach the sinking boat', state: c.sailors > 0 || inst.hoistNear ? 'done' : 'active' },
        { label: `Hoist the crew — ${c.sailors} of 3 aboard`, state: c.sailors >= 3 ? 'done' : c.sailors > 0 || inst.hoistNear ? 'active' : 'todo' },
        { label: 'Land at Port Azure (strip or harbour)', state: c.sailors >= 3 ? 'active' : 'todo' },
      ];
      inst.target = c.sailors >= 3 ? runwayTarget.clone() : boatTarget.clone();
    } else {
      inst.steps = inst.gates.map((_, i) => ({
        label: `Photograph vent ${i + 1} of 4`,
        state: i < c.gates ? 'done' : i === c.gates ? 'active' : 'todo',
      }));
      inst.steps.push({ label: 'Land at Port Azure runway', state: c.gates >= 4 ? 'active' : 'todo' });
      const cur = inst.gates[c.gates];
      inst.target = cur ? inst.ringMeshes[c.gates].position.clone() : runwayTarget.clone();
    }
    if (inst.target) beacon.position.set(inst.target.x, 0, inst.target.z);
    beacon.visible = !inst.finished;
    // Ring colours: next ring burns bright; passed rings shrink and dim
    // so a threaded gate never hijacks a later frame. A ring that was
    // threaded live animates away (see update) instead of vanishing;
    // one that starts passed — the staged shots set counters by hand —
    // is simply hidden, so a frozen frame stays clean.
    inst.ringMeshes.forEach((ring, i) => {
      const doneCount = id === 'mail' ? c.rings : c.gates;
      const mat = ring.userData.torus.material;
      const dmat = ring.userData.disc.material;
      const glow = inst.ringGlows[i];
      if (i < doneCount) {
        if (ring.userData.dying === null && !ring.userData.passed) {
          ring.userData.passed = true;
          ring.visible = false;
        }
        if (glow) glow.visible = false;
      }
      else if (i === doneCount) {
        mat.color.setHex(def.color);
        dmat.color.setHex(def.color); dmat.opacity = 0.32;
        if (glow) { glow.visible = true; glow.material.color.setHex(def.color); glow.material.opacity = 0.30; }
      }
      else {
        mat.color.setHex(0xcfd8dc);
        dmat.color.setHex(0xcfd8dc); dmat.opacity = 0.10;
        if (glow) { glow.visible = true; glow.material.color.setHex(0xcfd8dc); glow.material.opacity = 0.10; }
      }
    });
  };

  inst.spawnBurst = function (origin, color) {
    const count = 26;
    const rng = HW.makeRng(9000 + inst.bursts.length * 131 + (inst.counters.rings + inst.counters.gates) * 17);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: 5, map: HW.dotTexture(), transparent: true, opacity: 1,
      sizeAttenuation: true, depthWrite: false, alphaTest: 0.02,
    }));
    const vel = [];
    for (let j = 0; j < count; j++) {
      const a = rng() * Math.PI * 2, e = (rng() - 0.35) * Math.PI;
      const sp = 14 + rng() * 26;
      vel.push([Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 8, Math.sin(a) * Math.cos(e) * sp]);
    }
    points.position.copy(origin);
    inst.group.add(points);
    inst.bursts.push({ points, vel, count, origin: origin.clone(), age: 0 });
  };

  inst.finishCheck = function (state) {
    if (state.touchdownId === inst.lastTouchdownId) return;
    inst.lastTouchdownId = state.touchdownId;
    const td = state.lastTouchdown;
    if (!td) return;
    if (td.grade === 'CRASH') { inst.failed = true; inst.failReason = 'She went in hard. The harbour master sends his regards.'; return; }
    const c = inst.counters;
    const home = td.onRunway || (id === 'rescue' && td.onWater && Math.hypot(td.x - 590, td.z - 1080) < 620);
    const ready = id === 'mail' ? c.rings >= 5 : id === 'survey' ? c.gates >= 4 : c.sailors >= 3;
    if (home && ready) {
      inst.landing = td;
      inst.score += td.score;
      inst.finished = true;
    }
  };

  inst.update = function (dt, state, t) {
    if (inst.startedAt === null) inst.startedAt = state.time;
    const c = inst.counters;
    const pos = state.pos;

    // Ring / gate threading. A threaded ring does not pop out of
    // existence: it spins, shrinks and fades over ~0.6 s while a burst
    // of sparks flies, so the pass reads as an event.
    const total = id === 'mail' ? 5 : id === 'survey' ? 4 : 0;
    const doneCount = id === 'mail' ? c.rings : c.gates;
    if (total && doneCount < total) {
      const ringPos = inst.ringMeshes[doneCount].position;
      if (pos.distanceTo(ringPos) < 31) {
        const ring = inst.ringMeshes[doneCount];
        ring.userData.dying = 0;
        inst.spawnBurst(ringPos, def.color);
        if (id === 'mail') { c.rings += 1; inst.score += 150; }
        else { c.gates += 1; inst.score += 200; }
        inst.event = id === 'mail' ? `Ring ${c.rings} of 5 — clean!` : `Vent ${c.gates} photographed!`;
      }
    }
    // Dying rings: spin, shrink and fade, then hide for good.
    inst.ringMeshes.forEach((ring) => {
      if (ring.userData.dying === null) return;
      ring.userData.dying += dt;
      const d = ring.userData.dying;
      if (d >= 0.6) {
        ring.userData.dying = null;
        ring.userData.passed = true;
        ring.visible = false;
        ring.scale.setScalar(1);
        ring.userData.torus.material.opacity = 1;
        return;
      }
      ring.scale.setScalar(Math.max(0.05, 1 - d * 1.4));
      ring.userData.torus.material.opacity = Math.max(0, 1 - d / 0.6);
      ring.userData.disc.material.opacity = 0.32 * Math.max(0, 1 - d / 0.6);
      ring.rotation.z += dt * 7;
    });
    // Particle bursts: sparks fly out and fall, then the points leave.
    for (let i = inst.bursts.length - 1; i >= 0; i--) {
      const b = inst.bursts[i];
      b.age += dt;
      if (b.age >= 0.7) {
        inst.group.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        inst.bursts.splice(i, 1);
        continue;
      }
      const p = b.points.geometry.attributes.position;
      for (let j = 0; j < b.count; j++) {
        const v = b.vel[j];
        p.array[j * 3] = v[0] * b.age;
        p.array[j * 3 + 1] = v[1] * b.age - 14 * b.age * b.age;
        p.array[j * 3 + 2] = v[2] * b.age;
      }
      p.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - b.age / 0.7);
    }
    // Pulse the active ring; passed rings stay shrunk.
    inst.ringMeshes.forEach((ring, i) => {
      if (ring.userData.dying !== null) return;
      if (i === (id === 'mail' ? c.rings : c.gates)) {
        const s = 1 + Math.sin(t * 3.4) * 0.05;
        ring.scale.setScalar(s);
      } else if (ring.userData.passed) ring.scale.setScalar(1);
      else ring.scale.setScalar(1);
    });

    if (id === 'rescue') {
      const dBoat = Math.hypot(pos.x - G.boat.x, pos.z - G.boat.z);
      inst.hoistNear = dBoat < 130 && pos.y < 90;
      const hoisting = !state.onGround && dBoat < 95 && pos.y < 52 && state.speed < 23 && c.sailors < 3;
      if (hoisting) {
        c.hoistProgress += dt / 2.8;
        inst.hoist = c.hoistProgress % 1;
        if (c.hoistProgress >= 1) {
          c.hoistProgress = 0;
          c.sailors += 1;
          inst.score += 200;
          inst.event = c.sailors >= 3 ? 'All three aboard — take them home!' : `Sailor ${c.sailors} aboard!`;
        }
      } else inst.hoist = c.sailors >= 3 ? null : (inst.hoistNear ? 0 : null);
    }

    if (id === 'survey') {
      // Ash near the crater eats the engine and shakes the airframe.
      const dv = Math.hypot(pos.x - G.volcano.x, pos.z - G.volcano.z);
      const craterY = HW.heightAt(G.volcano.x, G.volcano.z);
      if (dv < 300 && pos.y < craterY + 130 && !state.onGround) {
        state.hull = Math.max(1, state.hull - dt * 2.1);
        state.shake = Math.max(state.shake, 0.3);
        inst.ashWarn = true;
      } else inst.ashWarn = false;
    }

    inst.finishCheck(state);
    if (state.crashed && !inst.finished) { inst.failed = true; inst.failReason = 'She went in hard. The harbour master sends his regards.'; }
    inst.refresh();
  };

  inst.elapsed = function (state) {
    return inst.startedAt === null ? 0 : state.time - inst.startedAt;
  };

  inst.debrief = function (state) {
    const c = inst.counters;
    const elapsed = Math.round(inst.elapsed(state));
    const timeBonus = Math.max(0, 600 - elapsed * 2);
    const fuelBonus = Math.round(state.fuel * 4);
    const hullBonus = Math.round(state.hull * 2);
    const total = inst.score + timeBonus + fuelBonus + hullBonus;
    const rows = [];
    if (id === 'mail') rows.push(['Rings threaded', `${c.rings} of 5 · ${c.rings * 150} pts`]);
    if (id === 'rescue') rows.push(['Sailors hoisted', `${c.sailors} of 3 · ${c.sailors * 200} pts`]);
    if (id === 'survey') rows.push(['Vents photographed', `${c.gates} of 4 · ${c.gates * 200} pts`]);
    if (inst.landing) rows.push(['Landing', `${inst.landing.grade} · ${inst.landing.score} pts`]);
    rows.push(['Time', `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · bonus ${timeBonus}`]);
    rows.push(['Fuel remaining', `${Math.round(state.fuel)}% · bonus ${fuelBonus}`]);
    rows.push(['Hull integrity', `${Math.round(state.hull)}% · bonus ${hullBonus}`]);
    return {
      title: id === 'mail' ? 'MAIL DELIVERED' : id === 'rescue' ? 'CREW SAFE ASHORE' : 'SURVEY COMPLETE',
      rows, total,
    };
  };

  inst.refresh();
  return inst;
};
