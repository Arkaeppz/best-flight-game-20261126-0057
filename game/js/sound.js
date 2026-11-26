// sound.js — all-synthesised WebAudio: a prop engine that follows throttle,
// wind that follows airspeed, and small honest noises for rings, hoists,
// splashes and thumps. No audio files, nothing loads over the network.
// The context only starts on a user gesture (the mission-select click).

window.HW = window.HW || {};

HW.Sound = {
  ctx: null, engineGain: null, engineOsc: null, engineOsc2: null, windGain: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    // Engine: two detuned oscillators through a lowpass, gain by throttle.
    const eg = this.engineGain = ctx.createGain(); eg.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const o1 = this.engineOsc = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 52;
    const o2 = this.engineOsc2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 26;
    const og2 = ctx.createGain(); og2.gain.value = 0.5;
    o1.connect(lp); o2.connect(og2); og2.connect(lp); lp.connect(eg); eg.connect(ctx.destination);
    o1.start(); o2.start();

    // Wind: looped noise through a bandpass, gain by airspeed.
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 640; bp.Q.value = 0.6;
    const wg = this.windGain = ctx.createGain(); wg.gain.value = 0;
    noise.connect(bp); bp.connect(wg); wg.connect(ctx.destination);
    noise.start();
  },

  setEngine(throttle, speed, running) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = running ? 0.028 + throttle * 0.075 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.12);
    const rpm = 46 + throttle * 74 + speed * 0.35;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.1);
    this.engineOsc2.frequency.setTargetAtTime(rpm / 2, t, 0.1);
    this.windGain.gain.setTargetAtTime(running ? HW.clamp(speed / 44, 0, 1) * 0.05 : 0, t, 0.2);
  },

  blip(freq, dur = 0.16, type = 'sine', vol = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur);
  },

  chime() { this.blip(880, 0.22, 'sine', 0.14); setTimeout(() => this.blip(1318, 0.3, 'sine', 0.12), 70); },
  hoistDing() { this.blip(660, 0.2, 'triangle', 0.14); setTimeout(() => this.blip(990, 0.28, 'triangle', 0.12), 90); },
  thud() { this.blip(74, 0.3, 'sine', 0.3); },
  splash() { this.blip(196, 0.4, 'triangle', 0.1); },
  warn() { this.blip(1174, 0.12, 'square', 0.05); },
};
