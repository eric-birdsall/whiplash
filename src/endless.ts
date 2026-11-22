// Endless run: one procedurally generated level that keeps growing ahead of the runner.
// Platforms with gaps; each gap is beaten with a jump, a double jump, or a 60° grapple
// (a hanging wood beam or a ring). Speed and difficulty ramp with distance.

import * as C from './config';
import { Game, type Sfx } from './game';
import { Tile, type Level, type Vec } from './level';

export const ENDLESS_H = 22;
const START_FLAT = 14;
/** Platform thickness: floating slabs with open air below (falling off the screen ends the run). */
const SLAB = 2;
const AHEAD = 90; // keep this many tiles generated ahead of the runner
const BEST_KEY = 'whiplash.endless.best';

/** Small seeded RNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ObstacleKind = 'jump' | 'double' | 'step' | 'beam' | 'ring' | 'chain';

/** Tunable ranges per obstacle, in tiles at base speed (gaps scale with speed). Checked by tools/endless-check.js. */
export const OBSTACLES = {
  jump: { gap: [2, 4], rise: [-3, 1] },
  double: { gap: [6, 8], rise: [-3, 1] },
  step: { rise: [1, 3] }, // no gap: a ledge to hop up (3 needs the double jump)
  // Beam and ring gaps are wider than a double jump reaches, so they need the grapple.
  // Beams hang near the top of the screen (beamAbove tiles over the takeoff surface). Widths vary; narrow
  // ones get more common with difficulty. beamAt = where the beam starts, as a fraction of the gap.
  beam: { gap: [11, 13], rise: [-2, 1], beamAbove: 8, beamLen: [2, 6], beamAt: 0.15 },
  ring: { gap: [11, 12], rise: [-2, 0], ringAbove: 5 },
  // Two rings over one long gap: swing rope to rope (a built-in swing chain).
  chain: { gap: [19, 21], rise: [-2, 0], ringAbove: 5, ring2At: 0.68 },
};

export class EndlessGen {
  private rand: () => number;
  /** Top row of the current ground. Smaller = higher. */
  gy = 15;
  readonly minGy = 9;
  readonly maxGy = 18;

  constructor(seed: number) { this.rand = rng(seed); }

  private ri(a: number, b: number) { return a + Math.floor(this.rand() * (b - a + 1)); }

  /** One column of a floating platform whose top row is gy. */
  slab(gy: number): Uint8Array {
    const c = new Uint8Array(ENDLESS_H);
    for (let y = gy; y < Math.min(ENDLESS_H, gy + SLAB); y++) c[y] = Tile.Stone;
    return c;
  }

  /** The opening runway. */
  start(): Uint8Array[] {
    return Array.from({ length: START_FLAT }, () => this.slab(this.gy));
  }

  /** Pick an obstacle for this difficulty (0..1). */
  pick(d: number): ObstacleKind {
    // The grapple is the star: beams from the first gap, rings almost right away.
    const w: [ObstacleKind, number][] = [
      ['beam', 3],
      ['ring', d < 0.03 ? 0 : 2 + d],
      ['jump', 1.5],
      ['double', d < 0.03 ? 0 : 1.5],
      ['step', 0.6],
      ['chain', d < 0.06 ? 0 : 1 + d],
    ];
    const total = w.reduce((s, [, n]) => s + n, 0);
    let r = this.rand() * total;
    for (const [k, n] of w) { if ((r -= n) < 0) return k; }
    return 'jump';
  }

