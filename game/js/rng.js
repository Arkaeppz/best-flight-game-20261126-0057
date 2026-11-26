// rng.js — deterministic randomness for Harbor Wings.
// A mulberry32 generator plus a hash-based value-noise field, so the world
// (terrain bumps, town layout, cloud drift) is identical on every load and
// the staged screenshot scenes never change between runs.

window.HW = window.HW || {};

HW.makeRng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Deterministic 2D value noise: hash the integer lattice, smoothstep between.
HW.noise2 = function (x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const h = (a, b) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const top = h(xi, zi) + (h(xi + 1, zi) - h(xi, zi)) * u;
  const bot = h(xi, zi + 1) + (h(xi + 1, zi + 1) - h(xi, zi + 1)) * u;
  return (top + (bot - top) * v) * 2 - 1; // -1..1
};

HW.fbm = function (x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += HW.noise2(x * freq, z * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
};

HW.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
HW.lerp = (a, b, t) => a + (b - a) * t;
