// terrain.js — the Azure Archipelago: one height function shared by the mesh,
// the flight model's ground collision and every placed object, so what you
// see is exactly what you can hit. Geography, west to east: Mount Kora (a
// smoking volcano), the Rio Verde cutting the main island, Port Azure town
// and its runway on a coastal shelf, the bay, Gull Rock lighthouse, and
// Palma Isle on the horizon.

window.HW = window.HW || {};

HW.GEO = {
  volcano: { x: -1150, z: -750, r: 780, h: 540 },
  mainIsland: { x: -450, z: 250, r: 1150, h: 110 },
  palma: { x: 1450, z: 450, r: 600, h: 85 },
  gullRock: { x: 450, z: 1480, r: 210, h: 24 },
  bay: { x: 1020, z: 1180, r: 680, depth: 34 },
  runway: { x: 300, z0: 680, z1: 1360, w: 46, alt: 13.6 },
  boat: { x: 950, z: 1250 },
  lighthouse: { x: 450, z: 1480 },
  town: { x0: 40, x1: 250, z0: 780, z1: 1280 },
};

HW.RIVER = [
  [-900, -350], [-450, 50], [-150, 350], [60, 620], [210, 830],
];

function bump(x, z, c) {
  const dx = x - c.x, dz = z - c.z;
  const d2 = (dx * dx + dz * dz) / (c.r * c.r);
  return c.h * Math.exp(-d2 * 1.7);
}

function riverInfo(x, z) {
  // Distance to the river polyline and the channel level along it (0..1).
  let best = 1e9, bestT = 0;
  const pts = HW.RIVER;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const abx = bx - ax, abz = bz - az;
    const t = HW.clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
    const px = ax + abx * t, pz = az + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bestT = (i + t) / (pts.length - 1); }
  }
  return { dist: best, level: HW.riverLevelAt ? HW.riverLevelAt(bestT) : 3 };
}

function baseHeightAt(x, z) {
  const G = HW.GEO;
  let h = bump(x, z, G.mainIsland) + bump(x, z, G.palma) + bump(x, z, G.gullRock);

  // Mount Kora: a cone with a crater bite, on its own shoulder of land.
  const dv = Math.hypot(x - G.volcano.x, z - G.volcano.z);
  h += 60 * Math.exp(-((dv / 900) ** 2) * 1.7);
  if (dv < G.volcano.r) {
    const cone = G.volcano.h * Math.pow(1 - dv / G.volcano.r, 1.35);
    h += cone;
    if (dv < 130) h -= 95 * (1 - dv / 130);
  }

  // Rolling detail, only where there is land to roll — and kept off Mount
  // Kora's cone, where it would shred the silhouette into spikes.
  const land = HW.clamp((h - 2) / 26, 0, 1);
  const offCone = HW.clamp((dv - 500) / 420, 0, 1);
  h += HW.fbm(x * 0.0016 + 7.3, z * 0.0016 - 2.1, 3) * 15 * land * offCone;
  h += HW.fbm(x * 0.011, z * 0.011, 2) * 1.6 * land * offCone;

  // The bay east of Port Azure is carved below sea level.
  const db = Math.hypot(x - G.bay.x, z - G.bay.z);
  h -= G.bay.depth * Math.exp(-((db / G.bay.r) ** 2) * 1.8);

  // Port Azure shelf: town and runway sit on a flat coastal plateau.
  const px = HW.clamp((x - 10) / 110, 0, 1) * HW.clamp((580 - x) / 110, 0, 1);
  const pz = HW.clamp((z - 600) / 110, 0, 1) * HW.clamp((1460 - z) / 110, 0, 1);
  const shelf = Math.min(px, pz);
  if (shelf > 0) h = HW.lerp(h, 13, shelf * shelf * (3 - 2 * shelf));

  return h;
}

// The river's long profile: sample the un-carved terrain along the
// polyline, smooth it into a steady descent, and cut the channel a few
// metres below it. (Cutting to a fixed sea-bound level instead would dig
// a canyon through the volcano's flank — the channel must hug the land.)
const RIVER_PROFILE = (() => {
  const pts = HW.RIVER, N = 48, raw = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const lt = t * (pts.length - 1) - seg;
    raw.push(baseHeightAt(
      HW.lerp(pts[seg][0], pts[seg + 1][0], lt),
      HW.lerp(pts[seg][1], pts[seg + 1][1], lt)
    ));
  }
  for (let i = N - 1; i >= 0; i--) raw[i] = Math.max(raw[i], raw[i + 1]); // never flows uphill
  for (let p = 0; p < 4; p++) {
    for (let i = 1; i < N; i++) raw[i] = (raw[i - 1] + raw[i] * 2 + raw[i + 1]) / 4;
  }
  return raw.map((v) => Math.max(1.5, v - 5));
})();

