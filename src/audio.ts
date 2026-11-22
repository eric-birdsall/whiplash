// Tiny synthesized SFX. No files.
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

  play(s: Sfx) {
    if (!this.ctx || this.muted) return;
    switch (s) {
      case 'fire': this.noise(0.12, 0.25, 2500, 0.8); this.tone('triangle', 900, 300, 0.1, 0.08); break;
      case 'attach': this.tone('square', 220, 140, 0.06, 0.12); this.noise(0.05, 0.3, 1200, 2); break;
      case 'clank': this.tone('square', 1400, 1100, 0.08, 0.07); this.tone('sine', 2600, 2400, 0.15, 0.05); break;
      case 'miss': this.tone('sine', 500, 250, 0.1, 0.05); break;
      case 'pull': this.tone('sawtooth', 160, 320, 0.18, 0.06); break;
      case 'key': [880, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.15, 0.12, i * 0.07)); break;
      case 'door': this.tone('square', 180, 90, 0.25, 0.1); this.noise(0.3, 0.2, 600, 1); break;
      case 'lever': this.tone('square', 600, 400, 0.05, 0.1); this.tone('square', 900, 700, 0.05, 0.08, 0.06); break;
      case 'plate': this.tone('triangle', 300, 220, 0.08, 0.1); break;
      case 'gate': this.tone('sawtooth', 120, 240, 0.35, 0.07); this.noise(0.35, 0.12, 400, 1); break;
      case 'death': this.noise(0.35, 0.4, 500, 0.7); this.tone('sawtooth', 300, 60, 0.35, 0.1); break;
      case 'checkpoint': [660, 990].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.12, i * 0.09)); break;
      case 'mantle': this.noise(0.08, 0.2, 900, 1.5); this.tone('triangle', 300, 500, 0.08, 0.07); break;
      case 'jump': this.noise(0.06, 0.18, 1400, 1.2); this.tone('triangle', 260, 520, 0.09, 0.07); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.13, i * 0.1)); break;
    }
  }
}
