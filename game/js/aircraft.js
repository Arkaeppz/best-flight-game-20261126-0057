// aircraft.js — the Harbor Wings floatplane, built from primitives: a cream
// and teal high-wing seaplane on twin floats, with a spinning prop, nav
// lights and a cockpit frame that appears in cockpit view. Local axes:
// nose toward -Z, right wing toward +X, up +Y.

window.HW = window.HW || {};

// The instrument panel face, v2.2: drawn once on a 2048×672 canvas and
// stretched over the WHOLE dash face — the v2.1 panel was a small strip
// inside a giant black slab, the weakest frame in the set. Layout, top
// to bottom: an annunciator row (LOW FUEL and HOIST lit, the rest dim),
// a big moving-map MFD, a true six-pack in two rows of three, an engine
// MFD with bars and digital readouts, and a radio row in two tuning
// boxes either side of the maker's plate. Screws, bezels, section
// labels and a grain pass make it read as a built panel, not a texture
// pasted on a box. Static art — the live numbers live in the DOM HUD.
HW.panelTexture = function () {
  if (HW._panelTexture) return HW._panelTexture;
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 672;
  const ctx = c.getContext('2d');
  const rng = HW.makeRng(2711);

  // Panel stock: near-black blue-grey with grain and brushed streaks.
  ctx.fillStyle = '#181f24';
  ctx.fillRect(0, 0, 2048, 672);
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = `rgba(${200 + Math.floor(rng() * 55)},${210 + Math.floor(rng() * 45)},${220 + Math.floor(rng() * 35)},${0.016 + rng() * 0.03})`;
    ctx.fillRect(rng() * 2048, rng() * 672, 1.6, 1.6);
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + rng() * 0.035})`;
    ctx.fillRect(rng() * 2048, 0, 1, 672);
  }
  ctx.strokeStyle = 'rgba(243,234,210,0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 2036, 660);

  // Corner and edge screws: a slotted disc every ~340 px.
  const screw = (x, y) => {
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#3a444c'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0b0f12'; ctx.stroke();
    ctx.strokeStyle = '#141a1f'; ctx.lineWidth = 3.4;
    const a = rng() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * 7.5, y - Math.sin(a) * 7.5);
    ctx.lineTo(x + Math.cos(a) * 7.5, y + Math.sin(a) * 7.5);
    ctx.stroke();
  };
  for (const x of [30, 372, 714, 1056, 1398, 1740, 2018]) { screw(x, 30); screw(x, 642); }
  screw(30, 336); screw(2018, 336);

  const label = (x, y, text, size = 21, color = '#7d938a', align = 'left') => {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px Verdana, sans-serif`;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };

  /* ------------------------- annunciator row ------------------------- */
  // Lit lamps match the staged rescue state (fuel 24%, hoist running);
  // the DOM warning banner remains the live truth in flight.
  const lamps = [
    ['LOW FUEL', '#c22412', '#ffd9cd', true],
    ['HOIST', '#b97a10', '#ffe9bd', true],
    ['HULL', '#2b1a12', '#8a6a58', false],
    ['STALL', '#2b1a12', '#8a6a58', false],
    ['ENG', '#232d16', '#77875e', false],
    ['GEAR', '#232d16', '#77875e', false],
  ];
  lamps.forEach(([text, lit, litText, on], i) => {
    const x = 36 + i * 336, y = 52, w = 312, h = 62;
    ctx.fillStyle = '#0c0f11';
    ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (on) { g.addColorStop(0, lit); g.addColorStop(1, '#5f0f04'); if (text === 'HOIST') { g.addColorStop(0, '#d99a1e'); g.addColorStop(1, '#7a5205'); } }
    else { g.addColorStop(0, '#241d18'); g.addColorStop(1, '#17120e'); }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (on) { ctx.fillStyle = 'rgba(255,120,80,0.20)'; ctx.fillRect(x - 12, y - 12, w + 24, h + 24); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
    ctx.fillStyle = on ? litText : '#6e5a4c';
    ctx.font = '900 30px Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + 42);
  });

  /* ------------------------------ screens ------------------------------ */
  const screen = (x, y, w, h, title) => {
    ctx.fillStyle = '#05090b';
    ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
    ctx.fillStyle = '#0a1a20';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#3f7d8f';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, w, h);
    label(x + 14, y + 32, title, 22, '#8fd1e7');
  };

  // Left MFD: moving map of the Azure Archipelago.
  screen(36, 148, 520, 356, 'MAP · PORT AZURE');
  ctx.save();
  ctx.beginPath(); ctx.rect(36, 190, 520, 314); ctx.clip();
  ctx.fillStyle = '#14607e';
  ctx.fillRect(36, 190, 520, 314);
  for (const rr of [70, 130, 190]) { // range rings around own ship
    ctx.beginPath(); ctx.arc(300, 380, rr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(143,209,231,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.fillStyle = '#3a7d3a'; // the main island
  ctx.beginPath();
  ctx.moveTo(36, 504); ctx.lineTo(150, 350); ctx.lineTo(260, 300); ctx.lineTo(420, 330);
  ctx.lineTo(556, 420); ctx.lineTo(556, 504); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c6e35'; // Palma Isle
  ctx.beginPath(); ctx.ellipse(452, 262, 52, 27, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#35703a'; // Gull Rock
  ctx.beginPath(); ctx.ellipse(180, 452, 30, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7fd4f2'; ctx.lineWidth = 4; // Rio Verde
  ctx.beginPath(); ctx.moveTo(210, 504); ctx.quadraticCurveTo(250, 420, 205, 355); ctx.stroke();
  ctx.strokeStyle = '#f5f2e6'; ctx.lineWidth = 9; // runway
  ctx.beginPath(); ctx.moveTo(330, 400); ctx.lineTo(330, 478); ctx.stroke();
  ctx.fillStyle = '#ffb648'; // town dots
  for (const [tx, ty] of [[352, 420], [368, 438], [344, 452], [360, 402]]) { ctx.fillRect(tx, ty, 7, 7); }
  ctx.strokeStyle = 'rgba(255,217,138,0.9)'; ctx.lineWidth = 3; // route
  ctx.setLineDash([9, 7]);
  ctx.beginPath(); ctx.moveTo(300, 380); ctx.lineTo(196, 446); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff5d47'; // rescue boat
  ctx.beginPath(); ctx.arc(196, 446, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffd9cd'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(196, 446, 15, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffb648'; // own ship
  ctx.beginPath(); ctx.moveTo(300, 362); ctx.lineTo(286, 396); ctx.lineTo(314, 396); ctx.closePath(); ctx.fill();
  label(56, 486, 'GULL ROCK', 19, '#cfe8d8');
  label(392, 292, 'PALMA ISLE', 19, '#cfe8d8');
  label(346, 392, 'PORT AZURE', 19, '#ffe9bd');
  ctx.restore();
  label(36, 540, 'GS 32 · TRK 126 · RNG 5 NM', 21, '#9fd8ee');

  /* ------------------------------ six-pack ------------------------------ */
  const dial = (cx, cy, r, name, value, max, unit, ticks, sub) => {
    ctx.beginPath(); ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
    ctx.fillStyle = '#05080a'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#10181d'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#8a97a0'; ctx.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.textAlign = 'center';
    ticks.forEach((t) => {
      const a = a0 + (a1 - a0) * (t / max);
      ctx.strokeStyle = '#cfd8cc'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      ctx.lineTo(cx + Math.cos(a) * (r - 17), cy + Math.sin(a) * (r - 17));
      ctx.stroke();
      ctx.fillStyle = '#e8dfc8';
      ctx.font = '700 21px Verdana, sans-serif';
      ctx.fillText(t >= 1000 ? `${t / 1000}k` : String(t), cx + Math.cos(a) * (r - 34), cy + Math.sin(a) * (r - 34) + 7);
    });
    const a = a0 + (a1 - a0) * HW.clamp(value / max, 0, 1);
    ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22)); ctx.stroke();
    ctx.fillStyle = '#f3ead2';
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    label(cx, cy + r + 34, name, 23, '#7d938a', 'center');
    // The digital value sits below the hub, clear of the tick numerals
    // around the rim (at the top it collided with them).
    ctx.fillStyle = '#e8dfc8';
    ctx.font = '700 25px Verdana, sans-serif';
    ctx.fillText(`${value}${unit}`, cx, cy + 46);
    if (sub) label(cx, cy - r + 38, sub, 17, '#5f7a6e', 'center');
  };
  // Classic layout: ASI · attitude · ALT over turn · HDG · VSI.
  // (Fuel lives on the engine MFD as a bar; the six-pack stays classic.)
  dial(700, 268, 92, 'SPD', 32, 90, 'kt', [0, 15, 30, 45, 60, 75, 90]);
  dial(1324, 268, 92, 'ALT', 75, 2000, 'ft', [0, 500, 1000, 1500, 2000]);
  dial(700, 478, 92, 'TURN', 0.4, 1, '', [0, 0.5, 1], 'RATE');
  dial(1012, 478, 92, 'HDG', 126, 360, '°', [0, 90, 180, 270, 360]);
  dial(1324, 478, 92, 'VSI', 0, 1000, 'fpm', [0, 250, 500, 750, 1000]);
  // Attitude ball in the top-centre slot.
  {
    const cx = 1012, cy = 268, r = 92;
    ctx.beginPath(); ctx.arc(cx, cy, r + 9, 0, Math.PI * 2); ctx.fillStyle = '#05080a'; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2e6db4'; ctx.fillRect(cx - r, cy - r, r * 2, r + 4);
    ctx.fillStyle = '#7a5c40'; ctx.fillRect(cx - r, cy + 4, r * 2, r);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - r, cy + 4); ctx.lineTo(cx + r, cy + 4); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = '#8a97a0'; ctx.stroke();
    ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 38, cy + 4); ctx.lineTo(cx - 13, cy + 4); ctx.lineTo(cx, cy + 15); ctx.lineTo(cx + 13, cy + 4); ctx.lineTo(cx + 38, cy + 4);
    ctx.stroke();
    label(cx, cy + r + 34, 'ATTITUDE', 23, '#7d938a', 'center');
  }

  /* ---------------------------- engine MFD ---------------------------- */
  screen(1492, 148, 520, 356, 'ENG · HW-27');
  const bars = [['THR', 0.40, '#6fc3e7', '40%'], ['FUEL', 0.24, '#ff7a4d', '24%'], ['HULL', 0.92, '#8fd14f', '92%'], ['HOIST', 0.55, '#e08fff', '55%']];
  bars.forEach(([name, v, color, text], i) => {
    const y = 226 + i * 62;
    label(1514, y + 8, name, 24, '#9fb4ac');
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(1620, y - 14, 290, 24);
    ctx.fillStyle = color;
    ctx.fillRect(1620, y - 14, 290 * v, 24);
    ctx.fillStyle = '#f3ead2';
    ctx.font = '700 26px Verdana, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(text, 1996, y + 9);
  });
  label(1514, 486, 'OIL 78°C · CHT 190°C · RPM 2140', 21, '#9fd8ee');
  label(1514, 540, 'GEN ON · BUS 28V · PITOT HEAT', 21, '#7d938a');

  /* ------------------------------ radio row ------------------------------ */
  const radio = (x, w, freq, name) => {
    ctx.fillStyle = '#0c0f11';
    ctx.fillRect(x - 5, 571, w + 10, 76);
    ctx.fillStyle = '#10181d';
    ctx.fillRect(x, 576, w, 66);
    ctx.strokeStyle = '#3a444c'; ctx.lineWidth = 2; ctx.strokeRect(x, 576, w, 66);
    ctx.fillStyle = '#ffb648';
    ctx.font = '700 30px Verdana, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(freq, x + 16, 620);
    label(x + w - 14, 620, name, 20, '#7d938a', 'right');
  };
  radio(36, 470, '122.80', 'COM1 · TWR');
  radio(530, 470, '114.30', 'NAV1 · VOR');
  label(1024, 622, 'HW-27 · HARBOR WINGS', 25, '#a89a7d', 'center');
  radio(1048, 470, '110.30', 'ILS · RWY 36');
  radio(1542, 470, '121.50', 'COM2 · GND');

  HW._panelTexture = new THREE.CanvasTexture(c);
  HW._panelTexture.anisotropy = 4;
  return HW._panelTexture;
};

// A soft contact shadow that grounds the aircraft: a radial-gradient
// blob the game loop parks on the surface below the airframe, scaled
// and faded by height. The shadow map alone leaves the plane floating
// at screenshot range; leaders' landing frames are carried by exactly
// this anchor.
HW.makeShadowBlob = function () {
  if (HW._blobTexture) return HW._blobMesh;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 12, 128, 128, 126);
  grad.addColorStop(0, 'rgba(8,14,10,0.62)');
  grad.addColorStop(0.55, 'rgba(8,14,10,0.34)');
  grad.addColorStop(1, 'rgba(8,14,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  HW._blobTexture = new THREE.CanvasTexture(cv);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 21),
    new THREE.MeshBasicMaterial({ map: HW._blobTexture, transparent: true, depthWrite: false })
  );
  mesh.rotation.order = 'YXZ';
  mesh.rotation.x = -Math.PI / 2; // lie flat; syncPlane yaws it to heading
  mesh.renderOrder = 2;
  HW._blobMesh = mesh;
  return mesh;
};

// The pedestal quadrant plate: throttle / mixture / flap slots with
// labels and detent ticks, drawn once on a small canvas.
HW.pedestalTexture = function () {
  if (HW._pedestalTexture) return HW._pedestalTexture;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 368;
  const g = cv.getContext('2d');
  g.fillStyle = '#141a1f';
  g.fillRect(0, 0, 256, 368);
  g.strokeStyle = 'rgba(243,234,210,0.3)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, 248, 360);
  const slot = (x, name, color) => {
    g.fillStyle = '#05080a';
    g.fillRect(x - 7, 52, 14, 218);
    g.strokeStyle = '#3a444c';
    g.strokeRect(x - 7, 52, 14, 218);
    for (let k = 0; k <= 4; k++) {
      g.strokeStyle = '#7d938a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 12, 62 + k * 50); g.lineTo(x + 24, 62 + k * 50); g.stroke();
    }
    g.fillStyle = color;
    g.font = '700 19px Verdana, sans-serif';
    g.textAlign = 'center';
    g.fillText(name, x, 34);
    g.fillText(name === 'THR' ? 'FULL' : name === 'MIX' ? 'RICH' : 'DOWN', x, 300);
  };
  slot(52, 'THR', '#e8dfc8');
  slot(128, 'MIX', '#ff9a82');
  slot(204, 'FLAP', '#e8dfc8');
  g.fillStyle = '#7d938a';
  g.font = '700 16px Verdana, sans-serif';
  g.textAlign = 'center';
  g.fillText('HW-27 · QUADRANT', 128, 340);
  HW._pedestalTexture = new THREE.CanvasTexture(cv);
  return HW._pedestalTexture;
};

HW.buildAircraft = function () {
  const plane = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xf2e8d5, roughness: 0.55, metalness: 0.08 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x14607e, roughness: 0.5, metalness: 0.1 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8762c, roughness: 0.55 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b3136, roughness: 0.45, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18384a, roughness: 0.12, metalness: 0.55 });

  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; plane.add(mesh); return mesh; };

  // Fuselage: a tapered cylinder, nose at -Z.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.32, 10.4, 14), cream);
  body.rotation.x = Math.PI / 2;
  add(body, 0, 0, 0.4);
  // Engine cowl and spinner.
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(1.18, 14, 10), teal);
  cowl.scale.set(1, 0.85, 1.1);
  add(cowl, 0, 0, -4.6);
  // Teal cheatline along the hull.
  const stripes = [];
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 8.6), teal);
    add(stripe, sx * 1.06, -0.25, 0.2);
    stripes.push(stripe);
  }
  // Fuselage registration: "HW-27" plates on both flanks, so the
  // airframe reads as one particular aircraft, not a grey tube.
  const regTex = HW.labelTexture('HW-27', '#14607e');
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.55),
      new THREE.MeshBasicMaterial({ map: regTex, transparent: true })
    );
    plate.position.set(sx * 0.97, 0.38, 0.6);
    plate.rotation.y = sx * Math.PI / 2;
    plane.add(plate);
  }
  // Panel lines across the wings, a pitot tube, a whip antenna and
  // exhaust stubs: the small hardware that makes a model look built.
  for (const sx of [-1, 1]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.03, 0.09), darkMetal);
    add(seam, sx * 3.85, 1.76, 0.15);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 8), darkMetal);
    exhaust.rotation.x = Math.PI / 2;
    add(exhaust, sx * 0.95, -0.2, -4.5);
  }
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), darkMetal);
  pitot.rotation.x = Math.PI / 2;
  add(pitot, 4.6, 1.3, -1.7);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 6), darkMetal);
  add(antenna, 0, 1.5, 2.6);
  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10), glass);
  canopy.scale.set(0.88, 0.72, 1.7);
  add(canopy, 0, 0.95, -1.5);
  // Canopy frame bars and a centre post: the glass reads as a framed
  // windscreen, not a soap bubble.
  for (const fz of [-2.35, -0.65]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.07, 0.1), darkMetal);
    add(frame, 0, 1.63, fz);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.9), darkMetal);
  add(post, 0, 1.70, -1.5);
  // Door outlines on both flanks: four hairline bars each, the panel
  // line that makes the fuselage read as built sheet metal.
  for (const sx of [-1, 1]) {
    const dx = sx * 1.04;
    const mkBar = (w, h, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, w), darkMetal);
      add(b, dx, y, z);
    };
    mkBar(1.15, 0.035, 0.78, -0.7);   // top
    mkBar(1.15, 0.035, -0.55, -0.7); // bottom
    mkBar(0.035, 1.33, 0.1, -1.28);  // front (as depth bar)
    mkBar(0.035, 1.33, 0.1, -0.12);  // rear
  }
  // Cowl air intake under the nose.
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.62), darkMetal);
  add(intake, 0, -0.98, -4.35);
  // Dorsal fillet blending the fin into the rear fuselage.
  const fillet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 2.3), teal);
  fillet.rotation.x = 0.18;
  add(fillet, 0, 1.02, 3.7);
  // Parts that would swallow the camera in cockpit view.
  plane.userData.hideInCockpit = [body, canopy, cowl, ...stripes];

  // High wing in two halves with a touch of dihedral, orange tips.
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.26, 2.3), cream);
    wing.rotation.z = sx * 0.055;
    add(wing, sx * 3.85, 1.62, -0.7);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.28, 2.3), orange);
    tip.rotation.z = sx * 0.055;
    add(tip, sx * 7.35, 1.83, -0.7);
    // Struts from hull to wing.
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 6), darkMetal);
    strut.position.set(sx * 1.9, 0.35, -0.7);
    strut.rotation.z = sx * 0.72;
    plane.add(strut);
  }

  // Tail: stabiliser, fin and rudder in teal.
  const stab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 1.5), teal);
  add(stab, 0, 0.55, 5.2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.2, 1.7), teal);
  add(fin, 0, 1.5, 5.2);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.7, 0.9), orange);
  add(rudder, 0, 1.35, 6.1);

  // Twin floats on struts — she lands on water as happily as on the strip.
  for (const sx of [-1, 1]) {
    const float = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 8.4, 10), orange);
    float.rotation.x = Math.PI / 2;
    add(float, sx * 1.85, -2.35, -0.2);
    const floatNose = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), orange);
    floatNose.scale.set(1, 1, 1.6);
    add(floatNose, sx * 1.85, -2.35, -4.3);
    // A cream deck stripe and a step pad on each float, plus a water
    // rudder at the stern: the floats stop reading as plain orange tubes.
    const deckStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 7.4), cream);
    add(deckStripe, sx * 1.85, -1.85, -0.2);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.7), darkMetal);
    add(step, sx * 1.85, -1.88, 1.6);
    const wrudder = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.42), darkMetal);
    add(wrudder, sx * 1.85, -2.3, 4.15);
    for (const sz of [-1.9, 1.3]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 6), darkMetal);
      leg.position.set(sx * 1.55, -1.35, sz);
      leg.rotation.z = sx * 0.32;
      plane.add(leg);
    }
  }
  // Spreader bar between the floats.
  const spreader = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.7, 8), darkMetal);
  spreader.rotation.z = Math.PI / 2;
  add(spreader, 0, -2.3, 1.3);

  // Propeller: two blades and a spinner, spun by the render loop; a faint
  // disc sells the blur at speed.
  const prop = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.4 });
  const blades = [];
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.6, 0.08), bladeMat);
    blade.rotation.z = a;
    prop.add(blade);
    blades.push(blade);
  }
  // In cockpit view the frozen blades would fill the windscreen as a black
  // cross; the blur disc and spinner carry the prop there instead.
  plane.userData.propBlades = blades;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10), orange);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.4;
  prop.add(spinner);
  blades.push(spinner);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ea, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  disc.position.z = 0.06;
  prop.add(disc);
  // A denser inner disc sells the blur at speed; the faint outer ring
  // is the blade tips.
  const discInner = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 24),
    new THREE.MeshBasicMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
  );
  discInner.position.z = 0.09;
  prop.add(discInner);
  prop.position.set(0, 0, -6.05);
  plane.add(prop);
  plane.userData.prop = prop;

  // Navigation lights: port red, starboard green, tail white — each a
  // solid bead plus a soft additive glow sprite, so they read at range.
  const mkLight = (color, x, y, z) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color }));
    s.position.set(x, y, z);
    plane.add(s);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: HW.dotTexture(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.1);
    glow.position.set(x, y, z);
    plane.add(glow);
  };
  mkLight(0xff2a1a, -7.95, 1.9, -0.7);
  mkLight(0x2aff5a, 7.95, 1.9, -0.7);
  mkLight(0xffffff, 0, 1.5, 6.6);
  mkLight(0xff3b30, 0, 2.68, 5.2); // fin-top beacon

  // Cockpit, v2.2 rebuild. The v2.1 dash was a 3.2×0.7 box whose face
  // the 2.72×0.68 panel only partly covered, floating ahead of it on a
  // world-Z offset — from the eye it read as a giant empty black slab
  // with a small strip inside, a ring yoke floating in space, and the
  // floats as two black cylinders below. Now it is an assembly:
  //   · a dash body whose face the panel texture covers ENTIRELY
  //     (panel offset along the face normal, the v2 lesson);
  //   · a glareshield brow over the panel with a compass ball;
  //   · windscreen pillars framing the view edges;
  //   · side consoles with knobs, a centre pedestal with throttle and
  //     mixture levers and a labelled quadrant plate;
  //   · a yoke on a real column out of the dash, grips and hub;
  //   · a floor pan and rudder pedals, so the bottom of the frame is
  //     cockpit interior instead of open air and float tops.
  const cockpit = new THREE.Group();
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x232d33, roughness: 0.85 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x171d22, roughness: 0.95 });
  const TILT = 0.30;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.7, 1.3, 0.5), dashMat);
  dash.position.set(0, 0.62, -4.28);
  dash.rotation.x = TILT;
  cockpit.add(dash);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 1.15),
    new THREE.MeshBasicMaterial({ map: HW.panelTexture() })
  );
  // Face normal of the tilted dash: (0, -sin TILT, cos TILT); the panel
  // rides 0.26 along it from the dash centre, flush on the face.
  panel.position.set(0, 0.62 - Math.sin(TILT) * 0.26, -4.28 + Math.cos(TILT) * 0.26);
  panel.rotation.x = TILT;
  cockpit.add(panel);
  // Glareshield brow: a padded slab overhanging the panel top.
  const brow = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.1, 0.72), padMat);
  brow.position.set(0, 1.24, -4.08);
  brow.rotation.x = 0.10;
  cockpit.add(brow);
  // Compass ball on a stalk, offset left on the brow — dead centre it
  // sat like a bowling ball in front of the rescue boat.
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.12, 8), dashMat);
  stalk.position.set(-0.85, 1.33, -4.08);
  cockpit.add(stalk);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1c2f3a, roughness: 0.25, metalness: 0.3 }));
  ball.position.set(-0.85, 1.43, -4.08);
  cockpit.add(ball);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.069, 0.011, 6, 18), new THREE.MeshBasicMaterial({ color: 0xf3ead2 }));
  band.position.copy(ball.position);
  band.rotation.x = Math.PI / 2;
  cockpit.add(band);
  // Windscreen pillars at the view edges.
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.5, 0.13), dashMat);
    pillar.position.set(sx * 1.66, 2.0, -3.8);
    pillar.rotation.x = -0.38;
    pillar.rotation.z = -sx * 0.10;
    cockpit.add(pillar);
  }
  // Side consoles with knob rows.
  const knobCols = [0xd8cfb8, 0xb03a26, 0x39586e];
  for (const sx of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 1.7), dashMat);
    con.position.set(sx * 1.62, -0.42, -3.15);
    cockpit.add(con);
    for (let k = 0; k < 3; k++) {
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10),
        new THREE.MeshStandardMaterial({ color: knobCols[k], roughness: 0.5 })
      );
      knob.position.set(sx * 1.62, -0.17, -3.7 + k * 0.5);
      cockpit.add(knob);
    }
  }
  // Centre pedestal with a labelled quadrant plate and two levers.
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 1.5), dashMat);
  pedestal.position.set(0, -0.62, -3.2);
  pedestal.rotation.x = 0.22;
  cockpit.add(pedestal);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 1.15),
    new THREE.MeshBasicMaterial({ map: HW.pedestalTexture() })
  );
  plate.position.set(0, -0.205, -3.085);
  plate.rotation.x = -Math.PI / 2 + 0.22;
  cockpit.add(plate);
  const lever = (x, knobColor) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), padMat);
    arm.position.set(x, 0.02, -3.28);
    arm.rotation.x = -0.45;
    cockpit.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: knobColor, roughness: 0.4 }));
    knob.position.set(x, 0.20, -3.17);
    cockpit.add(knob);
  };
  lever(-0.17, 0x14181c); // throttle, black knob
  lever(0.17, 0xb03a26);  // mixture, red knob
  // Yoke: a column out of the dash's lower centre, a hub, a crossbar
  // and two grips — mounted, not floating.
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.9, 10), padMat);
  column.position.set(0, -0.30, -3.66);
  column.rotation.x = 1.02;
  cockpit.add(column);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.13, 12), padMat);
  hub.position.set(0, -0.04, -3.40);
  hub.rotation.x = Math.PI / 2;
  cockpit.add(hub);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.085, 0.085), padMat);
  bar.position.set(0, -0.04, -3.38);
  cockpit.add(bar);
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.3, 8), padMat);
    grip.position.set(sx * 0.31, -0.17, -3.38);
    grip.rotation.z = sx * 0.22;
    cockpit.add(grip);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xf2e8d5, roughness: 0.5 }));
  cap.position.set(0, -0.04, -3.325);
  cap.rotation.x = Math.PI / 2;
  cockpit.add(cap);
  // Floor pan and rudder pedals.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.07, 1.9), padMat);
  floor.position.set(0, -1.02, -3.0);
  cockpit.add(floor);
  for (const sx of [-1, 1]) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.24, 0.05), dashMat);
    pedal.position.set(sx * 0.30, -0.80, -3.88);
    pedal.rotation.x = 0.42;
    cockpit.add(pedal);
  }
  cockpit.visible = false;
  plane.add(cockpit);
  plane.userData.cockpit = cockpit;

  plane.rotation.order = 'YXZ';
  return plane;
};