HW.riverLevelAt = function (t) {
  const N = RIVER_PROFILE.length - 1;
  const f = HW.clamp(t, 0, 1) * N;
  const i = Math.min(N - 1, Math.floor(f));
  return HW.lerp(RIVER_PROFILE[i], RIVER_PROFILE[i + 1], f - i);
};

HW.heightAt = function (x, z) {
  let h = baseHeightAt(x, z);
  // The Rio Verde cuts its channel last, through everything.
  const river = riverInfo(x, z);
  if (river.dist < 46 && h > river.level) {
    const t = HW.clamp(1 - river.dist / 46, 0, 1);
    h = HW.lerp(h, Math.min(h, river.level + 0.8), t * t * (3 - 2 * t));
  }
  return h;
};

HW.riverDist = function (x, z) { return riverInfo(x, z).dist; };

// What the flight model treats as the ground: terrain, or the runway deck.
HW.groundAt = function (x, z) {
  const R = HW.GEO.runway;
  let g = HW.heightAt(x, z);
  if (Math.abs(x - R.x) < R.w / 2 + 2 && z > R.z0 - 4 && z < R.z1 + 4) g = Math.max(g, R.alt);
  return g;
};

HW.onRunway = function (x, z) {
  const R = HW.GEO.runway;
  return Math.abs(x - R.x) < R.w / 2 && z > R.z0 && z < R.z1;
};

/* ------------------------- world construction ------------------------- */

function terrainColor(x, z, h, slope) {
  const G = HW.GEO;
  const dv = Math.hypot(x - G.volcano.x, z - G.volcano.z);
  const n = HW.fbm(x * 0.004 - 3.7, z * 0.004 + 9.2, 2);
  let r, g, b;
  if (h < 1.6) { r = 0.85; g = 0.75; b = 0.54; }                       // sand
  else if (slope > 0.55) { r = 0.54; g = 0.49; b = 0.44; }             // bare rock
  else if (n > 0.12) { r = 0.18; g = 0.42; b = 0.23; }                 // forest
  else { r = 0.38; g = 0.64; b = 0.33; }                               // grass
  // Sandy banks along the Rio Verde, so the channel reads as a river
  // valley from the air instead of a crack in the hillside.
  if (h > 2 && HW.riverDist(x, z) < 58) {
    const t = HW.clamp(1 - HW.riverDist(x, z) / 58, 0, 0.55);
    r = HW.lerp(r, 0.78, t); g = HW.lerp(g, 0.68, t); b = HW.lerp(b, 0.47, t);
  }
  if (dv < G.volcano.r * 1.02 && h > 60) {                             // ash field
    const t = HW.clamp((h - 60) / 200, 0, 0.65) * (0.75 + 0.25 * n);
    r = HW.lerp(r, 0.46, t); g = HW.lerp(g, 0.44, t); b = HW.lerp(b, 0.42, t);
  }
  if (h > 430) { r = 0.95; g = 0.94; b = 0.92; }                        // snow cap
  return [r, g, b];
}