  /**
   * One platform followed by one obstacle. speed scales gap widths; d (0..1) shortens platforms.
   * `force` picks the obstacle (used by the checker).
   */
  next(speed: number, d: number, force?: ObstacleKind, params?: { gap?: number; rise?: number; plat?: number; beamLen?: number }) {
    const cols: Uint8Array[] = [];
    const rings: Vec[] = [];
    const k = speed / C.RUN_SPEED;
    const platLen = params?.plat ?? this.ri(Math.round(7 - 2 * d), Math.round(13 - 5 * d));
    for (let i = 0; i < platLen; i++) cols.push(this.slab(this.gy));

    const kind = force ?? this.pick(d);
    const clampRise = (rise: number) => {
      const ng = Math.min(this.maxGy, Math.max(this.minGy, this.gy - rise));
      return this.gy - ng;
    };
    const o = OBSTACLES[kind] as {
      gap?: number[]; rise: number[]; beamAbove?: number; beamLen?: number[]; beamAt?: number; ringAbove?: number; ring2At?: number;
    };
    const rise = clampRise(params?.rise ?? this.ri(o.rise[0], o.rise[1]));
    const gapBase = params?.gap ?? (o.gap ? o.gap[0] + this.rand() * (o.gap[1] - o.gap[0]) : 0);
    // Going up shortens what you can clear; going down lengthens it a little.
    const gap = kind === 'step' ? 0 : Math.max(2, Math.round(gapBase * k - Math.max(0, rise) * 0.6));
    const takeoffGy = this.gy;
    const startX = cols.length; // index of first gap column within this chunk

    for (let i = 0; i < gap; i++) cols.push(new Uint8Array(ENDLESS_H));

    if (kind === 'beam') {
      const row = Math.max(1, takeoffGy - (o.beamAbove ?? 6) - 1); // tile row; underside is row + 1
      const from = startX + Math.max(0, Math.round(gap * (o.beamAt ?? 0.15)));
      const [lo, hi] = o.beamLen ?? [6, 6];
      // Skewed toward narrow as difficulty rises.
      const len = params?.beamLen ?? lo + Math.floor(Math.pow(this.rand(), 1 + 2 * d) * (hi - lo + 1));
      for (let i = 0; i < len; i++) {
        const ci = from + i;
        while (cols.length <= ci) cols.push(this.slab(takeoffGy - rise));
        cols[ci][row] = Tile.Wood;
      }
    }
    this.gy -= rise;
    if (kind === 'ring') rings.push({ x: startX + gap * 0.45, y: takeoffGy - (o.ringAbove ?? 5) + 0.5 }); // x relative to chunk start
    if (kind === 'chain') {
      const ry = takeoffGy - (o.ringAbove ?? 5) + 0.5;
      rings.push({ x: startX + gap * 0.27, y: ry }, { x: startX + gap * (o.ring2At ?? 0.68), y: ry });
    }
    return { cols, rings, kind, gap, rise };
  }
}

/** Drives one endless run: grows the world, ramps speed, tracks distance and best. */
export class EndlessRun {
  game: Game;
  gen: EndlessGen;
  startX: number;
  best: number;
  private lastKinds: ObstacleKind[] = [];
  private chunks = 0;

  constructor(sfx: (s: Sfx) => void, seed = (Math.random() * 2 ** 31) | 0) {
    this.gen = new EndlessGen(seed);
    const cols = this.gen.start();
    const level: Level = {
      name: 'Endless',
      hint: 'Tap left to jump (again in the air to double jump). Tap right to grapple.',
      w: cols.length, h: ENDLESS_H, tiles: new Uint8Array(cols.length * ENDLESS_H),
      start: { x: 4, y: this.gen.gy }, rings: [],
    };
    for (let x = 0; x < cols.length; x++) for (let y = 0; y < ENDLESS_H; y++) level.tiles[y * cols.length + x] = cols[x][y];
    this.game = new Game(level, sfx);
    const g = this.game;
    g.cameraLead = 10; // runner sits near the left edge so the next landing is on screen
    this.startX = g.center().x;
    this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    this.ensure();
  }

  get distance() { return Math.max(0, Math.floor(this.game.center().x - this.startX)); }

  /** Distance plus chain bonus metres: what the HUD shows and the best records. */
  get score() { return this.distance + this.game.bonus; }

  /** Difficulty 0..1 by distance. */
  get difficulty() { return Math.min(1, this.distance / 1500); }

  /** Call every fixed step before game.update. */
  tick() {
    const g = this.game;
    g.runSpeed = C.RUN_SPEED + C.RUN_SPEED_GAIN * Math.min(1, this.distance / 1600);
    this.ensure();
    g.hudTitle = `${this.score} m`;
    g.hudStats = `best ${Math.max(this.best, this.score)} m`;
  }

  private ensure() {
    const g = this.game;
    while (g.w - g.player.x < AHEAD) {
      // Avoid three of the same obstacle in a row.
      // The very first gap is a grapple beam, so the hook is in play straight away.
      let kind: ObstacleKind = this.chunks++ === 0 ? 'beam' : this.gen.pick(this.difficulty);
      if (this.lastKinds.length >= 2 && this.lastKinds.every((k) => k === kind)) kind = this.gen.pick(this.difficulty);
      const chunk = this.gen.next(g.runSpeed, this.difficulty, kind);
      this.lastKinds = [...this.lastKinds.slice(-1), chunk.kind];
      const x0 = g.w;
      g.appendColumns(chunk.cols, chunk.rings.map((r) => ({ x: r.x + x0, y: r.y })));
    }
  }

  /** Save the best score; returns true if this run set a new best. */
  finish(): boolean {
    const d = this.score;
    if (d > this.best) { this.best = d; localStorage.setItem(BEST_KEY, String(d)); return true; }
    return false;
  }
}
