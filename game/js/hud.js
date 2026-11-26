// hud.js — the instrument panel: DOM readouts and bars over a canvas gauge
// cluster (airspeed, altimeter, artificial horizon) and a compass strip.
// Everything updates from the flight state each frame; the panel is the
// game's second window into the simulation, and it must never lie.

window.HW = window.HW || {};

HW.HUD = {
  els: {},
  toastUntil: 0,
  stepsSig: '',

  init() {
    const $ = (id) => document.getElementById(id);
    this.els = {
      hud: $('hud'), title: $('mission-title'), objective: $('mission-objective'),
      steps: $('mission-steps'), dist: $('dist-value'),
      score: $('score-value'), time: $('time-value'),
      alt: $('alt-value'), spd: $('spd-value'), hdg: $('hdg-value'), vs: $('vs-value'),
      readouts: $('readouts'),
      thrFill: $('thr-fill'), thrVal: $('thr-value'),
      fuelFill: $('fuel-fill'), fuelVal: $('fuel-value'),
      hullFill: $('hull-fill'), hullVal: $('hull-value'),
      hoistRow: $('hoist-row'), hoistFill: $('hoist-fill'), hoistVal: $('hoist-value'),
      warning: $('warning'), toast: $('toast'),
      compass: $('compass').getContext('2d'), compassHdg: $('compass-hdg'),
      gauges: $('gauge-cluster').getContext('2d'),
    };
  },

  show() { this.els.hud.classList.remove('hidden'); },
  hide() { this.els.hud.classList.add('hidden'); },

  toast(text, seconds = 2.4) {
    this.els.toast.textContent = text;
    this.els.toast.classList.remove('hidden');
    this.toastUntil = performance.now() + seconds * 1000;
  },

  update(state, mission) {
    const e = this.els;
    const altFt = Math.max(0, Math.round(state.pos.y * 3.281));
    const spdKt = Math.round(state.speed * 1.944);
    const vsFpm = Math.round(state.vy * 196.85);
    e.alt.textContent = altFt;
    e.spd.textContent = spdKt;
    e.hdg.textContent = String(Math.round(state.heading) % 360).padStart(3, '0');
    e.vs.textContent = (vsFpm > 0 ? '+' : '') + vsFpm;
    e.compassHdg.textContent = String(Math.round(state.heading) % 360).padStart(3, '0') + '°';

    e.thrFill.style.width = `${Math.round(state.throttle * 100)}%`;
    e.thrVal.textContent = `${Math.round(state.throttle * 100)}%`;
    e.fuelFill.style.width = `${Math.round(state.fuel)}%`;
    e.fuelVal.textContent = Math.round(state.fuel);
    e.fuelFill.classList.toggle('low', state.fuel < 25);
    e.hullFill.style.width = `${Math.round(state.hull)}%`;
    e.hullVal.textContent = Math.round(state.hull);
    e.hullFill.classList.toggle('low', state.hull < 35);

    if (mission) {
      e.title.textContent = mission.title;
      e.objective.textContent = mission.objective;
      e.score.textContent = mission.score;
      const el = Math.floor(mission.elapsed(state));
      e.time.textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
      if (mission.target) {
        const d = Math.round(state.pos.distanceTo(mission.target));
        e.dist.textContent = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`;
      } else e.dist.textContent = '—';
      const sig = mission.steps.map((s) => s.state + s.label).join('|');
      if (sig !== this.stepsSig) {
        this.stepsSig = sig;
        e.steps.innerHTML = mission.steps
          .map((s) => `<li class="${s.state}">${s.label}</li>`).join('');
      }
      if (mission.hoist !== null && mission.hoist !== undefined) {
        e.hoistRow.classList.remove('hidden');
        e.hoistFill.style.width = `${Math.round(mission.hoist * 100)}%`;
        e.hoistVal.textContent = `${Math.round(mission.hoist * 100)}%`;
      } else e.hoistRow.classList.add('hidden');
      if (mission.event) { this.toast(mission.event); mission.event = null; }
    }

    // Warnings, in priority order.
    let warn = '';
    if (state.crashed) warn = 'CRASHED';
    else if (state.stalled) warn = 'STALL';
    else if (mission && mission.ashWarn) warn = 'ASH — ENGINE ROUGH';
    else if (state.engineOut) warn = 'ENGINE OUT — GLIDE!';
    else if (state.fuel < 25 && !state.onGround) warn = 'LOW FUEL';
    else if (state.hull < 35 && !state.onGround) warn = 'HULL CRITICAL';
    if (warn) { e.warning.textContent = warn; e.warning.classList.remove('hidden'); }
    else e.warning.classList.add('hidden');

    if (performance.now() > this.toastUntil) e.toast.classList.add('hidden');

    this.drawCompass(state);
    this.drawGauges(state);
  },

  drawCompass(state) {
    const ctx = this.els.compass, W = 360, H = 34;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6,24,32,0.9)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '700 11px Verdana';
    ctx.textAlign = 'center';
    const pxPerDeg = 3.2;
    // Iterate over absolute tick headings near the current one — stepping
    // by relative degrees misses every tick when the heading is not itself
    // a multiple of five.
    const centre = Math.round(state.heading);
    for (let k = Math.floor((centre - 65) / 5); k <= Math.ceil((centre + 65) / 5); k++) {
      const hdg = ((k * 5) % 360 + 360) % 360;
      const d = ((hdg - centre + 540) % 360) - 180;
      if (Math.abs(d) > 62) continue;
      const x = W / 2 + d * pxPerDeg;
      if (hdg % 15 !== 0) continue;
      ctx.strokeStyle = 'rgba(243,234,210,0.5)';
      ctx.beginPath(); ctx.moveTo(x, H - 9); ctx.lineTo(x, H - 3); ctx.stroke();
      if (hdg % 30 !== 0) continue;
      const label = hdg === 0 ? 'N' : hdg === 90 ? 'E' : hdg === 180 ? 'S' : hdg === 270 ? 'W' : String(hdg).padStart(3, '0');
      ctx.fillStyle = (label.length === 1) ? '#ffb648' : '#cfd8cc';
      ctx.fillText(label, x, 13);
    }
    ctx.fillStyle = '#ff5d47';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 6, H - 2); ctx.lineTo(W / 2 + 6, H - 2); ctx.lineTo(W / 2, H - 10);
    ctx.closePath(); ctx.fill();
  },

  drawGauges(state) {
    const ctx = this.els.gauges;
    ctx.clearRect(0, 0, 318, 118);
    const spdKt = state.speed * 1.944;
    const altFt = Math.max(0, state.pos.y * 3.281);
    this.dial(ctx, 56, 59, 47, 'SPD kt', spdKt, 90, [0, 15, 30, 45, 60, 75, 90], spdKt < 27 && !state.onGround);
    this.dial(ctx, 159, 59, 47, 'ALT ft', altFt, 2000, [0, 500, 1000, 1500, 2000], false);
    this.horizon(ctx, 262, 59, 47, state);
  },

  dial(ctx, cx, cy, r, label, value, max, ticks, red) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#10181d'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = red ? '#ff5d47' : '#8a97a0'; ctx.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.font = '700 9.5px Verdana'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const a = a0 + (a1 - a0) * (t / max);
      const x1 = cx + Math.cos(a) * (r - 4), y1 = cy + Math.sin(a) * (r - 4);
      const x2 = cx + Math.cos(a) * (r - 10), y2 = cy + Math.sin(a) * (r - 10);
      ctx.strokeStyle = '#cfd8cc'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = '#e8dfc8';
      ctx.fillText(t >= 1000 ? `${t / 1000}k` : String(t), cx + Math.cos(a) * (r - 19), cy + Math.sin(a) * (r - 19));
    }
    const a = a0 + (a1 - a0) * HW.clamp(value / max, 0, 1);
    ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 13), cy + Math.sin(a) * (r - 13)); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fillStyle = '#f3ead2'; ctx.fill();
    ctx.fillStyle = '#7d938a'; ctx.font = '700 8.5px Verdana';
    ctx.fillText(label, cx, cy + r - 12);
    ctx.restore();
  },

  horizon(ctx, cx, cy, r, state) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#10181d'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.translate(cx, cy);
    ctx.rotate(-state.bank * Math.PI / 180);
    const pitchPx = HW.clamp(state.pitch, -30, 30) * 1.1;
    ctx.fillStyle = '#2e6db4'; ctx.fillRect(-r, -r, r * 2, r + pitchPx);
    ctx.fillStyle = '#7a5c40'; ctx.fillRect(-r, pitchPx, r * 2, r * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-r, pitchPx); ctx.lineTo(r, pitchPx); ctx.stroke();
    for (const p of [-20, -10, 10, 20]) {
      const y = pitchPx - p * 1.1, w = p % 20 === 0 ? 15 : 10;
      ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#8a97a0'; ctx.stroke();
    ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 17, cy); ctx.lineTo(cx - 6, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx + 17, cy);
    ctx.stroke();
    ctx.fillStyle = '#7d938a'; ctx.font = '700 8.5px Verdana'; ctx.textAlign = 'center';
    ctx.fillText('HORIZON', cx, cy + r - 12);
    ctx.restore();
  },
};
