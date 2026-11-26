// Dev-only: checks every Endless obstacle variant is beatable and measures its timing window.
// In the dev server console:  (await import('/tools/endless-check.js')).checkAll()
import { Game } from '/src/game.ts';
import { EndlessGen, ENDLESS_H, OBSTACLES, place } from '/src/endless.ts';
import * as C from '/src/config.ts';

const DT = 1 / 60;

/** A test strip: runway, one forced obstacle, landing runway. Returns { game, gapStart, gapEnd }. */
// move: motion size (0 = still, 1 = full size, as at top difficulty). phase: where in its motion each
// ring / beam starts (radians). vertical: force bobbing/sinking (true) or sliding (false). genSpeed: the speed
// the gap is built for (default: speed); running faster than that is what momentum does. sparks: force spark
// arcs and the high route on or off. plat: takeoff platform length (the high route needs 8+).
export function strip(kind, { gap, rise, beamLen, speed = C.RUN_SPEED, genSpeed, seed = 1, move = 0, phase = 0, vertical, sparks = false, plat = 6 } = {}) {
  const gen = new EndlessGen(seed);
  gen.gy = 14;
  const cols = [];
  for (let i = 0; i < 14; i++) cols.push(gen.slab(gen.gy));
  const x0 = cols.length;
  const ch = gen.next(genSpeed ?? speed, 0, kind, { gap, rise, beamLen, plat, move, phase, vertical, sparks });
  cols.push(...ch.cols);
  const { rings, beams, sparks: sparkList } = place(ch, x0);
  for (let i = 0; i < 24; i++) cols.push(gen.slab(gen.gy));
  const w = cols.length;
  const tiles = new Uint8Array(w * ENDLESS_H);
  for (let x = 0; x < w; x++) for (let y = 0; y < ENDLESS_H; y++) tiles[y * w + x] = cols[x][y];
  const level = { name: 'check', w, h: ENDLESS_H, tiles, start: { x: 3, y: 14 }, rings, beams };
  const mk = () => {
    const g = new Game({ ...level, rings: rings.map((r) => ({ ...r })), beams: beams.map((b) => ({ ...b })), sparks: sparkList.map((k) => ({ ...k })) });
    g.runSpeed = speed;
    return g;
  };
  const gapStart = x0 + plat, gapEnd = gapStart + ch.gap;
  return { mk, gapStart, gapEnd, gap: ch.gap, rise: ch.rise };
}

// Actions after waiting w frames: list of [frames, hook, jump] segments
function actions() {
  const a = [['jump', [[1, false, true]]]];
  for (let j2 = 6; j2 <= 34; j2 += 4) a.push(['double', [[1, false, true], [j2, false, false], [1, false, true]]]);
  for (let h = 6; h <= 90; h += 6) a.push(['grapple', [[h, true, false]]]);
  for (const jw of [6, 12]) for (let h = 6; h <= 90; h += 6) a.push(['jump+grapple', [[1, false, true], [jw, false, false], [h, true, false]]]);
  return a;
}
const ACTIONS = actions();

// Two swings: hold h1, let go for r frames, hold h2 (the second press waits for a lock, as in play).
function chainActions() {
  const a = [];
  for (let h1 = 12; h1 <= 72; h1 += 4) for (let r = 0; r <= 24; r += 6) for (let h2 = 18; h2 <= 78; h2 += 6)
    a.push(['grapple×2', [[h1, true, false], [r, false, false], [h2, true, false]]]);
  return a;
}
const CHAIN_ACTIONS = chainActions();

function play(g, segs) {
  for (const [n, hold, jump] of segs)
    for (let i = 0; i < n; i++) {
      g.update(DT, hold, hold && i === 0, jump && i === 0);
      if (g.player.dead) return false;
    }
  return true;
}

/** Did the runner get past the gap and stay alive for a second on the far side? */
function cleared(g, gapEnd) {
  for (let i = 0; i < 300; i++) {
    g.update(DT, false, false, false);
    if (g.player.dead) return false;
    if (g.player.grounded && g.player.x > gapEnd + 0.2) {
      for (let k = 0; k < 60; k++) { g.update(DT, false, false, false); if (g.player.dead) return false; }
      return true;
    }
  }
  return false;
}

