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

/* -------------------- v2.3: ONE dusk palette -------------------- */
// The field leaders' dusk is saturated because every system reads ONE
// palette (GitHub hunt round 2, flight_game_dev skill). This object is
// the single source: the sky shader, the fog, the hemisphere and sun
// lights (main.js reads it too), the water ramp and the cloud grading
// all take their colours from here. Change the mood here, never by
// tuning systems separately.
HW.DUSK = {
  zenith: 0x273d75,      // deep indigo overhead
  mid: 0x7d5ea6,         // violet band
  horizon: 0xff9a52,     // peach-orange at the skyline
  sunGlow: 0xffc384,
  sunCore: 0xfff0c0,
  fog: 0xf09a5c,         // warm haze, a breath deeper than the horizon
  hemiSky: 0xffc79c,
  hemiGround: 0x44543c,
  sun: 0xffb066,
  waterDeep: 0x10384f,
  waterMid: 0x2a6d8c,
  waterHi: 0xffd9a3,     // warm sun-glint highlight
  cloudLit: 0xffd7a8,
  cloudBody: 0xb9c2cc,
  cloudShade: 0x565d78,
  stormLit: 0xf0a96e,
  stormBody: 0x798091,
  stormBase: 0x363c4e,
};

// The sun's direction, shared by the sky shader's disc/glow, the water
// glitter and main.js's light placement: low in the east-north-east,
// so its light rakes long across the archipelago.
HW.SUN_DIR = new THREE.Vector3(1650, 560, -760).normalize();

// Terrain heights as a texture, so the water shader can compute depth
// (water level − bed height) for its foam band without a depth pass.
// Float red channel, sampled in world XZ over the 4600 m terrain.
HW.heightTexture = function () {
  if (HW._heightTexture) return HW._heightTexture;
  const N = 256, data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      data[j * N + i] = HW.heightAt(-2300 + (i / (N - 1)) * 4600, -2300 + (j / (N - 1)) * 4600);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  HW._heightTexture = tex;
  return tex;
};

// Cel water (cortiz2894 WaterFloor pattern, MIT): world-anchored
// Voronoi cells through a hard 3-step ramp, so the sea facets like the
// flat-shaded land instead of glowing through a smooth gradient. Foam
// is computed from the heightmap: shallow water whose neighbourhood
// pokes above the surface — the shoreline — broken into dashes by a
// second, finer cell field. One material serves the sea disc and the
// Rio Verde ribbon (both sample world position).
HW.waterMaterial = function () {
  if (HW._waterMaterial) return HW._waterMaterial;
  const D = HW.DUSK;
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: new THREE.Color(D.waterDeep) },
        uMid: { value: new THREE.Color(D.waterMid) },
        uHi: { value: new THREE.Color(D.waterHi) },
        uSunDirW: { value: HW.SUN_DIR },
        uHeight: { value: null },
      },
    ]),
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uDeep, uMid, uHi, uSunDirW;
      uniform sampler2D uHeight;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      vec2 vhash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }
      float bedAt(vec2 xz) {
        vec2 uv = (xz + 2300.0) / 4600.0;
        if (uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999) return -30.0;
        return texture2D(uHeight, uv).r;
      }
      void main() {
        // Voronoi F2−F1: cell facets + bright seams.
        vec2 p = vWorld.xz / 15.0;
        vec2 ip = floor(p), fp = fract(p);
        float f1 = 8.0, f2 = 8.0;
        vec2 cellId = ip;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + vhash(ip + g) - fp;
          float d = dot(r, r);
          if (d < f1) { f2 = f1; f1 = d; cellId = ip + g; }
          else if (d < f2) { f2 = d; }
        }
        float edge = sqrt(f2) - sqrt(f1);
        float cellRand = vhash(cellId * 1.71).x;
        float bed = bedAt(vWorld.xz);
        float depth = vWorld.y - bed;
        vec3 col = mix(uDeep, uMid, 0.2 + cellRand * 0.6);
        col *= 0.88 + floor(cellRand * 3.0) * 0.11;          // 3-step cel shading
        col = mix(col, uDeep * 0.75, clamp(depth / 26.0, 0.0, 0.55));
        col = mix(col, uHi, (1.0 - smoothstep(0.02, 0.13, edge)) * 0.34);
        // Sun sheen: a broad warm wash on the sun side.
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 H = normalize(V + uSunDirW);
        col += uHi * pow(max(dot(vec3(0.0, 1.0, 0.0), H), 0.0), 60.0) * 0.35;
        // Foam: shallow water beside land that breaks the surface,
        // dashed by a finer cell field so it never reads as a ribbon.
        float bedMax = max(max(bedAt(vWorld.xz + vec2(9.0, 0.0)), bedAt(vWorld.xz - vec2(9.0, 0.0))),
                           max(bedAt(vWorld.xz + vec2(0.0, 9.0)), bedAt(vWorld.xz - vec2(0.0, 9.0))));
        float shore = step(vWorld.y + 0.25, bedMax);
        vec2 q = vWorld.xz / 4.5;
        vec2 iq = floor(q), fq = fract(q);
        float e2 = 8.0, e1 = 8.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + vhash(iq + g) - fq;
          float d = dot(r, r);
          if (d < e1) { e2 = e1; e1 = d; } else if (d < e2) { e2 = d; }
        }
        float dash = smoothstep(0.04, 0.30, sqrt(e2) - sqrt(e1));
        float foam = (1.0 - smoothstep(0.05, 0.85, depth)) * shore * (0.30 + 0.70 * dash);
        col = mix(col, vec3(0.96, 0.98, 0.97), clamp(foam, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uHeight.value = HW.heightTexture();
  HW._waterMaterial = mat;
  return mat;
};

// A four-point star sprite: the sun-glint sparkles on the water.
HW.starTexture = function () {
  if (HW._starTexture) return HW._starTexture;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  const core = g.createRadialGradient(32, 32, 1, 32, 32, 10);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    g.beginPath();
    g.moveTo(32 - dy * 2.2, 32 - dx * 2.2);
    g.lineTo(32 + dx * 29, 32 + dy * 29);
    g.lineTo(32 + dy * 2.2, 32 + dx * 2.2);
    g.closePath();
    g.fill();
  }
  HW._starTexture = new THREE.CanvasTexture(cv);
  return HW._starTexture;
};

// A rain ring: a soft stroked circle that expands and fades on the
// water under the storm cell (MengTo 3d-harbour-water pattern).
HW.rainRingTexture = function () {
  if (HW._rainRingTexture) return HW._rainRingTexture;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 5;
  g.shadowColor = 'rgba(255,255,255,0.8)';
  g.shadowBlur = 7;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  HW._rainRingTexture = new THREE.CanvasTexture(cv);
  return HW._rainRingTexture;
};

