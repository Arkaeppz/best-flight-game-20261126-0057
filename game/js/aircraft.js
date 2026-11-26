// aircraft.js — the Harbor Wings floatplane, built from primitives: a cream
// and teal high-wing seaplane on twin floats, with a spinning prop, nav
// lights and a cockpit frame that appears in cockpit view. Local axes:
// nose toward -Z, right wing toward +X, up +Y.

window.HW = window.HW || {};

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
  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10), glass);
  canopy.scale.set(0.88, 0.72, 1.7);
  add(canopy, 0, 0.95, -1.5);
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
    for (const sz of [-1.9, 1.3]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 6), darkMetal);
      leg.position.set(sx * 1.55, -1.35, sz);
      leg.rotation.z = sx * 0.32;
      plane.add(leg);
    }
  }

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
    new THREE.MeshBasicMaterial({ color: 0xdfe8ea, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
  );
  disc.position.z = 0.06;
  prop.add(disc);
  prop.position.set(0, 0, -6.05);
  plane.add(prop);
  plane.userData.prop = prop;

  // Navigation lights: port red, starboard green, tail white.
  const mkLight = (color, x, y, z) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color }));
    s.position.set(x, y, z);
    plane.add(s);
  };
  mkLight(0xff2a1a, -7.95, 1.9, -0.7);
  mkLight(0x2aff5a, 7.95, 1.9, -0.7);
  mkLight(0xffffff, 0, 1.5, 6.6);

  // Cockpit frame: a dash and coaming low in the pilot's view, visible
  // only from inside. Kept well ahead of the camera — anything closer
  // looms as a black slab and swallows the frame.
  const cockpit = new THREE.Group();
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x232d33, roughness: 0.85 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.95, 0.5), dashMat);
  dash.position.set(0, 0.5, -3.55);
  dash.rotation.x = 0.28;
  cockpit.add(dash);
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.16, 0.7), dashMat);
  coaming.position.set(0, 1.06, -3.5);
  cockpit.add(coaming);
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 18), dashMat);
  yoke.position.set(0, 0.42, -3.3);
  cockpit.add(yoke);
  cockpit.visible = false;
  plane.add(cockpit);
  plane.userData.cockpit = cockpit;

  plane.rotation.order = 'YXZ';
  return plane;
};
