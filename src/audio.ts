// Tiny synthesized SFX and music. No files.
import type { Sfx } from './game';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = localStorage.getItem('whiplash.muted') === '1';

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem('whiplash.muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /** Resume countdown: a short blip per number, higher on "go". */
  countdown(go: boolean) {
    if (!this.ctx || this.muted) return;
    if (go) this.tone('triangle', 1320, 1320, 0.16, 0.09);
    else this.tone('triangle', 660, 660, 0.09, 0.08);
  }

  /** n: for 'spark', the pickup streak (each one in a row chimes a step higher). */
  play(s: Sfx, n = 0) {
    if (!this.ctx || this.muted) return;
    switch (s) {
      case 'fire': this.noise(0.12, 0.25, 2500, 0.8); this.tone('triangle', 900, 300, 0.1, 0.08); break;
      case 'attach': this.tone('square', 220, 140, 0.06, 0.12); this.noise(0.05, 0.3, 1200, 2); break;
      case 'clank': this.tone('square', 1400, 1100, 0.08, 0.07); this.tone('sine', 2600, 2400, 0.15, 0.05); break;
      case 'miss': this.tone('sine', 500, 250, 0.1, 0.05); break;
      case 'death': this.noise(0.35, 0.4, 500, 0.7); this.tone('sawtooth', 300, 60, 0.35, 0.1); break;
      case 'jump': this.noise(0.06, 0.18, 1400, 1.2); this.tone('triangle', 260, 520, 0.09, 0.07); break;
      case 'perfect': this.tone('triangle', 880, 1320, 0.12, 0.1); this.tone('sine', 1760, 1760, 0.22, 0.05, 0.05); break;
      case 'chain': [660, 880, 1100].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.08, i * 0.06)); break;
      case 'spark': {
        // A major-pentatonic ladder: A5, B5, C#6, E6, F#6, A6, …
        const deg = [0, 2, 4, 7, 9][(n - 1) % 5] + 12 * Math.floor((n - 1) / 5);
        const f = 880 * Math.pow(2, Math.min(24, deg) / 12);
        this.tone('sine', f, f, 0.14, 0.07); this.tone('triangle', f * 2, f * 2, 0.06, 0.025);
        break;
      }
      case 'best': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.16, 0.05, i * 0.08)); break;
    }
  }

  // ---------- Music ----------
  // A looping 4-bar groove in A minor (Am F C G), 128 BPM, scheduled a little ahead on the audio clock.
  // Layer 0 (kick + bass) always plays during a run; layers 1–3 (hats and snare, arpeggio, lead) fade in
  // as the swing chain grows and fall away when you land.

  musicOn = localStorage.getItem('whiplash.music') !== '0';
  private bus: GainNode | null = null;
  private layers: GainNode[] = [];
  private layerOn: boolean[] = [];
  private timer = 0;
  private nextT = 0;
  private step = 0;

  setMusicOn(on: boolean) {
    this.musicOn = on;
    localStorage.setItem('whiplash.music', on ? '1' : '0');
    if (!on) this.stopMusic();
  }

  get musicPlaying() { return !!this.timer; }

  startMusic() {
    if (!this.ctx || !this.musicOn || this.timer) return;
    const c = this.ctx;
    this.bus = c.createGain();
    this.bus.gain.setValueAtTime(0.0001, c.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.4);
    this.bus.connect(this.master!);
    this.layers = [0, 1, 2, 3].map((i) => {
      const g = c.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      g.connect(this.bus!);
      return g;
    });
    this.layerOn = [true, false, false, false];
    this.nextT = c.currentTime + 0.08;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = 0;
    const bus = this.bus, c = this.ctx!;
    if (bus) {
      bus.gain.cancelScheduledValues(c.currentTime);
      bus.gain.setTargetAtTime(0, c.currentTime, 0.08);
      setTimeout(() => bus.disconnect(), 600);
    }
    this.bus = null;
  }

  /** How many layers above the base beat to play (0–3). Rising is quick, falling eases out. */
  setMusicLevel(level: number) {
    if (!this.timer || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 1; i < 4; i++) {
      const on = i <= level;
      if (on === this.layerOn[i]) continue;
      this.layerOn[i] = on;
      this.layers[i].gain.cancelScheduledValues(t);
      this.layers[i].gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.03 : 0.35);
    }
  }

  private schedule() {
    const c = this.ctx!;
    const sixteenth = 60 / 128 / 4;
    while (this.nextT < c.currentTime + 0.12) {
      this.musicStep(this.step, this.nextT);
      this.nextT += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  /** One sixteenth of the groove at audio time t. */
  private musicStep(step: number, t: number) {
    const bar = Math.floor(step / 16), s = step % 16;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (MIDI)
    const ch = chords[bar];
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const [L0, L1, L2, L3] = this.layers;
    // Layer 0: four-on-the-floor kick and an eighth-note bass.
    if (s % 4 === 0) this.kick(L0, t);
    if (s % 2 === 0) {
      const oct = s % 8 === 6 ? 12 : 0;
      this.voice(L0, 'sawtooth', hz(ch[0] - 24 + oct), t, 0.11, 0.09, 520);
    }
    // Layer 1: off-beat hats, softer sixteenths, snare on 2 and 4.
    this.hat(L1, t, s % 4 === 2 ? 0.07 : 0.025);
    if (s === 4 || s === 12) this.snare(L1, t);
    // Layer 2: sixteenth-note arpeggio an octave up.
    this.voice(L2, 'square', hz(ch[[0, 1, 2, 1][s % 4]] + 12), t, 0.08, 0.022, 2400);
    // Layer 3: a lead line on the eighths, two octaves up, resting on the last one.
    if (s % 2 === 0 && s !== 14) {
      const motif = [2, 1, 2, 0, 1, 2, 1];
      this.voice(L3, 'triangle', hz(ch[motif[s / 2]] + 24), t, 0.2, 0.05, 6000);
    }
  }

  private voice(dest: AudioNode, type: OscillatorType, f: number, t: number, dur: number, vol: number, cutoff: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    fl.type = 'lowpass';
    fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(dest: AudioNode, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.2);
  }

  private hat(dest: AudioNode, t: number, vol: number) {
    const c = this.ctx!;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noiseBuf;
    f.type = 'highpass';
    f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 0.4);
    n.stop(t + 0.05);
  }

  private snare(dest: AudioNode, t: number) {
    const c = this.ctx!;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noiseBuf;
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.7;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 0.3);
    n.stop(t + 0.14);
    this.voice(dest, 'triangle', 190, t, 0.07, 0.06, 2000);
  }
}