// One cloud puff with its lighting BAKED IN (eevee-threejs cloud
// pattern): several overlapping discs filled with a single vertical
// gradient — warm-lit top, body, shaded base — so a cluster of sprites
// reads as one soft mass lit by the sun, never as flat dark blobs.
// The alpha is then eroded by a radial mask for a soft silhouette.
HW.cloudTexture = function (storm) {
  const key = storm ? '_stormTex' : '_fairTex';
  if (HW[key]) return HW[key];
  const D = HW.DUSK;
  const hex = (h) => `#${h.toString(16).padStart(6, '0')}`;
  const lit = hex(storm ? D.stormLit : D.cloudLit);
  const body = hex(storm ? D.stormBody : D.cloudBody);
  const base = hex(storm ? D.stormBase : D.cloudShade);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(storm ? 60221 : 5150);
  const grad = g.createLinearGradient(0, 18, 0, 238);
  grad.addColorStop(0, lit);
  grad.addColorStop(0.45, body);
  grad.addColorStop(1, base);
  g.fillStyle = grad;
  const discs = [[128, 138, 74], [84, 152, 52], [172, 152, 52], [106, 104, 54], [150, 100, 48], [128, 168, 62], [62, 168, 38], [194, 168, 38]];
  for (const [x, y, r] of discs) {
    g.beginPath(); g.arc(x + (rng() - 0.5) * 8, y + (rng() - 0.5) * 6, r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(128, 132, 30, 128, 132, 124);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.72, 'rgba(0,0,0,0.92)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  HW[key] = tex;
  return tex;
};

// A cloud mass from baked-lighting sprites: a wide flat-based row with
// domed tops (cumulus anatomy), so the mass has a weather silhouette.
// Sprites always face the camera; the baked gradient keeps the light
// coherent from every staged angle.
HW.cloudMass = function (rng, { storm = false, w = 420, h = 120, n = 16, tint = 0xffffff, opacity = 0.97 } = {}) {
  const tex = HW.cloudTexture(storm);
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const dome = i >= n * 0.55;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity, color: tint, fog: false });
    const sp = new THREE.Sprite(mat);
    const fx = (i + 0.5) / n - 0.5 + (rng() - 0.5) * 0.09;
    sp.position.set(
      fx * w * 0.82,
      dome ? h * (0.30 + rng() * 0.28) : h * (rng() - 0.5) * 0.14,
      (rng() - 0.5) * w * 0.30
    );
    const s = (dome ? 0.62 : 0.78) * h * (0.85 + rng() * 0.5);
    sp.scale.set(s * 1.55, s, 1);
    grp.add(sp);
  }
  return grp;
};

// A rain veil: a translucent curtain with a falling-streak texture,
// hung under a storm cell and slanted with the wind — the shaft that
// makes the cell read as weather between cloud and water.
HW.rainVeilTexture = function () {
  if (HW._veilTexture) return HW._veilTexture;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(8811);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 46; i++) { // gaps between streak bundles
    g.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.4})`;
    g.fillRect(rng() * 128, 0, 1 + rng() * 3, 256);
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  HW._veilTexture = tex;
  return tex;
};

HW.makeRainVeil = function (w, h, repeat) {
  const tex = HW.rainVeilTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(repeat, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.42, color: 0x9fb4c4, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const grp = new THREE.Group();
  for (const ry of [0.35, 0.35 + Math.PI / 2]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.rotation.y = ry;
    grp.add(p);
  }
  grp.rotation.z = 0.10; // the wind slant, matching the rain streaks
  return grp;
};

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

  // A far island on the north-west horizon: pure silhouette, hazed by
  // the distance fog, so the mail run's look direction has a layered
  // background instead of a hard empty horizon. Far outside every
  // course, it never interacts with flight.
  h += 95 * Math.exp(-(((x + 2050) ** 2 + (z + 1350) ** 2) / (520 ** 2)) * 1.7);

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
  // The Rio Verde cuts its channel last, through everything. The carve
  // is deliberately wider than the ribbon (72 m vs 40 m): the terrain
  // mesh resolves ~24 m per vertex, so a narrow cut clips in and out of
  // the ground and the river reads as blue shards from the air. A wide,
  // smooth valley reads as one continuous river.
  const river = riverInfo(x, z);
  if (river.dist < 72 && h > river.level) {
    const t = HW.clamp(1 - river.dist / 72, 0, 1);
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
  // Weather cell over the bay: the one system the pilot has to fly
  // around. Gusts inside it are modelled in flight.js; here it is the
  // dark cloud mass + rain the screenshots show.
  HW.WEATHER = { x: 1000, z: 1300, r: 380, y0: 55, y1: 300 };

  if (h < 1.6) { r = 0.85; g = 0.75; b = 0.54; }                       // sand
  else if (slope > 0.55) { r = 0.54; g = 0.49; b = 0.44; }             // bare rock
  else if (n > 0.12) { r = 0.15; g = 0.40; b = 0.19; }                 // forest
  else { r = 0.30; g = 0.60; b = 0.27; }                               // grass
  // Sandy banks along the Rio Verde, so the channel reads as a river
  // valley from the air instead of a crack in the hillside.
  if (h > 2 && HW.riverDist(x, z) < 85) {
    const t = HW.clamp(1 - HW.riverDist(x, z) / 85, 0, 0.55);
    r = HW.lerp(r, 0.78, t); g = HW.lerp(g, 0.68, t); b = HW.lerp(b, 0.47, t);
  }
  if (dv < G.volcano.r * 1.02 && h > 60) {                             // ash field
    const t = HW.clamp((h - 60) / 200, 0, 0.65) * (0.75 + 0.25 * n);
    r = HW.lerp(r, 0.46, t); g = HW.lerp(g, 0.44, t); b = HW.lerp(b, 0.42, t);
  }
  if (h > 430) { r = 0.95; g = 0.94; b = 0.92; }                        // snow cap
  return [r, g, b];
}

/* --------------------- procedural surface textures --------------------- */
// v2.2 materials pass: the field's flat-colour gap (analysis gap 3) is
// closed with small canvas textures, all drawn from seeded RNGs so the
// world is byte-identical on every run.

// Open water: a deep teal base with soft wave streaks and speckle,
// tiled across the sea disc so the surface has grain at cockpit range
// and a sheen pattern from altitude.
HW.seaTexture = function () {
  if (HW._seaTexture) return HW._seaTexture;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(60221);
  g.fillStyle = '#155e7c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) { // wave streaks
    const y = rng() * 512, x = rng() * 512, len = 22 + rng() * 70;
    g.strokeStyle = `rgba(${170 + Math.floor(rng() * 60)},${225 + Math.floor(rng() * 30)},240,${0.05 + rng() * 0.10})`;
    g.lineWidth = 1.4 + rng() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y + (rng() - 0.5) * 7, x + len, y);
    g.stroke();
  }
  for (let i = 0; i < 150; i++) { // darker troughs
    const y = rng() * 512, x = rng() * 512, len = 30 + rng() * 80;
    g.strokeStyle = `rgba(6,40,58,${0.05 + rng() * 0.09})`;
    g.lineWidth = 2 + rng() * 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (rng() - 0.5) * 5); g.stroke();
  }
  for (let i = 0; i < 900; i++) { // sparkle speckle
    g.fillStyle = `rgba(230,248,255,${0.04 + rng() * 0.08})`;
    g.fillRect(rng() * 512, rng() * 512, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(110, 110);
  HW._seaTexture = tex;
  return tex;
};

// Foam: irregular white blotches on transparency — shore rings, wakes.
HW.foamTexture = function () {
  if (HW._foamTexture) return HW._foamTexture;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(9182);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 240; i++) {
    const x = rng() * 256, y = rng() * 256, r = 2 + rng() * 9;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(250,253,250,${0.25 + rng() * 0.4})`);
    grad.addColorStop(1, 'rgba(250,253,250,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  HW._foamTexture = tex;
  return tex;
};