/** Timing window: wait frames (from standing start) at which some action clears the obstacle. */
export function window(kind, opts) {
  const s = strip(kind, opts);
  const good = [];
  const how = {};
  for (let w = 0; w <= 200; w++) {
    const g0 = s.mk();
    if (!play(g0, [[w, false, false]])) break;
    if (g0.player.x > s.gapStart + 1 && g0.player.grounded === false && g0.player.y > 20) break;
    if (g0.player.x > s.gapEnd) break;
    for (const [name, segs] of kind === 'chain' ? CHAIN_ACTIONS : ACTIONS) {
      if (name.includes('grapple') && !segs.some(() => true)) continue;
      const g = s.mk();
      play(g, [[w, false, false]]);
      if (!play(g, segs)) continue;
      if (cleared(g, s.gapEnd)) { good.push(w); how[name] = (how[name] || 0) + 1; break; }
    }
  }
  const ranges = [];
  for (const w of good) { const r = ranges[ranges.length - 1]; if (r && w === r[1] + 1) r[1] = w; else ranges.push([w, w]); }
  const best = ranges.reduce((m, r) => Math.max(m, r[1] - r[0] + 1), 0);
  return { kind, gap: s.gap, rise: s.rise, window: best, how };
}

/**
 * Sparks: how many swings (wait w frames, hold h, then let go) pick up at least one / all of an obstacle's
 * spark arc and still clear the gap. high: put the high-route ring on a long platform before it instead.
 */
export function sparkReach(kind, { speed = C.RUN_SPEED, high = false, ...opts } = {}) {
  const s = strip(kind, { speed, sparks: true, plat: high ? 9 : 6, ...opts });
  const total = s.mk().level.sparks.length;
  let swings = 0, some = 0, all = 0;
  for (let w = 0; w <= 160; w++) for (let h = 6; h <= 80; h += 2) {
    const g = s.mk();
    if (!play(g, [[w, false, false]]) || g.player.x > s.gapStart + 2) continue;
    if (!play(g, [[h, true, false]]) || g.links === 0) continue;
    swings++;
    if (!cleared(g, s.gapEnd)) continue;
    if (g.sparks > 0) some++;
    if (g.sparks >= total) all++;
  }
  return { kind, speed, high, sparks: total, swings, some, all };
}

/** Every obstacle at the ends of its ranges, at base and top speed. */
export function checkAll({ speeds = [C.RUN_SPEED, C.RUN_SPEED + 3.5], kinds = Object.keys(OBSTACLES) } = {}) {
  const out = [];
  for (const [kind, o] of Object.entries(OBSTACLES)) {
    if (!kinds.includes(kind)) continue;
    const gaps = o.gap ? [o.gap[0], o.gap[1]] : [0];
    const rises = [o.rise[0], o.rise[1]];
    const lens = o.beamLen ? [o.beamLen[0], o.beamLen[1]] : [undefined];
    for (const speed of speeds) for (const gap of gaps) for (const rise of rises) for (const beamLen of lens) {
      const r = window(kind, { gap, rise, speed, beamLen });
      const w = beamLen ? ` w${beamLen}` : '';
      out.push(`${kind} gap${gap}→${r.gap} rise${rise}${w} v${speed}: ${r.window}f ${JSON.stringify(r.how)}`);
    }
  }
  return out;
}

/**
 * Moving rings and beams: each variant at full motion, from several starting phases and both directions.
 * Reports the worst (smallest) window over the phases. A 0 means some phase can't be beaten.
 */
export function checkMoving({ speeds = [C.RUN_SPEED, C.RUN_SPEED + 3.5], kinds = ['ring', 'beam', 'chain'], phases = 6, move = 1 } = {}) {
  const out = [];
  for (const kind of kinds) {
    const o = OBSTACLES[kind];
    const lens = o.beamLen ? [o.beamLen[0], o.beamLen[1]] : [undefined];
    for (const speed of speeds) for (const gap of o.gap) for (const rise of o.rise) for (const beamLen of lens) for (const vertical of [true, false]) {
      let worst = Infinity, worstPhase = 0;
      for (let i = 0; i < phases; i++) {
        const phase = (i / phases) * Math.PI * 2;
        const r = window(kind, { gap, rise, speed, beamLen, move, phase, vertical });
        if (r.window < worst) { worst = r.window; worstPhase = i; }
      }
      const w = beamLen ? ` w${beamLen}` : '';
      out.push(`${kind} gap${gap} rise${rise}${w} v${speed} ${vertical ? 'vert' : 'side'}: worst ${worst}f (phase ${worstPhase}/${phases})`);
    }
  }
  return out;
}
