// Web Audio 合成：風聲、雨聲、依生態變化的生成式 BGM、音效。第一次互動後才建立 AudioContext。
const SCALES = [ // 每個生態的根音（MIDI）與五聲音階
  { root: 60, steps: [0, 2, 4, 7, 9] },   // 草原：C 大調五聲
  { root: 62, steps: [0, 2, 5, 7, 9] },   // 河谷
  { root: 65, steps: [0, 2, 4, 6, 9] },   // 舊城：利底亞色彩
  { root: 57, steps: [0, 3, 5, 7, 10] },  // 秋林：小調五聲
  { root: 64, steps: [0, 2, 3, 7, 10] },  // 雪嶺
];
const CHORDS = [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.biome = 0; this.night = 0; this.bar = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const loop = (type, freq, q) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(this.master); src.start();
        return { f, g };
      };
      this.wind = loop('bandpass', 500, 0.8);
      this.rainN = loop('highpass', 2600, 0.5);
      this.music = ctx.createGain(); this.music.gain.value = 0.16; this.music.connect(this.master);
      // 簡單殘響：回授延遲
      const dl = ctx.createDelay(1); dl.delayTime.value = 0.38;
      const fb = ctx.createGain(); fb.gain.value = 0.35;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      this.music.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
      this.nextBar = ctx.currentTime + 0.3; this.nextNote = ctx.currentTime + 1;
    } catch (e) { this.ctx = null; }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  tone(freq, t, dur, { type = 'sine', vol = 0.2, attack = 0.01, dest } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  update(s) {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime;
    this.wind.g.gain.setTargetAtTime(s.playing ? 0.05 + Math.min(s.speed / 45, 1) * 0.22 + s.wind * 0.12 : 0.03, now, 0.3);
    this.wind.f.frequency.setTargetAtTime(280 + s.speed * 22 + s.lift * 30, now, 0.3);
    this.rainN.g.gain.setTargetAtTime(s.rain * 0.22, now, 0.5);
    this.biome = s.biome; this.night = s.night;
    const sc = SCALES[this.biome];
    // 每 4 秒一個和弦墊音
    if (now > this.nextBar - 0.1) {
      const ch = CHORDS[this.bar++ % 4], t = this.nextBar;
      for (const n of ch) {
        const o = this.tone(mtof(sc.root - 12 + n), t, 4.4, { type: 'triangle', vol: 0.09 * (1 - this.night * 0.4), attack: 1.4, dest: this.music });
        o.detune.value = (Math.random() - 0.5) * 8;
      }
      this.nextBar += 4;
    }
    // 五聲音階隨機撥弦
    if (now > this.nextNote - 0.05) {
      if (Math.random() < (this.night > 0.5 ? 0.25 : 0.5)) {
        const st = sc.steps[(Math.random() * 5) | 0] + (Math.random() < 0.4 ? 12 : 0);
        this.tone(mtof(sc.root + st), this.nextNote, 1.2, { vol: 0.12, dest: this.music });
      }
      this.nextNote += 0.5;
    }
  }

  sfx(name) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, sc = SCALES[this.biome];
    if (name === 'pollen') { this.tone(mtof(sc.root + 24), t, 0.25, { vol: 0.12 }); this.tone(mtof(sc.root + 31), t + 0.06, 0.3, { vol: 0.1 }); }
    else if (name === 'plant') sc.steps.concat([12, 14, 16]).forEach((s, i) => this.tone(mtof(sc.root + 12 + s), t + i * 0.07, 0.9, { type: 'triangle', vol: 0.14 }));
    else if (name === 'hit') { const o = this.tone(140, t, 0.35, { type: 'sawtooth', vol: 0.18 }); o.frequency.exponentialRampToValueAtTime(50, t + 0.3); }
    else if (name === 'click') this.tone(880, t, 0.08, { vol: 0.08 });
    else if (name === 'biome') [0, 7, 12].forEach((s, i) => this.tone(mtof(sc.root + s), t + i * 0.12, 1.4, { type: 'triangle', vol: 0.1 }));
    else if (name === 'win') [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(mtof(60 + s), t + i * 0.1, 1.2, { type: 'triangle', vol: 0.15 }));
    else if (name === 'lose') [7, 3, 0, -5].forEach((s, i) => this.tone(mtof(57 + s), t + i * 0.22, 0.9, { type: 'triangle', vol: 0.13 }));
  }
}
