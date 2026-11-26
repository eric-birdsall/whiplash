// Endless run: one procedurally generated level that keeps growing ahead of the runner.
// Platforms with gaps; each gap is beaten with a jump, a double jump, or a 60° grapple
// (a hanging wood beam or a ring). Speed and difficulty ramp with distance.

import * as C from './config';
import { Game, type Sfx } from './game';
import { Tile, type Beam, type Level, type Motion, type Ring } from './level';

export const ENDLESS_H = 22;
const START_FLAT = 14;
/** Platform thickness: floating slabs with open air below (falling off the screen ends the run). */
const SLAB = 2;
const AHEAD = 90; // keep this many tiles generated ahead of the runner
const BEST_KEY = 'whiplash.endless.bestScore';
const BEST_DIST_KEY = 'whiplash.endless.bestDist';
const LAST_DEATH_KEY = 'whiplash.endless.lastDeath';
/** Before momentum scoring, the best was distance + chain metres: a fair first guess at the farthest run. */
const OLD_BEST_KEY = 'whiplash.endless.best';

/** The optional high route: a lone still ring high over a long platform. */
const HIGH_RING = { above: 8.5, at: 2.5, minPlat: 8, chance: 0.4, from: 0.05 };

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
  ring: { gap: [11, 12], rise: [-2, 0], ringAbove: 7 },
  // Two rings over one long gap: swing rope to rope (a built-in swing chain).
  chain: { gap: [19, 21], rise: [-2, 0], ringAbove: 6.5, ring2At: 0.68 },
};

/**
 * How rings and beams move (full size; scaled by MOVE_MIN..1 with difficulty). Each one picks a direction:
 * rings bob up and down or slide side to side around their home; beams slide forward from their usual
 * spot, or sink below their usual height, and come back (never further back or higher).
 */
export const MOTION = {
  period: [2.4, 3.4], // seconds per full back-and-forth
  ringBob: 2, // ± tiles up/down
  ringSlide: 2.8, // ± tiles side to side
  ringBobChance: 0.6,
  beamSlide: 7, // slides forward this far from its usual spot and back
  beamSink: 2.2, // sinks this far below its usual height at the bottom of its travel
  beamSlideChance: 0.6,
};
const MOVE_MIN = 0.6;

/** Generator options (the checker forces these). */
export type ChunkParams = {
  gap?: number; rise?: number; plat?: number; beamLen?: number; move?: number; phase?: number; vertical?: boolean;
  /** Force the high-route ring on (true) or off (false). */
  high?: boolean;
};

/** Chunk-relative rings and beams → world ones at column x0. */
export function place(chunk: { rings: Ring[]; beams: Beam[] }, x0: number) {
  return {
    rings: chunk.rings.map((r) => ({ ...r, x: r.x + x0, bx: r.bx + x0 })),
    beams: chunk.beams.map((b) => ({ ...b, x: b.x + x0, bx: b.bx + x0 })),
  };
}

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
  next(speed: number, d: number, force?: ObstacleKind, params?: ChunkParams) {
    const cols: Uint8Array[] = [];
    const rings: Ring[] = [];
    const beams: Beam[] = [];
    const scale = params?.move ?? MOVE_MIN + (1 - MOVE_MIN) * d;
    const motion = (ax: number, ay: number): Motion | undefined => {
      if (scale <= 0 || (!ax && !ay)) return undefined;
      const [p0, p1] = MOTION.period;
      return { ax: ax * scale, ay: ay * scale, period: p0 + this.rand() * (p1 - p0), phase: params?.phase ?? this.rand() * Math.PI * 2 };
    };
    const vertical = (chance: number) => params?.vertical ?? this.rand() < chance;
    const ring = (x: number, y: number) => {
      const m = vertical(MOTION.ringBobChance) ? motion(0, MOTION.ringBob) : motion(MOTION.ringSlide, 0);
      rings.push({ x, y, bx: x, by: y, m });
    };
    const k = speed / C.RUN_SPEED;
    const platLen = params?.plat ?? this.ri(Math.round(7 - 2 * d), Math.round(13 - 5 * d));
    for (let i = 0; i < platLen; i++) cols.push(this.slab(this.gy));
    // The high route: a still ring up near the top over a long platform. Catch it straight out of the last
    // obstacle to keep a chain going instead of landing. Walking under it is safe.
    if (platLen >= HIGH_RING.minPlat && (params?.high ?? (d >= HIGH_RING.from && this.rand() < HIGH_RING.chance))) {
      const hx = HIGH_RING.at, hy = this.gy - HIGH_RING.above;
      rings.push({ x: hx, y: hy, bx: hx, by: hy });
    }

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
      while (cols.length < from + len) cols.push(this.slab(takeoffGy - rise));
      // Each beam's travel starts at its usual spot and only goes forward (sliding) or down (sinking), so
      // it never ends up further back or higher: the home sits half the travel along and swings ±half.
      const slide = !vertical(1 - MOTION.beamSlideChance);
      const m = slide ? motion(MOTION.beamSlide / 2, 0) : motion(0, MOTION.beamSink / 2);
      const x = from + (m ? m.ax : 0), y = row + (m ? m.ay : 0);
      while (cols.length < Math.ceil(x + (m ? m.ax : 0)) + len) cols.push(this.slab(takeoffGy - rise));
      beams.push({ x, y, w: len, h: 1, bx: x, by: y, m, dx: 0, dy: 0 });
    }
    this.gy -= rise;
    if (kind === 'ring') ring(startX + gap * 0.45, takeoffGy - (o.ringAbove ?? 5) + 0.5); // x relative to chunk start
    if (kind === 'chain') {
      const ry = takeoffGy - (o.ringAbove ?? 5) + 0.5;
      ring(startX + gap * 0.27, ry);
      ring(startX + gap * (o.ring2At ?? 0.68), ry);
    }
    return { cols, rings, beams, kind, gap, rise };
  }
}

