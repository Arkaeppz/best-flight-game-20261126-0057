// main.js — Harbor Wings boot and game loop: renderer, lights, input, the
// menu / flying / debrief state machine, and the staged-scene hook the
// screenshot pipeline drives through ?shot=<name>.

window.HW = window.HW || {};

(function () {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd7e6ec, 1000, 5600);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 16000);
  camera.position.set(300, 90, 1500);

  const hemi = new THREE.HemisphereLight(0xcfe5f2, 0x51683f, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -240; sun.shadow.camera.right = 240;
  sun.shadow.camera.top = 240; sun.shadow.camera.bottom = -240;
  sun.shadow.camera.near = 100; sun.shadow.camera.far = 3400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 3.0;
  scene.add(sun);
  scene.add(sun.target);

  const world = HW.buildWorld(scene);
  const plane = HW.buildAircraft();
  scene.add(plane);

  HW.HUD.init();

  let state = HW.FLIGHT.newState();
  let mission = null;
  let mode = 'menu';
  let endTimer = 0;
  let prevTouchdownId = 0;
  let prevCounters = { rings: 0, gates: 0, sailors: 0 };
  let beepTimer = 0;

  // Park the aircraft on the strip for the menu backdrop.
  state.pos.set(HW.GEO.runway.x, HW.GEO.runway.alt + HW.FLIGHT.FLOAT_CLEARANCE, 1010);
  state.onGround = true;

  /* ------------------------------ input ------------------------------ */
  const keys = {};
  window.addEventListener('keydown', (ev) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
    keys[ev.code] = true;
    if (ev.code === 'KeyC' && mode === 'flying') {
      const next = HW.CameraRig.mode === 'chase' ? 'cockpit' : 'chase';
      HW.CameraRig.setMode(next, plane);
      if (next === 'chase') HW.CameraRig.reset(state);
    }
    if (ev.code === 'KeyR' && mode === 'flying' && mission) startMission(mission.id);
  });
  window.addEventListener('keyup', (ev) => { keys[ev.code] = false; });

  function readInput() {
    return {
      pitch: (keys.ArrowUp ? 1 : 0) + (keys.ArrowDown ? -1 : 0),
      bank: (keys.ArrowRight ? 1 : 0) + (keys.ArrowLeft ? -1 : 0),
      rudder: (keys.KeyD ? 1 : 0) + (keys.KeyA ? -1 : 0),
      throttle: (keys.KeyW ? 1 : 0) + (keys.KeyS ? -1 : 0),
    };
  }

  /* --------------------------- mission flow --------------------------- */
  const menuEl = document.getElementById('menu');
  const debriefEl = document.getElementById('debrief');

  function startMission(id) {
    if (mission) scene.remove(mission.group);
    state = HW.FLIGHT.newState();
    mission = HW.startMission(id, scene);
    prevTouchdownId = 0;
    prevCounters = { rings: 0, gates: 0, sailors: 0 };
    endTimer = 0;
    HW.CameraRig.setMode('chase', plane);
    HW.CameraRig.reset(state);
    HW.HUD.stepsSig = '';
    menuEl.classList.add('hidden');
    debriefEl.classList.add('hidden');
    HW.HUD.show();
    if (!shotName) HW.Sound.init();
    mode = 'flying';
  }

  function showDebrief() {
    mode = 'debrief';
    const d = mission.debrief(state);
    document.getElementById('debrief-kicker').textContent =
      mission.failed ? 'MISSION FAILED' : 'SORTIE COMPLETE';
    document.getElementById('debrief-title').textContent =
      mission.failed ? 'SORTIE LOST' : d.title;
    const rows = mission.failed
      ? [['Outcome', mission.failReason], ['Score banked', String(mission.score)],
         ['Fuel remaining', `${Math.round(state.fuel)}%`], ['Hull integrity', `${Math.round(state.hull)}%`]]
      : d.rows;
    document.getElementById('debrief-table').innerHTML =
      rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    document.getElementById('debrief-score').textContent = mission.failed ? mission.score : d.total;
    debriefEl.classList.remove('hidden');
    HW.Sound.setEngine(0, 0, false);
  }

  document.querySelectorAll('.mission-card').forEach((card) => {
    card.addEventListener('click', () => startMission(card.dataset.mission));
  });
  document.getElementById('btn-again').addEventListener('click', () => { if (mission) startMission(mission.id); });
  document.getElementById('btn-menu').addEventListener('click', () => {
    if (mission) { scene.remove(mission.group); mission = null; }
    state = HW.FLIGHT.newState();
    state.pos.set(HW.GEO.runway.x, HW.GEO.runway.alt + HW.FLIGHT.FLOAT_CLEARANCE, 1010);
    state.onGround = true;
    debriefEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
    HW.HUD.hide();
    mode = 'menu';
  });

  /* ------------------------------ shots ------------------------------ */
  const shotName = new URLSearchParams(window.location.search).get('shot');
  let shotFrozenT = 26;
  if (shotName && HW.Shots) {
    mode = 'shot';
    menuEl.classList.add('hidden');
    const api = {
      scene, plane, camera,
      get state() { return state; },
      set state(s) { state = s; },
      get mission() { return mission; },
      set mission(m) { mission = m; },
      startMission: (id) => { startMission(id); mode = 'shot'; },
      setView: (m) => HW.CameraRig.setMode(m, plane),
      showDebrief: () => { showDebrief(); mode = 'shot'; },
      setFrozenT: (t) => { shotFrozenT = t; },
      parkCamera: (pos, look) => {
        HW.CameraRig.pos.copy(pos);
        HW.CameraRig.look.copy(look);
      },
    };
    HW.Shots.setup(shotName, api);
  }

  /* ------------------------------- loop ------------------------------- */
  const clock = new THREE.Clock();
  let frames = 0;
  let simTime = 0;

  // One fixed simulation step of a live sortie. The render loop calls this
  // with the frame dt; the playtest drives it directly with fixed steps so
  // results do not depend on the host's frame rate.
  function tick(dt) {
    simTime += dt;
    HW.FLIGHT.step(state, readInput(), dt);
    mission.update(dt, state, simTime);

    if (state.touchdownId !== prevTouchdownId) {
      prevTouchdownId = state.touchdownId;
      const td = state.lastTouchdown;
      if (td.grade === 'CRASH' || !td.onWater) HW.Sound.thud(); else HW.Sound.splash();
      if (!mission.finished && !mission.failed) {
        HW.HUD.toast(td.onRunway ? `Touchdown — ${td.grade}` : td.onWater ? `Water landing — ${td.grade}` : `Put down off-strip — ${td.grade}`);
      }
    }
    const c = mission.counters;
    if (c.rings !== prevCounters.rings || c.gates !== prevCounters.gates) HW.Sound.chime();
    if (c.sailors !== prevCounters.sailors) HW.Sound.hoistDing();
    prevCounters = { rings: c.rings, gates: c.gates, sailors: c.sailors };

    if (state.stalled) { beepTimer -= dt; if (beepTimer <= 0) { HW.Sound.warn(); beepTimer = 0.7; } }

    if (mission.finished || mission.failed) {
      endTimer += dt;
      if (endTimer > 1.5 || state.speed < 1.2) showDebrief();
    }
    HW.Sound.setEngine(state.throttle, state.speed, true);
  }

  function syncPlane(dt, t) {
    plane.position.copy(state.pos);
    plane.rotation.y = -state.heading * Math.PI / 180;
    plane.rotation.x = state.pitch * Math.PI / 180;
    plane.rotation.z = -state.bank * Math.PI / 180;
    if (mode !== 'shot') {
      plane.userData.prop.rotation.z -= dt * (3 + state.throttle * 46 + state.speed * 0.4);
    } else {
      plane.userData.prop.rotation.z = -2.2 - state.throttle * 3;
    }
    sun.position.set(state.pos.x + 900, 1500, state.pos.z - 650);
    sun.target.position.copy(state.pos);
  }

  function animate() {
    requestAnimationFrame(animate);
    const rawDt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (mode === 'menu') {
      const a = t * 0.045;
      camera.position.set(300 + Math.sin(a) * 460, 128, 1010 + Math.cos(a) * 460);
      camera.lookAt(300, 26, 1000);
      if (camera.fov !== 58) { camera.fov = 58; camera.updateProjectionMatrix(); }
      plane.userData.prop.rotation.z -= rawDt * 2.2;
      world.update(t);
      syncPlane(0, t);
    } else if (mode === 'shot') {
      world.update(shotFrozenT);
      syncPlane(0, shotFrozenT);
      if (HW.Shots.fixedCamera) HW.Shots.fixedCamera(camera);
      else HW.CameraRig.update(0.016, state, plane, camera, shotFrozenT);
      if (mission) HW.HUD.update(state, mission);
      frames += 1;
      if (frames > 6) window.__shotReady = true;
    } else if (mode === 'flying' || mode === 'debrief') {
      if (mode === 'flying') tick(rawDt);
      world.update(t);
      syncPlane(rawDt, t);
      HW.CameraRig.update(rawDt, state, plane, camera, t);
      if (mission) HW.HUD.update(state, mission);
    }

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // A small handle for the automated playtest (and curious pilots in the
  // console): start a sortie, read the live state, place the aircraft.
  window.HarborWings = {
    start: startMission,
    state: () => state,
    mission: () => mission,
    mode: () => mode,
    place: (x, y, z, heading, speed, throttle) => HW.FLIGHT.place(state, x, y, z, heading, speed, throttle),
    stepSim: (seconds) => {
      const n = Math.max(1, Math.round(seconds / (1 / 30)));
      for (let i = 0; i < n && mode === 'flying'; i++) tick(1 / 30);
    },
  };
})();