// Smoke puff: a blotchy radial sprite, grey-warm — layered sprites of
// this read as a smoke column; the old round dot read as a gradient.
HW.smokeTexture = function () {
  if (HW._smokeTexture) return HW._smokeTexture;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(4141);
  // A dense soft core first — blotches alone left the sprite too faint
  // to read against a bright sky (the first v2.2 cockpit render had a
  // full smoke system that simply did not show).
  const core = g.createRadialGradient(64, 64, 4, 64, 64, 61);
  core.addColorStop(0, 'rgba(255,255,255,0.88)');
  core.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 22; i++) { // blotches break the silhouette
    const a = rng() * Math.PI * 2, d = 18 + rng() * 30;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 12 + rng() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${0.12 + rng() * 0.14})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  HW._smokeTexture = new THREE.CanvasTexture(cv);
  return HW._smokeTexture;
};

// Plaster-and-windows facade: near-white so each building's material
// colour tints it; a window grid, a door, grime at the foot. One
// texture for the whole town — flat coloured boxes were the landing
// frame's plainest surface.
HW.buildingTexture = function () {
  if (HW._buildingTexture) return HW._buildingTexture;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(1207);
  g.fillStyle = '#f2ede1';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(90,80,60,${0.03 + rng() * 0.05})`;
    g.fillRect(rng() * 256, rng() * 256, 2, 2);
  }
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 22 + col * 56, y = 24 + row * 52;
      const lit = rng() < 0.22;
      g.fillStyle = lit ? '#ffd98a' : '#2c3e4a';
      g.fillRect(x, y, 30, 34);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x, y, 30, 5);
      g.strokeStyle = '#cabfa8';
      g.lineWidth = 3;
      g.strokeRect(x, y, 30, 34);
    }
  }
  g.fillStyle = '#4a3a2c'; // door
  g.fillRect(112, 218, 32, 38);
  const grad = g.createLinearGradient(0, 210, 0, 256);
  grad.addColorStop(0, 'rgba(80,66,44,0)');
  grad.addColorStop(1, 'rgba(80,66,44,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 210, 256, 46);
  HW._buildingTexture = new THREE.CanvasTexture(cv);
  return HW._buildingTexture;
};

// Crop rows: light stripes over transparency-free white, tinted per
// field by the material colour — ploughed/furrowed detail at altitude.
HW.fieldTexture = function () {
  if (HW._fieldTexture) return HW._fieldTexture;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const rng = HW.makeRng(7331);
  g.fillStyle = '#f4f1e6';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = 'rgba(70,58,36,0.16)';
    g.fillRect(0, y, 256, 6);
    g.fillStyle = 'rgba(255,255,255,0.20)';
    g.fillRect(0, y + 8, 256, 3);
  }
  for (let i = 0; i < 380; i++) {
    g.fillStyle = `rgba(80,70,44,${0.03 + rng() * 0.05})`;
    g.fillRect(rng() * 256, rng() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  HW._fieldTexture = tex;
  return tex;
};

HW.buildWorld = function (scene) {
  const G = HW.GEO;
  const world = { animated: [] };

  // Sky dome: a shader gradient from the DUSK palette — indigo zenith,
  // violet band, peach horizon — plus the sun's disc and a wide glow
  // around it (cortiz SkyDome pattern). v2.2's vertex-coloured dome
  // graded pale grey at the top of the frame; the shader holds the
  // saturation the leaders' dusk has, and the fog colour is the same
  // palette's horizon, so far terrain melts into this sky.
  {
    const D = HW.DUSK;
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(D.zenith) },
        uMid: { value: new THREE.Color(D.mid) },
        uHorizon: { value: new THREE.Color(D.horizon) },
        uGlow: { value: new THREE.Color(D.sunGlow) },
        uCore: { value: new THREE.Color(D.sunCore) },
        uSunDir: { value: HW.SUN_DIR },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenith, uMid, uHorizon, uGlow, uCore, uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.30, h));
          col = mix(col, uZenith, smoothstep(0.24, 0.62, h));
          col = mix(col, uHorizon * 0.9, smoothstep(0.02, -0.25, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += uGlow * (pow(s, 5.0) * 0.36 + pow(s, 24.0) * 0.5);
          col += uCore * smoothstep(0.99955, 0.99985, s) * 1.3;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6800, 32, 16), skyMat);
    scene.add(sky);
  }

  // Terrain heightfield.
  {
    const SIZE = 4600, SEG = 192;
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

  // Sea: v2.3 replaces the tiled wave texture with the cel-Voronoi
  // water shader (HW.waterMaterial) — faceted cells in the palette's
  // deep/mid/glint ramp, foam computed from the heightmap at every
  // shoreline. The old texture read as printed grain at cockpit range.
  {
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(6600, 48),
      HW.waterMaterial()
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    scene.add(sea);
    world.sea = sea;

    // Shore foam: broken white rings where land meets water — they
    // draw the coastline at thumbnail size and give the water an edge.
    const foamRing = (x, z, rIn, rOut, op) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(rIn, rOut, 40),
        new THREE.MeshBasicMaterial({ map: HW.foamTexture(), transparent: true, opacity: op, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.22, z);
      m.renderOrder = 1;
      scene.add(m);
    };
    foamRing(G.gullRock.x, G.gullRock.z, 150, 240, 0.55);
    foamRing(G.palma.x, G.palma.z, 400, 660, 0.38);
    foamRing(G.bay.x - 340, G.bay.z - 130, 60, 200, 0.32);

    // Sun-glint sparkles: four-point stars seeded over the open water
    // on the sun side — the bay, the Palma channel, the harbour mouth.
    // A glitter field is the cheapest "sunset harbour" signal there
    // is; positions are seeded, the phase never moves, so staged
    // shots stay byte-stable.
    const spRng = HW.makeRng(24601);
    const spPos = [];
    for (let i = 0; i < 900 && spPos.length < 240; i++) {
      const x = 350 + spRng() * 2100, z = 500 + spRng() * 1900;
      if (HW.heightAt(x, z) > -1.5) continue;
      spPos.push(x, 0.35, z);
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spPos), 3));
    const sparkles = new THREE.Points(spGeo, new THREE.PointsMaterial({
      size: 6.5, map: HW.starTexture(), color: HW.DUSK.waterHi, transparent: true, opacity: 0.8,
      sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(sparkles);
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
      const y = HW.riverLevelAt(t) + 1.4, w = 20;
      verts.push(x - nx * w, y, z - nz * w, x + nx * w, y, z + nz * w);
      if (i < STEPS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // The same cel water as the sea: world-anchored cells run down the
    // channel and the heightmap foam collars both banks, so the river
    // stops reading as a plain blue ribbon at dusk.
    scene.add(new THREE.Mesh(geo, HW.waterMaterial()));
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
      // The facade texture (windows, door, grime) is near-white, so the
      // per-building colour still tints each house its own shade.
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: HW.buildingTexture(), color, roughness: 0.9 }));
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
  // v2.1 rebuild — the v2 hull was one plain box, so from the cockpit it
  // read as a grey box on a flat blue slab: the top face was all the eye
  // saw. Now she has a tapered bow, a wood deck with gunwale rails, a
  // white waterline stripe, a cabin with dark windows and a roof, a mast
  // with boom, rigging and a red flag, crates and a life ring on deck,
  // and a foam wake ring at the waterline, so she reads as a fishing
  // boat at small size instead of a crate on a raft.
  {
    const boat = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb03a26, roughness: 0.6 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2f3a, roughness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 1 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 16), hullMat);
    hull.position.set(0, 0.6, -2);
    boat.add(hull);
    // Bow: a four-sided cone lying along +Z, point forward, flattened
    // so its diamond section meets the hull's 8 m beam and 3.2 m depth.
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 4.2, 10, 4), hullMat);
    bow.rotation.x = Math.PI / 2;
    bow.scale.set(1, 1, 0.42);
    bow.position.set(0, 0.6, 11);
    boat.add(bow);
    // Deck, gunwale rails and a white waterline stripe down each flank.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.35, 15), deckMat);
    deck.position.set(0, 2.15, -2);
    boat.add(deck);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 15.5), creamMat);
      rail.position.set(sx * 3.9, 2.3, -2);
      boat.add(rail);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 15.5), new THREE.MeshStandardMaterial({ color: 0xf5f2e6, roughness: 0.8 }));
      stripe.position.set(sx * 4.05, 0.1, -2);
      boat.add(stripe);
    }
    // Cabin with dark window strips, a white roof and a life ring.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 3.6, 7), creamMat);
    cabin.position.set(0, 3.6, -3);
    boat.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.35, 7.4), creamMat);
    roof.position.set(0, 5.55, -3);
    boat.add(roof);
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 5), darkMat);
      win.position.set(sx * 3.05, 4.2, -3);
      boat.add(win);
    }
    const winFront = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, 0.12), darkMat);
    winFront.position.set(0, 4.2, -6.56);
    boat.add(winFront);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.28, 8, 16), new THREE.MeshStandardMaterial({ color: 0xe8762c, roughness: 0.6 }));
    ring.position.set(-3.1, 4.0, -3); // port side: the side the cockpit camera sees
    ring.rotation.y = Math.PI / 2;
    boat.add(ring);
    // Crates on the foredeck.
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 1 });
    for (const [cx, cz, s] of [[2, 2, 1.6], [-2.2, 0.5, 1.3]]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.75, s), crateMat);
      crate.position.set(cx, 2.7, cz);
      boat.add(crate);
    }
    // Mast with a boom aft, standing rigging to bow and stern, and a
    // small red flag at the masthead — the stick that read as a bare
    // pole now reads as a mast.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 13), woodMat);
    mast.position.set(0, 7.5, 4);
    mast.rotation.z = 0.16;
    boat.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 9, 6), woodMat);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 5.2, -0.5);
    boat.add(boom);
    const rig = (from, to) => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 4), darkMat);
      line.position.copy(from).addScaledVector(dir, 0.5);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      boat.add(line);
    };
    rig(new THREE.Vector3(0.9, 13.6, 4.4), new THREE.Vector3(0, 1.6, 15.5));
    rig(new THREE.Vector3(0.9, 13.6, 4.4), new THREE.Vector3(0, 2.6, -10));
    // A small red flag at the masthead, turned to face the port side
    // (the side the cockpit camera sees) so it reads as a flag, not a
    // hidden edge-on sliver.
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.0),
      new THREE.MeshBasicMaterial({ color: 0xc23b2a, side: THREE.DoubleSide })
    );
    flag.position.set(-0.2, 13.4, 4.5);
    flag.rotation.y = Math.PI / 2;
    boat.add(flag);
    // Foam wake ring at the waterline, so the hull sits IN the sea
    // instead of floating on a flat slab of it.
    const wake = new THREE.Mesh(
      new THREE.RingGeometry(6.8, 8.6, 28),
      new THREE.MeshBasicMaterial({ color: 0xf5f2e6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    wake.rotation.x = -Math.PI / 2;
    wake.scale.set(0.75, 1.9, 1);
    wake.position.set(0, 0.25, 1);
    boat.add(wake);
    for (const [bx, bz] of [[2.5, 14.5], [-2.5, 14.5]]) {
      const foam = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf5f2e6, transparent: true, opacity: 0.5, depthWrite: false }));
      foam.scale.set(1, 0.35, 1);
      foam.position.set(bx, 0.3, bz);
      boat.add(foam);
    }
    boat.position.set(G.boat.x, 0.3, G.boat.z);
    // Yaw -0.785 puts her broad side to the north-west — the direction
    // the rescue aircraft approaches from, and the cockpit camera's side —
    // so the frame sees the full red hull, deck and bow instead of the
    // stern-on cabin that filled the v2.1 first attempt. (At yaw 0.7 the
    // camera looked straight at her stern and the cabin hid the hull.)
    boat.rotation.set(0.1, -0.785, 0.13);
    boat.scale.setScalar(1.3);
    scene.add(boat);
    world.rescueBoat = boat;

    // A foam wake trailing off her stern: she was under way when she
    // struck. A flat foam-textured sheet in a yaw-aligned group.
    const wakeGrp = new THREE.Group();
    wakeGrp.position.set(G.boat.x, 0.18, G.boat.z);
    wakeGrp.rotation.y = -0.785;
    const wakeTrail = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 36),
      new THREE.MeshBasicMaterial({ map: HW.foamTexture(), transparent: true, opacity: 0.5, depthWrite: false })
    );
    wakeTrail.rotation.x = -Math.PI / 2;
    wakeTrail.position.set(0, 0, 24);
    wakeTrail.renderOrder = 1;
    wakeGrp.add(wakeTrail);
    scene.add(wakeGrp);

    // Smoke, v2.2: eighteen layered sprites with a blotchy puff
    // texture instead of one Points cloud of round dots — the dot
    // column read as a flat orange gradient in the cockpit frame.
    // Young puffs burn orange at the deck, then cool through grey.
    const smokeTex = HW.smokeTexture();
    const puffs = [];
    const SN = 18;
    for (let i = 0; i < SN; i++) {
      const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      scene.add(sp);
      puffs.push(sp);
    }
    world.animated.push((t) => {
      for (let i = 0; i < SN; i++) {
        const life = ((t * 0.14 + i / SN) % 1);
        const sp = puffs[i];
        sp.position.set(
          G.boat.x + Math.sin(life * 9 + i) * 6 * life + life * 22,
          5 + life * 74,
          G.boat.z + Math.cos(life * 7 + i * 2) * 5 * life
        );
        const s = 9 + life * 38;
        sp.scale.set(s, s, 1);
        sp.material.rotation = life * 1.4 + i;
        sp.material.opacity = 0.9 * (1 - life * 0.55);
        sp.material.color.setHex(life < 0.16 ? 0xe86a1e : life < 0.5 ? 0x6e675c : 0x9a9284);
      }
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
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8d2c6, size: 42, map: HW.dotTexture(), transparent: true, opacity: 0.4, sizeAttenuation: true, depthWrite: false, alphaTest: 0.02 }));
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
    for (let i = 0; i < 4200 && spots.length < 1100; i++) {
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
    // v2.2: clustered groves along the mail corridor and the island
    // interior. The uniform scatter read as sparse identical cones from
    // the cover camera; real country clumps — dense woods with gaps.
    const groves = [[-420, 520], [-260, 800], [-650, 90], [-80, 1180], [320, 320], [-920, 480], [-1080, -80], [-560, -420]];
    for (const [cx, cz] of groves) {
      for (let i = 0; i < 30; i++) {
        const x = cx + (rng() - 0.5) * 280, z = cz + (rng() - 0.5) * 280;
        const h = HW.heightAt(x, z);
        if (h < 3 || h > 210) continue;
        if (Math.hypot(x - G.volcano.x, z - G.volcano.z) < 860) continue;
        if (HW.riverDist(x, z) < 40) continue;
        if (x > -10 && x < 600 && z > 580 && z < 1620) continue;
        const slope = Math.abs(HW.heightAt(x + 8, z) - h) + Math.abs(HW.heightAt(x, z + 8) - h);
        if (slope > 7) continue;
        spots.push([x, h, z]);
      }
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
    // A second, smaller cone tier stacked on each pine: the silhouette
    // becomes a tree instead of an ice-cream cone.
    const tierGeo = new THREE.ConeGeometry(2.0, 6.8, 7);
    const tiers = new THREE.InstancedMesh(tierGeo, coneMat.clone(), spots.length);
    spots.forEach(([x, h, z], i) => {
      cones.getMatrixAt(i, m4);
      const p = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
      m4.decompose(p, qq, ss);
      m4.compose(new THREE.Vector3(x, p.y + 4.6 * ss.y, z), qq, ss);
      tiers.setMatrixAt(i, m4);
      tiers.setColorAt(i, greens[Math.floor(rng() * greens.length)]);
    });
    tiers.castShadow = true;
    scene.add(tiers);
    // Bushes: squashed dark shrubs scattered through the near country —
    // they fill the ground plane between fields, road and shore.
    const bushSpots = [];
    for (let i = 0; i < 2600 && bushSpots.length < 380; i++) {
      const x = -800 + rng() * 1500, z = -300 + rng() * 2000;
      const h = HW.heightAt(x, z);
      if (h < 3 || h > 45) continue;
      if (HW.riverDist(x, z) < 30) continue;
      if (x > 20 && x < 280 && z > 730 && z < 1340) continue; // town
      if (x > 295 && x < 415 && z > 945 && z < 1165) continue; // debrief apron + camera
      if (Math.abs(x - G.runway.x) < 45 && z > 640 && z < 1400) continue; // strip
      bushSpots.push([x, h, z]);
    }
    const bushGeo = new THREE.IcosahedronGeometry(2.3, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushSpots.length);
    const bushGreens = [new THREE.Color(0x2f6633), new THREE.Color(0x406f2e), new THREE.Color(0x55702f), new THREE.Color(0x6b7a35)];
    bushSpots.forEach(([x, h, z], i) => {
      const s = 0.7 + rng() * 1.1;
      sc.set(s, s * 0.55, s);
      q.setFromAxisAngle(pv.set(0, 1, 0), rng() * Math.PI);
      m4.compose(new THREE.Vector3(x, h + 0.7 * s, z), q, sc);
      bushes.setMatrixAt(i, m4);
      bushes.setColorAt(i, bushGreens[Math.floor(rng() * bushGreens.length)]);
    });
    bushes.castShadow = true;
    scene.add(bushes);

    // Patchwork fields: the flat shelf first, then the island interior
    // along the mail corridor — the cover frame's lower half was bare
    // grass in v2.1; now it is farmed country in five tints, each plot
    // carrying the crop-row texture.
    const fieldColors = [0xc9a94e, 0x8fae4c, 0x9a7350, 0xb5bf62, 0xa8a35e];
    const addField = (gx, gz, h) => {
      const w = 44 + rng() * 28, d = 44 + rng() * 28;
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ map: HW.fieldTexture(), color: fieldColors[Math.floor(rng() * fieldColors.length)], roughness: 1 })
      );
      f.rotation.x = -Math.PI / 2;
      f.rotation.z = (rng() - 0.5) * 0.14;
      f.position.set(gx, h + 0.3, gz);
      f.receiveShadow = true;
      scene.add(f);
    };
    let placed = 0;
    for (let gx = 30; gx < 560 && placed < 20; gx += 58) {
      for (let gz = 640; gz < 1450 && placed < 20; gz += 58) {
        if (gx > 20 && gx < 270 && gz > 740 && gz < 1330) continue;   // town
        if (Math.abs(gx - G.runway.x) < 70 && gz > 620 && gz < 1420) continue; // strip
        const h = HW.heightAt(gx, gz);
        if (h < 4 || h > 20) continue;
        const flat = Math.abs(HW.heightAt(gx + 22, gz) - h) + Math.abs(HW.heightAt(gx, gz + 22) - h);
        if (flat > 1.6) continue;
        addField(gx, gz, h);
        placed += 1;
      }
    }
    let placedIn = 0;
    for (let gx = -880; gx < -120 && placedIn < 16; gx += 62) {
      for (let gz = -60; gz < 720 && placedIn < 16; gz += 62) {
        if (HW.riverDist(gx, gz) < 58) continue;
        const h = HW.heightAt(gx, gz);
        if (h < 4 || h > 60) continue;
        const flat = Math.abs(HW.heightAt(gx + 22, gz) - h) + Math.abs(HW.heightAt(gx, gz + 22) - h);
        if (flat > 4.5) continue;
        addField(gx, gz, h);
        placedIn += 1;
      }
    }
    // Large plots on the high rolling country the cover flies over,
    // west of the river. That ground is 80–110 m up and sloped, so a
    // flat plane would bury or float — these are DRAPED fields: a
    // segmented plane whose every vertex is snapped to the terrain,
    // rotation baked into the sampling so the patch hugs the hillside.
    const addDrapedField = (fx, fz, w, d) => {
      const geo = new THREE.PlaneGeometry(w, d, 10, 10);
      geo.rotateX(-Math.PI / 2);
      const rot = (rng() - 0.5) * 0.3;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const posA = geo.attributes.position;
      const hc = HW.heightAt(fx, fz);
      for (let vi = 0; vi < posA.count; vi++) {
        const lx = posA.getX(vi), lz = posA.getZ(vi);
        const rx = lx * cosR - lz * sinR, rz = lx * sinR + lz * cosR;
        posA.setX(vi, rx);
        posA.setZ(vi, rz);
        posA.setY(vi, HW.heightAt(fx + rx, fz + rz) - hc + 0.4);
      }
      geo.computeVertexNormals();
      const f = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: HW.fieldTexture(), color: fieldColors[Math.floor(rng() * fieldColors.length)], roughness: 1 }));
      f.position.set(fx, hc, fz);
      f.receiveShadow = true;
      scene.add(f);
    };
    for (const [fx, fz] of [[-330, 570], [-175, 665], [-440, 380], [-480, 260]]) {
      if (HW.riverDist(fx, fz) < 78) continue;
      addDrapedField(fx, fz, 92 + rng() * 30, 78 + rng() * 26);
    }
  }

  // Boulders on the slopes and along the shore: grey punctuation that
  // breaks up the green at altitude and gives the coast a hard edge.
  {
    const rng = HW.makeRng(9182);
    const spots = [];
    for (let i = 0; i < 900 && spots.length < 150; i++) {
      const x = (rng() - 0.5) * 4200, z = (rng() - 0.5) * 4200;
      const h = HW.heightAt(x, z);
      if (h < 2 || h > 320) continue;
      if (Math.hypot(x - G.volcano.x, z - G.volcano.z) < 500) continue;
      if (x > -10 && x < 600 && z > 580 && z < 1620) continue; // shelf + approach
      const slope = Math.abs(HW.heightAt(x + 8, z) - h) + Math.abs(HW.heightAt(x, z + 8) - h);
      if (slope < 2.5 && rng() < 0.7) continue; // rocks cluster on rough ground
      spots.push([x, h, z]);
    }
    const rockGeo = new THREE.DodecahedronGeometry(3.2, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    spots.forEach(([x, h, z], i) => {
      const s = 0.6 + rng() * 1.7;
      sc.set(s, s * 0.75, s);
      q.setFromEuler(new THREE.Euler(rng() * 0.6, rng() * Math.PI, rng() * 0.6));
      m4.compose(new THREE.Vector3(x, h + 0.6 * s, z), q, sc);
      rocks.setMatrixAt(i, m4);
    });
    rocks.castShadow = true;
    scene.add(rocks);
  }

  // The Rio Verde bridge: a timber road bridge where the shore road
  // crosses the river south of town — the river's landmark crossing.
  {
    const by = HW.riverLevelAt(0.75) + 8;
    const grp = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 1 });
    // The deck's long axis is perpendicular to the river's flow here
    // (flow direction ≈ (0.61, 0.78)): rotation.y = atan2(0.61, 0.78)
    // maps local X to (0.79, -0.62), whose dot with the flow is ~0.
    const deckAngle = Math.atan2(0.61, 0.78);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(86, 1.4, 9), wood);
    deck.position.set(60, by, 620);
    deck.rotation.y = deckAngle;
    deck.castShadow = true; deck.receiveShadow = true;
    grp.add(deck);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 1 });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(86, 1.1, 0.5), railMat);
      rail.position.set(60, by + 1.1, 620);
      rail.rotation.y = deck.rotation.y;
      rail.translateZ(s * 4.2);
      grp.add(rail);
    }
    // Stone piers under the deck ends, placed along the deck's own axis.
    const dirX = Math.cos(deckAngle), dirZ = -Math.sin(deckAngle);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 12, 8), new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 }));
      post.position.set(60 + dirX * s * 26, by - 5, 620 + dirZ * s * 26);
      grp.add(post);
    }
    scene.add(grp);
  }

  // Palma Isle settlement: three cottages and a working windmill on the
  // far island, so the horizon has a second inhabited place, not just
  // empty sea. The sails turn with the world clock.
  {
    const grp = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xa35d3f, roughness: 1 });
    const cottages = [[1380, 380], [1470, 520], [1520, 360]];
    for (const [x, z] of cottages) {
      const y = HW.heightAt(x, z);
      const b = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 12), wallMat);
      b.position.set(x, y + 3.1, z);
      b.castShadow = true;
      grp.add(b);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(10.5, 5, 4), roofMat);
      roof.position.set(x, y + 9, z);
      roof.rotation.y = Math.PI / 4;
      grp.add(roof);
    }
    const my = HW.heightAt(1450, 450);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 22, 10), new THREE.MeshStandardMaterial({ color: 0xf0e9d8, roughness: 0.9 }));
    tower.position.set(1450, my + 11, 450);
    tower.castShadow = true;
    grp.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4, 4.5, 10), roofMat);
    cap.position.set(1450, my + 24, 450);
    grp.add(cap);
    const sails = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13, 0.3), new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.9 }));
      blade.position.y = 7.5;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      sails.add(arm);
    }
    sails.position.set(1450, my + 21, 445.4);
    grp.add(sails);
    scene.add(grp);
    world.animated.push((t) => { sails.rotation.z = t * 0.55; });
  }

  // Gull Rock keeper's cottage beside the lighthouse.
  {
    const y = HW.heightAt(478, 1440);
    const cottage = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }));
    b.position.set(478, y + 2.6, 1440);
    b.castShadow = true;
    cottage.add(b);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9, 4.5, 4), new THREE.MeshStandardMaterial({ color: 0x8a4f35, roughness: 1 }));
    roof.position.set(478, y + 7.8, 1440);
    roof.rotation.y = Math.PI / 4;
    cottage.add(roof);
    scene.add(cottage);
  }

  // The weather cell: a dark cloud mass over the bay with rain falling
  // beneath it — the one visible system in the sky, and the reason the
  // cockpit shot has weather in it instead of empty blue. The cell sits
  // LOW (centre y 270): from a floatplane at 20 m the clouds must hang
  // near the horizon to be in frame at all, and the rain must fall to
  // the water to streak through the cockpit view. A skirt of lower
  // puffs on the cell's south-east edge puts dark cloud in the top of
  // the rescue frame.
  {
    const W = HW.WEATHER;
    const rng = HW.makeRng(31337);
    // v2.3: the cell is a mass of baked-lighting cloud sprites — flat
    // base, domed tops, warm-lit crowns over a shaded storm base —
    // replacing the flat dark sphere cluster that read as one blob.
    // A lower skirt on the south-east edge keeps cloud in the top of
    // the rescue frame, as before.
    const cell = HW.cloudMass(rng, { storm: true, w: 470, h: 135, n: 20 });
    cell.position.set(W.x, 268, W.z);
    scene.add(cell);
    const skirt = HW.cloudMass(rng, { storm: true, w: 240, h: 80, n: 7 });
    skirt.position.set(W.x + 130, 188, W.z + 110);
    scene.add(skirt);

    // Rain: long, bright, slightly slanted streaks falling inside a
    // cylinder under the cloud. v2.1: 1500 drops (was 520), 13 m long
    // (was 7), opacity 0.55 (was 0.38) — the v2 rain read as a few faint
    // white scratches. Positions are a pure function of the world clock,
    // so a frozen staged shot is deterministic.
    const N = 1500, posArr = new Float32Array(N * 6);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xd8e8f2, transparent: true, opacity: 0.55 }));
    scene.add(rain);
    const drops = [];
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * 330;
      drops.push([W.x + Math.cos(a) * rad, W.z + Math.sin(a) * rad, rng() * 265]);
    }
    world.animated.push((t) => {
      for (let i = 0; i < N; i++) {
        const [dx, dz, off] = drops[i];
        const y = 270 - ((t * 60 + off) % 265);
        posArr[i * 6] = dx; posArr[i * 6 + 1] = y; posArr[i * 6 + 2] = dz;
        posArr[i * 6 + 3] = dx - 2.5; posArr[i * 6 + 4] = y - 13; posArr[i * 6 + 5] = dz + 1.5;
      }
      rainGeo.attributes.position.needsUpdate = true;
    });

    // The rain shaft made visible: slanted veils under the cell, and
    // rain rings stippling the water below — cloud + shaft + rings
    // together sell "storm"; the cloud alone never did.
    const veil = HW.makeRainVeil(600, 240, 3);
    veil.position.set(W.x, 148, W.z);
    scene.add(veil);
    {
      const ringTex = HW.rainRingTexture();
      const rings = [];
      const rrng = HW.makeRng(1357);
      for (let i = 0; i < 44; i++) {
        const a = rrng() * Math.PI * 2, rad = Math.sqrt(rrng()) * 320;
        const x = W.x + Math.cos(a) * rad, z = W.z + Math.sin(a) * rad;
        if (HW.heightAt(x, z) > -1) continue;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, color: 0xdcebf2 })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.3, z);
        m.renderOrder = 2;
        m.userData.base = 5 + rrng() * 11;
        m.userData.phase = rrng();
        scene.add(m);
        rings.push(m);
      }
      world.animated.push((t) => {
        for (const m of rings) {
          const ph = (t * 0.45 + m.userData.phase) % 1;
          const s = m.userData.base * (0.35 + ph);
          m.scale.set(s, s, 1);
          m.material.opacity = 0.5 * (1 - ph);
        }
      });
    }

    // A second, smaller squall over the Rio Verde valley to the
    // north-west: the mail-run cover looks north-west, away from the bay
    // cell, so without it the cover frame has no weather in it at all.
    // Visual only (no gusts — HW.WEATHER, the gameplay cell, is untouched):
    // a baked-lighting cloud mass plus its own rain shaft falling to
    // the valley, placed so it reads in the cover's top third without
    // covering the ring, the volcano or the river.
    const NW = { x: -520, z: 420 };
    const nwRng = HW.makeRng(5150);
    const nwCell = HW.cloudMass(nwRng, { storm: true, w: 400, h: 110, n: 15 });
    nwCell.position.set(NW.x, 298, NW.z);
    scene.add(nwCell);
    const nwVeil = HW.makeRainVeil(430, 215, 2);
    nwVeil.position.set(NW.x, 190, NW.z);
    scene.add(nwVeil);
    const NWN = 320, nwPos = new Float32Array(NWN * 6);
    const nwRainGeo = new THREE.BufferGeometry();
    nwRainGeo.setAttribute('position', new THREE.BufferAttribute(nwPos, 3));
    const nwRain = new THREE.LineSegments(nwRainGeo, new THREE.LineBasicMaterial({ color: 0xd8e8f2, transparent: true, opacity: 0.5 }));
    scene.add(nwRain);
    const nwDrops = [];
    for (let i = 0; i < NWN; i++) {
      const a = nwRng() * Math.PI * 2, rad = Math.sqrt(nwRng()) * 210;
      nwDrops.push([NW.x + Math.cos(a) * rad, NW.z + Math.sin(a) * rad, nwRng() * 250]);
    }
    world.animated.push((t) => {
      for (let i = 0; i < NWN; i++) {
        const [dx, dz, off] = nwDrops[i];
        const y = 295 - ((t * 60 + off) % 250);
        nwPos[i * 6] = dx; nwPos[i * 6 + 1] = y; nwPos[i * 6 + 2] = dz;
        nwPos[i * 6 + 3] = dx - 2.5; nwPos[i * 6 + 4] = y - 12; nwPos[i * 6 + 5] = dz + 1.5;
      }
      nwRainGeo.attributes.position.needsUpdate = true;
    });

    // A low dark bank on the south-east horizon, in the rescue frame's
    // look direction: the cockpit shot looks south-east, away from the
    // bay cell's high cloud, so its sky was empty pale blue. These puffs
    // hang at y ~70 over the open sea east of Gull Rock — low enough to
    // sit in the frame above the boat, high enough to stay out of the
    // landing and debrief frames (both look north-west).
    const seRng = HW.makeRng(7771);
    // v2.3: baked-lighting storm sprites instead of flat dark spheres —
    // the bank hangs low in the rescue frame, so its lit tops and
    // shaded bases are what the cockpit camera actually reads.
    const seBank = HW.cloudMass(seRng, { storm: true, w: 520, h: 95, n: 12 });
    seBank.position.set(1400, 78, 1750);
    scene.add(seBank);
  }

  // The valley road: a dirt ribbon from Port Azure's west edge over
  // the Rio Verde bridge and up the valley — built like the river
  // ribbon, draped on the terrain. It gives the cover frame a leading
  // line through its lower half, which was bare grass in v2.1.
  {
    const roadRaw = [[255, 815], [150, 700], [60, 620], [-95, 545], [-215, 445], [-330, 320], [-480, 150]];
    // Resample to ~22 m steps: with only the corner points the ribbon
    // chorded straight across the rolling ground and buried itself
    // between them — it never showed in the first v2.2 cover render.
    const roadPts = [];
    for (let i = 0; i < roadRaw.length - 1; i++) {
      const [ax, az] = roadRaw[i], [bx, bz] = roadRaw[i + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(segLen / 22));
      for (let sIdx = 0; sIdx < steps; sIdx++) {
        roadPts.push([ax + (bx - ax) * (sIdx / steps), az + (bz - az) * (sIdx / steps)]);
      }
    }
    roadPts.push(roadRaw[roadRaw.length - 1]);
    const verts = [], idx = [];
    roadPts.forEach(([x, z], i) => {
      const [px, pz] = roadPts[Math.max(0, i - 1)];
      const [nx, nz] = roadPts[Math.min(roadPts.length - 1, i + 1)];
      let dx = nx - px, dz = nz - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const ox = -dz * 5.2, oz = dx * 5.2;
      // Vertex order and winding copied from the river ribbon above:
      // my first attempt pushed the +offset vertex first, which flipped
      // every triangle to face DOWN — FrontSide culling made the whole
      // road invisible from the air while it sat in the scene.
      verts.push(x - ox, HW.heightAt(x - ox, z - oz) + 0.35, z - oz, x + ox, HW.heightAt(x + ox, z + oz) + 0.35, z + oz);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a7c52, roughness: 1 }));
    road.receiveShadow = true;
    scene.add(road);
  }

  // Rio Verde hamlet: a fishing hamlet on the river's west bank where
  // the road bends — textured houses, a jetty and a moored boat. It is
  // the mid-frame settlement the cover looks across.
  {
    const rng = HW.makeRng(5150);
    const grp = new THREE.Group();
    const roofCols = [0xa35d3f, 0x74584a, 0x8a4f35];
    const wallCols = [0xe8dcc0, 0xd9c9a8, 0xc7d3a8, 0xe3e0d5];
    const spots = [[-215, 430], [-245, 465], [-205, 500], [-255, 520], [-182, 455], [-232, 555], [-198, 585]];
    for (const [x, z] of spots) {
      const y = HW.heightAt(x, z);
      const w = 9 + rng() * 4, d = 8 + rng() * 4, h = 5 + rng() * 3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: HW.buildingTexture(), color: wallCols[Math.floor(rng() * wallCols.length)], roughness: 0.95 }));
      b.position.set(x, y + h / 2 - 0.3, z);
      b.rotation.y = (rng() - 0.5) * 0.7;
      b.castShadow = true; b.receiveShadow = true;
      grp.add(b);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3.4, 4), new THREE.MeshStandardMaterial({ color: roofCols[Math.floor(rng() * roofCols.length)], roughness: 1 }));
      roof.position.set(x, y + h + 1.4, z);
      roof.rotation.y = Math.PI / 4 + b.rotation.y;
      roof.castShadow = true;
      grp.add(roof);
    }
    // Jetty reaching from the west bank into the river, and a small
    // boat tied alongside in the channel.
    const rl = HW.riverLevelAt(0.8);
    const jetty = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 20), new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 1 }));
    jetty.position.set(-102, rl + 0.8, 472);
    jetty.rotation.y = Math.PI / 2 - 0.15;
    grp.add(jetty);
    const skiff = new THREE.Group();
    const skiffHull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 6.4), new THREE.MeshStandardMaterial({ color: 0x39586e, roughness: 0.8 }));
    skiff.add(skiffHull);
    const skiffBench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.8), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 }));
    skiffBench.position.y = 0.55;
    skiff.add(skiffBench);
    skiff.position.set(-92, rl + 0.3, 486);
    skiff.rotation.y = 0.9;
    grp.add(skiff);
    scene.add(grp);
  }

  // Runway environment and the debrief apron: windsock, PAPI lights,
  // a fence line, fuel drums and crates by the strip, foreground field
  // plots on the approach, and a concrete apron east of the parked
  // aircraft with a fuel cart and cones — the two ground frames stop
  // being a plane beside a mown strip in empty grass.
  {
    const rng = HW.makeRng(31415);
    const grp = new THREE.Group();
    const alt = G.runway.alt;
    // Windsock at the threshold's west side.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8d3c3, roughness: 0.7 }));
    pole.position.set(258, alt + 5, 700);
    pole.castShadow = true;
    grp.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8762c, roughness: 0.9, side: THREE.DoubleSide }));
    sock.rotation.z = Math.PI / 2 - 0.18;
    sock.position.set(260.6, alt + 9.6, 700);
    grp.add(sock);
    // PAPI: four white units west of the threshold, two showing red.
    for (let i = 0; i < 4; i++) {
      const unit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.8 }));
      unit.position.set(264, alt + 0.45, 706 + i * 7);
      grp.add(unit);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: i < 2 ? 0xffffff : 0xff2a1a }));
      lamp.position.set(264, alt + 1.05, 706 + i * 7);
      grp.add(lamp);
    }
    // Fence posts down both sides of the strip.
    const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 5);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6e6250, roughness: 1 });
    const postCount = 30;
    const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    {
      const m4 = new THREE.Matrix4();
      let pi = 0;
      for (const fx of [252, 348]) {
        for (let fz = 700; fz <= 1340; fz += 46) {
          m4.makeTranslation(fx, alt + 1.0, fz);
          posts.setMatrixAt(pi++, m4);
        }
      }
      posts.count = pi;
    }
    grp.add(posts);
    // Drums and crates by the strip's south end.
    const drumCols = [0x39586e, 0xb03a26, 0x8a8578, 0x39586e];
    for (let i = 0; i < 4; i++) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.3, 10), new THREE.MeshStandardMaterial({ color: drumCols[i], roughness: 0.6, metalness: 0.25 }));
      drum.position.set(356 + (i % 2) * 2.6, alt + 1.15, 1332 + Math.floor(i / 2) * 2.6);
      drum.castShadow = true;
      grp.add(drum);
    }
    const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 1 });
    [[352, 1300, 3.4, 0], [356.5, 1301, 3.0, 0], [354, 1300, 2.6, 2.72]].forEach(([x, z, s, lift]) => {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), crateMat2);
      crate.position.set(x, alt + lift + s * 0.4, z);
      crate.castShadow = true;
      grp.add(crate);
    });
    // Foreground field plots under the approach path.
    for (const [fx, fz] of [[180, 1500], [420, 1560], [120, 1585]]) {
      const h = HW.heightAt(fx, fz);
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(64, 54),
        new THREE.MeshStandardMaterial({ map: HW.fieldTexture(), color: [0xc9a94e, 0x8fae4c, 0xb5bf62][Math.floor(rng() * 3)], roughness: 1 })
      );
      f.rotation.x = -Math.PI / 2;
      f.rotation.z = (rng() - 0.5) * 0.2;
      f.position.set(fx, h + 0.3, fz);
      f.receiveShadow = true;
      grp.add(f);
    }
    // The debrief apron: a concrete slab east of the parked aircraft,
    // with cargo and a fuel cart waiting on it.
    const slabY = HW.heightAt(352, 1010);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(52, 0.7, 38), new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.95 }));
    slab.position.set(352, slabY + 0.1, 1010);
    slab.receiveShadow = true;
    grp.add(slab);
    const top = slabY + 0.45;
    [[368, 992], [368, 998], [368, 995]].forEach(([x, z], i) => {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3.2), crateMat2);
      crate.position.set(x, top + 1.3 + (i === 2 ? 2.6 : 0), z);
      crate.castShadow = true;
      grp.add(crate);
    });
    for (let i = 0; i < 3; i++) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.3, 10), new THREE.MeshStandardMaterial({ color: drumCols[i], roughness: 0.6, metalness: 0.25 }));
      drum.position.set(342 + i * 2.6, top + 1.15, 1032);
      drum.castShadow = true;
      grp.add(drum);
    }
    // Fuel cart: tank on a frame with two wheels and a tow bar.
    const cart = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 3.4, 12), new THREE.MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.45, metalness: 0.35 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.y = 1.45;
    cart.add(tank);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 1.7), new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.8 }));
    frame.position.y = 0.65;
    cart.add(frame);
    for (const wx of [-1.2, 1.2]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.9 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.55, 0);
      cart.add(wheel);
    }
    const towbar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.8 }));
    towbar.position.set(-2.8, 0.6, 0);
    towbar.rotation.z = 0.18;
    cart.add(towbar);
    cart.position.set(330, top, 990);
    cart.rotation.y = 0.5;
    cart.traverse((o) => { o.castShadow = true; });
    grp.add(cart);
    // Traffic cones at the apron corners.
    for (const [cx, cz] of [[330, 990], [374, 990], [330, 1032], [374, 1032]]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0xe8762c, roughness: 0.8 }));
      cone.position.set(cx, top + 0.75, cz);
      cone.castShadow = true;
      grp.add(cone);
    }
    scene.add(grp);
  }

  // A low cloud layer over the north-west valley: warm baked-lighting
  // puffs between the mail run and the far island, so the cover's
  // background stacks haze over ridge over island.
  {
    const rng = HW.makeRng(2027);
    const layer = new THREE.Group();
    const spots = [[-1500, 268, -180], [-1150, 285, 160], [-820, 252, 430], [-520, 290, 640], [-1750, 260, 320], [-980, 272, -360]];
    for (const [x, y, z] of spots) {
      const cl = HW.cloudMass(rng, { w: 300, h: 74, n: 6, tint: 0xffe2b8, opacity: 0.6 });
      cl.position.set(x, y, z);
      layer.add(cl);
    }
    scene.add(layer);
  }

  // Fair clouds: baked-lighting sprite masses, drifting slowly east.
  // The v2.2 sphere puffs were unlit white discs — against the new
  // saturated sky they read as stickers; the baked gradient gives
  // them lit crowns and shaded bases like the storm masses.
  {
    const rng = HW.makeRng(777);
    const clouds = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const cl = HW.cloudMass(rng, { w: 170 + rng() * 120, h: 66 + rng() * 30, n: 6, opacity: 0.92 });
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

// A soft radial glow texture: the ring's inner disc and its ground
// anchor share it — white in the middle, gone at the rim, tinted by
// each material's colour and composited additively.
HW.ringGlowTexture = function () {
  if (HW._ringGlowTexture) return HW._ringGlowTexture;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  HW._ringGlowTexture = tex;
  return tex;
};

// A course ring: a glowing torus the pilot threads. `active` pulses.
// v2.3: the torus tube is thicker (1.7 → 2.3 — at 200 m the thin tube
// anti-aliased into the bright sky and read pale), and a soft ADDITIVE
// radial disc fills the hoop so the target has a warm core at range.
// (v2 rejected a fill disc because a flat translucent disc read as a
// solid alien ellipse; additive glow with a rim-faded gradient does
// not — it adds light, not a surface.)
HW.makeRing = function (color) {
  const grp = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(26, 2.3, 10, 44),
    new THREE.MeshBasicMaterial({ color, transparent: true })
  );
  grp.add(torus);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(25, 32),
    new THREE.MeshBasicMaterial({ map: HW.ringGlowTexture(), color, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  grp.add(disc);
  grp.userData.torus = torus;
  grp.userData.disc = disc;
  grp.userData.dying = null; // seconds since threaded; null while live
  return grp;
};

// A tall light pillar marking the active objective — readable from anywhere.
// Kept slim, short and faint: in v1's cover it read as a solid white wall
// through the middle of the frame. The ring itself marks the target.
HW.makeBeacon = function (color) {
  const geo = new THREE.CylinderGeometry(0.55, 1.1, 260, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 130;
  const grp = new THREE.Group();
  grp.add(mesh);
  return grp;
};