/** Drives one endless run: grows the world, sets speed, keeps score, and remembers the best and the last death. */
export class EndlessRun {
  game: Game;
  gen: EndlessGen;
  startX: number;
  /** Best score (points). */
  best: number;
  /** Farthest distance ever (metres): where the BEST flag stands on the course. */
  bestDist: number;
  /** Where the previous run ended (metres), or 0. */
  lastDeath: number;
  /** Points so far: metres and bonus metres, each times the momentum multiplier when earned. */
  private points = 0;
  private lastDist = 0;
  private lastBonus = 0;
  /** Passed the BEST flag this run (announced once). */
  passedBest = false;
  private lastKinds: ObstacleKind[] = [];
  private chunks = 0;

  constructor(sfx: (s: Sfx) => void, seed = (Math.random() * 2 ** 31) | 0) {
    this.gen = new EndlessGen(seed);
    const cols = this.gen.start();
    const level: Level = {
      name: 'Endless',
      hint: 'Tap left to jump (again in the air to double jump). Tap right to grapple.',
      w: cols.length, h: ENDLESS_H, tiles: new Uint8Array(cols.length * ENDLESS_H),
      start: { x: 4, y: this.gen.gy }, rings: [], beams: [],
    };
    for (let x = 0; x < cols.length; x++) for (let y = 0; y < ENDLESS_H; y++) level.tiles[y * cols.length + x] = cols[x][y];
    this.game = new Game(level, sfx);
    const g = this.game;
    g.cameraLead = 10; // runner sits near the left edge so the next landing is on screen
    this.startX = g.center().x;
    const num = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
    this.best = num(BEST_KEY);
    this.bestDist = num(BEST_DIST_KEY) || num(OLD_BEST_KEY);
    this.lastDeath = num(LAST_DEATH_KEY);
    this.ensure();
  }

  get distance() { return Math.max(0, Math.floor(this.game.center().x - this.startX)); }

  /** Score multiplier from momentum (×1 to ×(1 + MOM_SCORE)). */
  get multiplier() { return 1 + C.MOM_SCORE * this.game.momentum; }

  /** What the HUD shows and the best records. */
  get score() { return Math.floor(this.points); }

  /** Difficulty 0..1 by distance. */
  get difficulty() { return Math.min(1, this.distance / 1500); }

  /** Run speed from distance alone: what the course's gaps are built for. */
  get baseSpeed() { return C.RUN_SPEED + C.RUN_SPEED_GAIN * Math.min(1, this.distance / 1600); }

  /** World x of a distance in metres (for course markers). */
  xAt(m: number) { return this.startX + m; }

  /** Call every fixed step before game.update. */
  tick() {
    const g = this.game;
    g.runSpeed = this.baseSpeed + C.MOM_SPEED * g.momentum;
    this.ensure();
    const d = this.distance;
    // Every metre and bonus metre is worth the multiplier at the moment it's earned.
    this.points += (d - this.lastDist + g.bonus - this.lastBonus) * this.multiplier;
    this.lastDist = d; this.lastBonus = g.bonus;
    if (!this.passedBest && this.bestDist > 0 && d > this.bestDist) {
      this.passedBest = true;
      const c = g.center();
      g.popup('NEW BEST!', c.x + 2, c.y - 2.4, '#ffe36b', true);
      g.sfxOut('best');
    }
    g.hudTitle = `${this.score}`;
    g.hudStats = `${d} m · best ${Math.max(this.best, this.score)}`;
  }

  private ensure() {
    const g = this.game;
    while (g.w - g.player.x < AHEAD) {
      // Avoid three of the same obstacle in a row.
      // The very first gap is a grapple beam, so the hook is in play straight away.
      let kind: ObstacleKind = this.chunks++ === 0 ? 'beam' : this.gen.pick(this.difficulty);
      if (this.lastKinds.length >= 2 && this.lastKinds.every((k) => k === kind)) kind = this.gen.pick(this.difficulty);
      // Gaps are built for the distance speed; momentum only ever makes you faster than that.
      const chunk = this.gen.next(this.baseSpeed, this.difficulty, kind);
      this.lastKinds = [...this.lastKinds.slice(-1), chunk.kind];
      const placed = place(chunk, g.w);
      g.appendColumns(chunk.cols, placed.rings, placed.beams);
    }
  }

  /** Save the best score, farthest distance and where this run ended; returns true if it set a new best score. */
  finish(): boolean {
    const d = this.score, dist = this.distance;
    const save = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };
    save(LAST_DEATH_KEY, dist);
    if (dist > this.bestDist) { this.bestDist = dist; save(BEST_DIST_KEY, dist); }
    if (d > this.best) { this.best = d; save(BEST_KEY, d); return true; }
    return false;
  }
}