HW.buildWorld = function (scene) {
  const G = HW.GEO;
  const world = { animated: [] };

  // Sky dome: a vertex-coloured gradient, warm at the horizon.
  {
    const geo = new THREE.SphereGeometry(6800, 24, 12);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x2e6db4), mid = new THREE.Color(0x9fc8dd), low = new THREE.Color(0xf6dfba);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = HW.clamp(pos.getY(i) / 6800, -1, 1);
      if (t > 0.25) c.copy(mid).lerp(top, (t - 0.25) / 0.75);
      else c.copy(low).lerp(mid, HW.clamp((t + 0.12) / 0.37, 0, 1));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);
  }

  // Terrain heightfield.
  {
    const SIZE = 4600, SEG = 172;
    let geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, HW.heightAt(x, z));
    }
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const p2 = geo.attributes.position, n2 = geo.attributes.normal;
    const colors2 = new Float32Array(p2.count * 3);
    for (let i = 0; i < p2.count; i++) {
      const x = p2.getX(i), z = p2.getZ(i), h = p2.getY(i);
      const slope = 1 - Math.abs(n2.getY(i));
      const [r, g, b] = terrainColor(x, z, h, slope);
      colors2[i * 3] = r; colors2[i * 3 + 1] = g; colors2[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors2, 3));
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Sea.
  {
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(6600, 48),
      new THREE.MeshPhongMaterial({ color: 0x14607e, shininess: 160, specular: 0xbfe3ef, transparent: true, opacity: 0.96 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    scene.add(sea);
    world.sea = sea;
  }

  // Rio Verde ribbon, following the carved channel.
  {
    const pts = HW.RIVER;
    const verts = [], idx = [];
    const STEPS = 170;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const lt = t * (pts.length - 1) - seg;
      const x = HW.lerp(pts[seg][0], pts[seg + 1][0], lt);
      const z = HW.lerp(pts[seg][1], pts[seg + 1][1], lt);
      const dx = pts[seg + 1][0] - pts[seg][0], dz = pts[seg + 1][1] - pts[seg][1];
      const len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
      const y = HW.riverLevelAt(t) + 0.9, w = 14;
      verts.push(x - nx * w, y, z - nz * w, x + nx * w, y, z + nz * w);
      if (i < STEPS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x1a7296, shininess: 200, specular: 0xd6f0fa })));
  }

  // Runway at Port Azure: deck, centreline, threshold, edge lights.
  {
    const R = G.runway;
    const grp = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(R.w, 1.4, R.z1 - R.z0),
      new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.95 })
    );
    deck.position.set(R.x, R.alt - 0.7, (R.z0 + R.z1) / 2);
    deck.receiveShadow = true;
    grp.add(deck);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f2e6 });
    for (let z = R.z0 + 42; z < R.z1 - 30; z += 56) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 26), lineMat);
      dash.position.set(R.x, R.alt + 0.08, z);
      grp.add(dash);
    }
    for (const zend of [R.z0 + 8, R.z1 - 8]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(R.w - 8, 0.15, 3.2), lineMat);
      bar.position.set(R.x, R.alt + 0.08, zend);
      grp.add(bar);
    }
    const lightGeo = new THREE.SphereGeometry(0.9, 8, 6);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    const endMat = new THREE.MeshBasicMaterial({ color: 0x51ff7e });
    for (let z = R.z0; z <= R.z1; z += 68) {
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(lightGeo, (z === R.z0 || z >= R.z1 - 1) ? endMat : edgeMat);
        s.position.set(R.x + sx * (R.w / 2 + 2.5), R.alt + 0.6, z);
        grp.add(s);
      }
    }
    scene.add(grp);
  }

  // Port Azure town: a grid of houses, a church, harbour warehouses.
  {
    const rng = HW.makeRng(1234);
    const grp = new THREE.Group();
    const palette = [0xe8dcc0, 0xd9b48a, 0xb56b4a, 0x8fb6bd, 0xe3e0d5, 0xc7d3a8];
    const roofPalette = [0xa35d3f, 0x8a4f35, 0xb5703f, 0x74584a, 0x9c6644];
    // A packed-earth apron under the town, so the streets read as a place
    // rather than boxes scattered on raw grass.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(270, 560),
      new THREE.MeshStandardMaterial({ color: 0xc9b995, roughness: 1 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(150, 13.18, 1035);
    apron.receiveShadow = true;
    grp.add(apron);
    const addBuilding = (x, z, w, d, h, color) => {
      const y = HW.heightAt(x, z);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      b.position.set(x, y + h / 2 - 0.4, z);
      b.castShadow = true; b.receiveShadow = true;
      grp.add(b);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1.6, 1.4, d + 1.6),
        new THREE.MeshStandardMaterial({ color: roofPalette[Math.floor(rng() * roofPalette.length)], roughness: 1 })
      );
      roof.position.set(x, y + h + 0.3, z);
      roof.castShadow = true;
      grp.add(roof);
    };
    for (let gx = 62; gx <= 238; gx += 37) {
      for (let gz = 792; gz <= 1270; gz += 44) {
        if (rng() < 0.18) continue;
        const x = gx + (rng() - 0.5) * 9, z = gz + (rng() - 0.5) * 10;
        addBuilding(x, z, 15 + rng() * 10, 15 + rng() * 10, 7 + rng() * 15, palette[Math.floor(rng() * palette.length)]);
      }
    }
    // Church with a tower, the town's landmark.
    addBuilding(120, 900, 20, 30, 12, 0xf0e9d8);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 32, 8), new THREE.MeshStandardMaterial({ color: 0xf0e9d8, roughness: 0.9 }));
    tower.position.set(120, HW.heightAt(120, 888) + 15.6, 888);
    tower.castShadow = true;
    grp.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(6.4, 10, 4), new THREE.MeshStandardMaterial({ color: 0x39586e, roughness: 0.8 }));
    spire.position.set(120, HW.heightAt(120, 888) + 36.5, 888);
    spire.rotation.y = Math.PI / 4;
    grp.add(spire);
    // Warehouses along the shore road.
    for (let i = 0; i < 4; i++) addBuilding(430 + (i % 2) * 34, 900 + i * 88, 26, 40, 10, 0x9a8f7d);
    scene.add(grp);
  }

  // Harbour pier and moored boats.
  {
    const grp = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 1 });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(150, 1.6, 14), wood);
    pier.position.set(590, 2.2, 1080);
    grp.add(pier);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xc7502e, roughness: 0.7 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.8 });
    const mkBoat = (x, z, ry, s) => {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(7 * s, 2.6 * s, 20 * s), hullMat);
      hull.position.y = 0.8;
      boat.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(5 * s, 3 * s, 6 * s), cabinMat);
      cabin.position.set(0, 3.4 * s, -2 * s);
      boat.add(cabin);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 11 * s), wood);
      mast.position.set(0, 6 * s, 3 * s);
      boat.add(mast);
      boat.position.set(x, 0.4, z);
      boat.rotation.y = ry;
      grp.add(boat);
      return boat;
    };
    mkBoat(610, 1052, 0.2, 1);
    mkBoat(648, 1106, -0.3, 0.85);
    mkBoat(700, 1010, 0.9, 1.15);
    scene.add(grp);
  }

  // The stranded fishing boat (rescue target): listing, with orange smoke.
  {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 26), new THREE.MeshStandardMaterial({ color: 0x2e6f8e, roughness: 0.65 }));
    hull.position.y = 0.6;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 3.6, 7), new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.8 }));
    cabin.position.set(0, 3.6, -3);
    boat.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 13), new THREE.MeshStandardMaterial({ color: 0x5c4632 }));
    mast.position.set(0, 7.5, 4);
    mast.rotation.z = 0.16;
    boat.add(mast);
    boat.position.set(G.boat.x, 0.3, G.boat.z);
    boat.rotation.set(0.1, 0.7, 0.13);
    boat.scale.setScalar(1.3);
    scene.add(boat);
    world.rescueBoat = boat;

    const N = 46, posArr = new Float32Array(N * 3);
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ color: 0xff7a26, size: 15, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }));
    scene.add(smoke);
    world.animated.push((t) => {
      for (let i = 0; i < N; i++) {
        const life = ((t * 0.14 + i / N) % 1);
        posArr[i * 3] = G.boat.x + Math.sin(life * 9 + i) * 6 * life + life * 22;
        posArr[i * 3 + 1] = 4 + life * 64;
        posArr[i * 3 + 2] = G.boat.z + Math.cos(life * 7 + i * 2) * 5 * life;
      }
      smokeGeo.attributes.position.needsUpdate = true;
    });
  }

  // Gull Rock lighthouse.
  {
    const grp = new THREE.Group();
    const y = HW.heightAt(G.lighthouse.x, G.lighthouse.z);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc23b2a, roughness: 0.8 });
    const bands = [[10, white], [7, red], [7, white], [6, red]];
    let cy = y;
    for (const [h, m] of bands) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.9, h, 12), m);
      seg.position.set(G.lighthouse.x, cy + h / 2, G.lighthouse.z);
      seg.castShadow = true;
      grp.add(seg);
      cy += h;
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a3 }));
    lamp.position.set(G.lighthouse.x, cy + 2.2, G.lighthouse.z);
    grp.add(lamp);
    scene.add(grp);
  }

  // Mount Kora's smoke column.
  {
    const N = 70, posArr = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8d2c6, size: 42, transparent: true, opacity: 0.4, sizeAttenuation: true, depthWrite: false }));
    scene.add(pts);
    const craterY = HW.heightAt(G.volcano.x, G.volcano.z);
    world.animated.push((t) => {
      for (let i = 0; i < N; i++) {
        const life = ((t * 0.05 + i / N) % 1);
        posArr[i * 3] = G.volcano.x + Math.sin(life * 6 + i * 1.7) * 26 * life + life * 90;
        posArr[i * 3 + 1] = craterY + 8 + life * 300;
        posArr[i * 3 + 2] = G.volcano.z + Math.cos(life * 5 + i) * 22 * life;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // Vegetation and farmland: instanced pine cones on the slopes and
  // patchwork fields on the flat shelf — the texture that turns bare
  // hills into recognisable, flown-over country.
  {
    const rng = HW.makeRng(4242);
    const spots = [];
    for (let i = 0; i < 2600 && spots.length < 650; i++) {
      const x = (rng() - 0.5) * 4000, z = (rng() - 0.5) * 4000;
      const h = HW.heightAt(x, z);
      if (h < 3 || h > 210) continue;
      if (Math.hypot(x - G.volcano.x, z - G.volcano.z) < 860) continue;
      if (HW.riverDist(x, z) < 40) continue;
      if (x > -10 && x < 600 && z > 580 && z < 1620) continue; // the shelf + approach corridor
      const slope = Math.abs(HW.heightAt(x + 8, z) - h) + Math.abs(HW.heightAt(x, z + 8) - h);
      if (slope > 7) continue;
      spots.push([x, h, z]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.4, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const coneGeo = new THREE.ConeGeometry(3.1, 9.5, 7);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    const greens = [new THREE.Color(0x2c6e35), new THREE.Color(0x3a7d3a), new THREE.Color(0x256029), new THREE.Color(0x4c8a42)];
    spots.forEach(([x, h, z], i) => {
      const s = 0.8 + rng() * 0.9;
      sc.set(s, s * (0.9 + rng() * 0.4), s);
      q.setFromAxisAngle(pv.set(0, 1, 0), rng() * Math.PI);
      m4.compose(new THREE.Vector3(x, h + 1.6 * sc.y, z), q, sc);
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, h + (3.2 + 4.4) * sc.y, z), q, sc);
      cones.setMatrixAt(i, m4);
      cones.setColorAt(i, greens[Math.floor(rng() * greens.length)]);
    });
    cones.castShadow = true;
    scene.add(trunks);
    scene.add(cones);

    // Patchwork fields on the flat ground south and east of the town.
    const fieldColors = [0xc9a94e, 0x8fae4c, 0x9a7350, 0xb5bf62, 0xa8a35e];
    let placed = 0;
    for (let gx = 30; gx < 560 && placed < 12; gx += 58) {
      for (let gz = 640; gz < 1450 && placed < 12; gz += 58) {
        if (gx > 20 && gx < 270 && gz > 740 && gz < 1330) continue;   // town
        if (Math.abs(gx - G.runway.x) < 70 && gz > 620 && gz < 1420) continue; // strip
        const h = HW.heightAt(gx, gz);
        if (h < 4 || h > 20) continue;
        const flat = Math.abs(HW.heightAt(gx + 22, gz) - h) + Math.abs(HW.heightAt(gx, gz + 22) - h);
        if (flat > 1.6) continue;
        const w = 44 + rng() * 26, d = 44 + rng() * 26;
        const f = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          new THREE.MeshStandardMaterial({ color: fieldColors[Math.floor(rng() * fieldColors.length)], roughness: 1 })
        );
        f.rotation.x = -Math.PI / 2;
        f.rotation.z = (rng() - 0.5) * 0.14;
        f.position.set(gx, h + 0.3, gz);
        f.receiveShadow = true;
        scene.add(f);
        placed += 1;
      }
    }
  }

  // Clouds: flat puffs of merged spheres, drifting slowly east.
  {
    const rng = HW.makeRng(777);
    // Unlit material: clouds read as flat bright illustration at any angle,
    // never as dark blobs lit from the wrong side.
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf7fbff, transparent: true, opacity: 0.92, fog: false });
    const clouds = new THREE.Group();
    for (let i = 0; i < 24; i++) {
      const cl = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(16 + rng() * 22, 10, 8), cloudMat);
        s.position.set((rng() - 0.5) * 60, (rng() - 0.5) * 7, (rng() - 0.5) * 30);
        s.scale.y = 0.42;
        cl.add(s);
      }
      const a = rng() * Math.PI * 2, rad = 500 + rng() * 2100;
      cl.position.set(Math.cos(a) * rad, 330 + rng() * 150, Math.sin(a) * rad);
      clouds.add(cl);
    }
    scene.add(clouds);
    world.animated.push((t) => { clouds.position.x = (t * 3.5) % 300; });
  }

  world.update = function (t) {
    for (const fn of world.animated) fn(t);
  };
  return world;
};

// A course ring: a glowing torus the pilot threads. `active` pulses.
// (No fill disc: at a glancing angle a translucent disc reads as a solid
// alien ellipse hovering over the terrain.)
HW.makeRing = function (color) {
  const grp = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(26, 1.7, 10, 40),
    new THREE.MeshBasicMaterial({ color })
  );
  grp.add(torus);
  grp.userData.torus = torus;
  return grp;
};

// A tall light pillar marking the active objective — readable from anywhere.
HW.makeBeacon = function (color) {
  const geo = new THREE.CylinderGeometry(0.8, 1.6, 420, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 210;
  const grp = new THREE.Group();
  grp.add(mesh);
  return grp;
};
