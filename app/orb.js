/* ═══════════════════════════════════════════════════════════════════
   THE ORB — a reactive glow that listens to the actual audio.

   Three states, each driven by real signal, not a timer:
     waiting  : slow breathing, dim
     thinking : faster pulse, violet, no audio yet
     speaking : brightness follows the waveform's RMS in real time
     hearing  : follows the microphone level while you hold the button

   The waveform data comes from an AnalyserNode, so the orb genuinely
   moves with the voice instead of faking it with CSS keyframes.
   ═══════════════════════════════════════════════════════════════════ */

/* Classic script, not an ES module: ES modules are blocked by CORS on
   file://, and this page is meant to run by double-clicking it. */
window.Orb = class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "waiting";
    this.level = 0;          // 0..1, smoothed
    this.target = 0;         // 0..1, raw
    this.phase = 0;
    this.analyser = null;
    this.buf = null;
    this.hue = 190;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = this.canvas.getBoundingClientRect();
    const size = Math.max(box.width, 1);
    this.w = Math.round(size * dpr);
    this.h = Math.round(size * dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  attachAnalyser(analyser, dataArray) {
    this.analyser = analyser;
    this.buf = dataArray;
  }

  setState(s) {
    this.state = s;
    if (s !== "speaking" && s !== "hearing") this.target = 0;
  }

  /* sample the live audio every frame */
  sample() {
    if (!this.analyser || !this.buf) return;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    this.target = Math.min(1, rms * 3.2);
  }

  loop(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;

    if (this.state === "speaking" || this.state === "hearing") this.sample();

    /* idle breathing when there is no signal to follow */
    if (this.state === "waiting") {
      this.target = 0.06 + 0.035 * Math.sin(now / 900);
    } else if (this.state === "thinking") {
      this.target = 0.16 + 0.10 * Math.sin(now / 220);
    }

    /* asymmetric smoothing: rise fast, fall slow */
    const k = this.target > this.level ? 12 : 4;
    this.level += (this.target - this.level) * Math.min(1, dt * k);

    this.phase += dt * (this.state === "speaking" ? 1.6 : 0.6);
    this.draw();
    requestAnimationFrame(this.loop);
  }

  /* palette per state, warm/cool like the rest of the UI.
     Lightness is capped low so the core never blows out to white -
     at full volume it should read as molten gold, not a spotlight. */
  palette() {
    switch (this.state) {
      case "speaking": return { a: 32,  b: 178, sa: 100, sb: 72 };  // amber -> cyan
      case "thinking": return { a: 288, b: 196, sa: 62,  sb: 74 };  // violet -> pink
      case "hearing":  return { a: 190, b: 168, sa: 92,  sb: 86 };  // cyan -> teal
      default:         return { a: 205, b: 265, sa: 48,  sb: 58 };  // dim blue
    }
  }

  draw() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2;

    ctx.clearRect(0, 0, w, h);

    const pal = this.palette();
    const lvl = this.level;
    /* hue and saturation drift together as the voice gets louder */
    const hue = pal.a + (pal.b - pal.a) * Math.min(1, lvl * 1.25);
    const sat = pal.sa + (pal.sb - pal.sa) * Math.min(1, lvl * 1.25);

    /* 1. outer halo — soft rings, the Gemini look */
    const haloR = R * (0.74 + lvl * 0.46);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.16, cx, cy, haloR);
    halo.addColorStop(0, `hsla(${hue}, ${sat}%, 52%, ${0.26 + lvl * 0.30})`);
    halo.addColorStop(0.5, `hsla(${hue}, ${sat}%, 46%, ${0.09 + lvl * 0.13})`);
    halo.addColorStop(1, `hsla(${hue}, ${sat}%, 40%, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    /* 2. the core — a wobbling blob; brightness climbs but stays coloured */
    const petals = 7;
    const coreR = R * (0.30 + lvl * 0.20);
    ctx.beginPath();
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      const wob =
        1 +
        0.17 * Math.sin(a * petals + this.phase * 2.1) * (0.35 + lvl) +
        0.09 * Math.sin(a * (petals + 3) - this.phase * 1.4);
      const r = coreR * wob;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();

    const core = ctx.createRadialGradient(
      cx - coreR * 0.2, cy - coreR * 0.25, 0, cx, cy, coreR * 1.45
    );
    core.addColorStop(0, `hsla(${hue}, ${Math.max(30, sat - 22)}%, ${62 + lvl * 16}%, 0.95)`);
    core.addColorStop(0.45, `hsla(${hue}, ${sat}%, ${50 + lvl * 10}%, 0.92)`);
    core.addColorStop(0.82, `hsla(${hue + 18}, ${sat}%, ${34}%, 0.80)`);
    core.addColorStop(1, `hsla(${hue + 30}, ${sat}%, 22%, 0.30)`);
    ctx.fillStyle = core;
    ctx.fill();

    /* 3. specular smudge, offset up-left like every other bevel here */
    const spec = ctx.createRadialGradient(
      cx - coreR * 0.34, cy - coreR * 0.38, 0,
      cx - coreR * 0.34, cy - coreR * 0.38, coreR * 0.62
    );
    spec.addColorStop(0, `hsla(${hue}, ${Math.max(20, sat - 40)}%, ${78 + lvl * 10}%, ${0.34 + lvl * 0.22})`);
    spec.addColorStop(1, `hsla(${hue}, ${sat}%, 50%, 0)`);
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.1, 0, Math.PI * 2);
    ctx.fill();

    /* 4. rings expanding on loud peaks — the "reactive" tell */
    if (lvl > 0.12) {
      for (let i = 0; i < 2; i++) {
        const p = (this.phase * 0.5 + i * 0.5) % 1;
        const rr = R * (0.34 + p * 0.72);
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${56}%, ${(1 - p) * lvl * 0.30})`;
        ctx.lineWidth = Math.max(1, R * 0.016);
        ctx.stroke();
      }
    }
  }
};
