// Dev-only level solver. In the dev server's page console:
//   const S = await import('/tools/sim.js');
//   S.solve(0, [{ walk: 8.5 }, { hook: [9.2, 9] }, { gap: [19.4, 24.6] }, ...])
// Steps:
//   { walk: x }                 walk until player center reaches x
//   { hook: [x, y], frames? }   fire at world point, hold for `frames` (default 50), then release
//   { gap: [x0, x1], feetMax? } brute-force a hook+hold+release that lands grounded with center in [x0, x1]
// Not part of the game build.
import { Game } from '/src/game.ts';
import { parseLevel } from '/src/level.ts';
import { LEVELS } from '/src/levels/index.ts';

const DT = 1 / 60;
const NONE = { x: 0, y: 0 };

export const mk = (i) => new Game(parseLevel(LEVELS[i]));

export function st(g) {
  const p = g.player;
  return {
    x: +(p.x + p.w / 2).toFixed(2), feet: +(p.y + p.h).toFixed(2), grounded: p.grounded, dead: p.dead,
    deaths: g.deaths, hook: g.hook.kind, keys: p.keys, done: g.completed,
  };
}

export function run(g, n, mx, hold, aim = NONE) {
  for (let i = 0; i < n; i++) g.update(DT, mx, hold, hold && i === 0, aim);
  return st(g);
}

export function walkTo(g, tx, max = 900) {
  const d = Math.sign(tx - (g.player.x + g.player.w / 2));
  for (let n = 0; n < max && d * (tx - (g.player.x + g.player.w / 2)) > 0.05 && !g.player.dead; n++) g.update(DT, d, false, false, NONE);
  run(g, 20, 0, false);
  return st(g);
}

export function replay(lvl, segs) {
  const g = mk(lvl);
  for (const s of segs) {
    if (s[0] === 'walk') walkTo(g, s[1]);
    else run(g, s[0], s[1], s[2], s[3]);
  }
  return g;
}

export function search(lvl, prefix, x0, x1, { feetMax = 99, max = 1 } = {}) {
  const res = [];
  const c = replay(lvl, prefix).center();
  for (let ax = Math.floor(c.x - 3); ax <= c.x + 9; ax++)
    for (let ay = Math.floor(c.y - 9); ay <= c.y + 2; ay++) {
      if (Math.hypot(ax - c.x, ay - c.y) > 9.5) continue;
      for (let h = 8; h <= 150; h += 6)
        for (const mx of [1, 0]) {
          const g = replay(lvl, prefix);
          run(g, h, mx, true, { x: ax + 0.01, y: ay + 0.01 });
          if (g.player.dead) continue;
          for (let i = 0; i < 300; i++) {
            g.update(DT, 0, false, false, NONE);
            if (g.player.dead) break;
            if (g.player.grounded) {
              const s = st(g);
              if (s.x >= x0 && s.x <= x1 && s.feet <= feetMax) res.push([ax, ay, h, mx]);
              break;
            }
          }
          if (res.length >= max) return res;
        }
    }
  return res;
}

export function solve(lvl, steps) {
  const pre = [];
  const log = [];
  for (const s of steps) {
    if (s.walk !== undefined) pre.push(['walk', s.walk]);
    else if (s.hook) pre.push([s.frames ?? 50, 0, true, { x: s.hook[0], y: s.hook[1] }], [30, 0, false]);
    else if (s.gap) {
      const r = search(lvl, pre, s.gap[0], s.gap[1], { feetMax: s.feetMax });
      if (!r.length) return { ok: false, log, failedAt: s, state: st(replay(lvl, pre)) };
      const [ax, ay, h, mx] = r[0];
      pre.push([h, mx, true, { x: ax + 0.01, y: ay + 0.01 }], [120, 0, false]);
      log.push({ gap: s.gap, sol: r[0] });
    }
    const now = replay(lvl, pre);
    if (now.player.dead || now.deaths) return { ok: false, log, failedAt: s, state: st(now) };
  }
  const g = replay(lvl, pre);
  return { ok: g.completed, log, final: st(g), game: g };
}

/**
 * Airborne chain: from the prefix, hook each target in turn (mid-air), then finish with `land`.
 * targets: [[x,y], ...] world points (ring centers / ledge corners).
 * Greedy per link: finds hold + release-wait so the next hook attaches.
 * land: { gap:[x0,x1], feetMax } checked after the last target.
 */
export function chain(lvl, prefixSteps, targets, land) {
  // Convert prefix steps to raw segments using solve's logic.
  const pre = [];
  for (const s of prefixSteps) {
    if (Array.isArray(s)) pre.push(s); // raw segment, e.g. from a previous chain().segs
    else if (s.walk !== undefined) pre.push(['walk', s.walk]);
    else if (s.hook) pre.push([s.frames ?? 50, 0, true, { x: s.hook[0], y: s.hook[1] }], [30, 0, false]);
  }
  const segs = [...pre];
  const log = [];
  // first link: fire at targets[0] from the ground
  for (let i = 0; i < targets.length; i++) {
    const [tx, ty] = targets[i];
    const next = targets[i + 1];
    let found = null;
    outer: for (let h = 10; h <= 150; h += 4)
      for (const mx of [1, 0])
        for (let w = 0; w <= 40; w += 3) {
          const trial = [...segs, [h, mx, true, { x: tx, y: ty }], [w, 0, false]];
          const g = replay(lvl, trial);
          if (g.player.dead || g.deaths) continue;
          if (next) {
            // fire at next target and check it attaches within 20 frames
            g.update(DT, 0, true, true, { x: next[0], y: next[1] });
            let ok = false;
            for (let k = 0; k < 25; k++) {
              g.update(DT, 0, true, false, NONE);
              if (g.player.dead) break;
              if (g.hook.kind === 'anchored') { ok = Math.hypot(g.hook.x - next[0], g.hook.y - next[1]) < 0.7; break; }
              if (g.hook.kind === 'idle' || g.hook.kind === 'returning') break;
            }
            if (ok) { found = [h, mx, w]; segs.push([h, mx, true, { x: tx, y: ty }], [w, 0, false]); break outer; }
          } else {
            for (let k = 0; k < 300; k++) {
              g.update(DT, 0, false, false, NONE);
              if (g.player.dead) break;
              if (g.player.grounded) {
                const s = st(g);
                if (s.x >= land.gap[0] && s.x <= land.gap[1] && s.feet <= (land.feetMax ?? 99)) {
                  found = [h, mx, w]; segs.push([h, mx, true, { x: tx, y: ty }], [w, 0, false], [120, 0, false]);
                  break outer;
                }
                break;
              }
            }
          }
        }
    log.push({ target: targets[i], found });
    if (!found) return { ok: false, log };
  }
  const g = replay(lvl, segs);
  return { ok: true, log, final: st(g), segs };
}

// ---------- Runner mode (auto-run right, jump, ceiling-only, fixed 45° auto-aim) ----------
// Segments: [frames, hookHeld, _, jumpOnFirstFrame?]. moveX is always 1, aim is always game.assistAim().

export const mkR = (i) => { const g = mk(i); g.ceilingOnly = true; g.hookRange = 11; g.wallKills = true; g.autoAim = true; return g; };

export function repR(lvl, segs) {
  const g = mkR(lvl);
  for (const [n, hold, , j] of segs)
    for (let i = 0; i < n; i++) g.update(DT, 1, hold, hold && i === 0, g.assistAim(), !!j && i === 0);
  return g;
}

function landR(g, x0, x1, fm, need) {
  for (let i = 0; i < 240; i++) {
    g.update(DT, 1, false, false, g.assistAim(), false);
    if (g.player.dead) return -1;
    if (g.player.grounded) {
      const s = st(g);
      return s.x >= x0 && s.x <= x1 && s.feet <= fm && (!need || need(g)) ? i + 1 : -1;
    }
  }
  return -1;
}

/**
 * Find wait + (jump | grapple+hold [+ chained grapples]) that lands grounded with center in [x0,x1], feet <= fm.
 * Grapple chains: after releasing, wait r frames and grapple again (up to `chain` grapples in the air).
 */
export function stepR(lvl, pre, x0, x1, fm = 99, { maxWait = 90, chain = 1, need = null } = {}) {
  const tryFrom = (base, depth) => {
    for (let h = 4; h <= 120; h += 4) {
      const segs = [...base, [h, true]];
      const g = repR(lvl, segs);
      if (g.player.dead || g.deaths) continue;
      const i = landR(g, x0, x1, fm, need);
      if (i > 0) return [...segs, [i, false]];
      if (depth > 1) {
        for (let r = 0; r <= 30; r += 3) {
          const g2 = repR(lvl, [...segs, [r, false]]);
          if (g2.player.dead || g2.player.grounded) break;
          if (!g2.assistAim().locked) continue;
          const res = tryFrom([...segs, [r, false]], depth - 1);
          if (res) return res;
        }
      }
    }
    return null;
  };
  for (let w = 0; w <= maxWait; w += 3) {
    {
      const g = repR(lvl, [...pre, [w, false], [1, false, null, true]]);
      const i = landR(g, x0, x1, fm, need);
      if (i > 0) return { pre: [...pre, [w, false], [1, false, null, true], [i, false]], how: ['jump', w] };
    }
    const g0 = repR(lvl, [...pre, [w, false]]);
    if (g0.player.dead) break;
    // jump then grapple from the air
    for (const jw of [null, 6, 12, 18]) {
      const base = jw === null ? [...pre, [w, false]] : [...pre, [w, false], [1, false, null, true], [jw, false]];
      const gb = repR(lvl, base);
      if (gb.player.dead || !gb.assistAim().locked) continue;
      const res = tryFrom(base, chain);
      if (res) return { pre: res, how: [jw === null ? 'grapple' : 'jump+grapple', w, jw] };
    }
  }
  return null;
}

/** Run until `check(game)` passes after a grapple fired at the first locked frame within maxWait. */
export function scanR(lvl, pre, check, { maxWait = 90, hold = 2 } = {}) {
  for (let n = 0; n <= maxWait; n += 2) {
    const g0 = repR(lvl, [...pre, [n, false]]);
    if (!g0.assistAim().locked) continue;
    const p2 = [...pre, [n, false], [hold, true], [1, false]];
    if (check(repR(lvl, [...p2, [30, false]]))) return p2;
  }
  return null;
}

// ---------- Runner audit: sloppy random players, death hotspots and softlocks ----------

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Plays a level many times with a random "sloppy" player: grapples at random moments while a target is
 * locked, holds a random time, jumps at random. Deaths respawn at checkpoints as in the game.
 * Reports deaths per 2-tile bin with reasons, softlocks (alive, no progress for 6 s), and completions.
 */
export function auditR(lvl, { runs = 40, seconds = 90, seed = 1, fire = 0.05, jump = 0.02, tapAny = false } = {}) {
  const deaths = {}, softlocks = {};
  let completions = 0;
  const times = [];
  for (let r = 0; r < runs; r++) {
    const rand = rng(seed + r * 7919);
    const g = mkR(lvl);
    let hold = 0, bestX = -1, anchorY = 0, lastProgress = 0, lastDeaths = 0;
    for (let f = 0; f < seconds * 60 && !g.completed; f++) {
      const aim = g.assistAim();
      let pressed = false, jp = false;
      if (hold > 0) hold--;
      // tapAny: a human-like masher that taps whenever, locked or not, hook ready or not.
      else if ((tapAny || (g.hook.kind === 'idle' && aim.locked)) && rand() < fire) { hold = 6 + Math.floor(rand() * 90); pressed = true; }
      if (g.player.grounded && rand() < jump) jp = true;
      g.update(DT, 1, hold > 0, pressed, aim, jp);
      if (g.deaths !== lastDeaths) {
        lastDeaths = g.deaths;
        const d = g.lastDeath, bin = Math.floor(d.x / 2) * 2;
        const k = `${bin}-${bin + 2}`;
        (deaths[k] ??= { n: 0 })[d.reason] = (deaths[k][d.reason] || 0) + 1;
        deaths[k].n++;
        lastProgress = f;
      }
      // Softlock = alive but hasn't moved half a tile (any direction) for 6 s.
      const x = g.player.x, y = g.player.y;
      if (bestX < 0 || Math.hypot(x - bestX, y - anchorY) > 0.5) { bestX = x; anchorY = y; lastProgress = f; }
      if (!g.player.dead && f - lastProgress > 360) {
        const bin = Math.floor((x + g.player.w / 2) / 2) * 2;
        softlocks[`${bin}-${bin + 2}`] = (softlocks[`${bin}-${bin + 2}`] || 0) + 1;
        break;
      }
    }
    if (g.completed) { completions++; times.push(+g.time.toFixed(1)); }
  }
  const hot = Object.entries(deaths).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  return { completions: `${completions}/${runs}`, times, softlocks, hotspots: hot };
}

/**
 * Timing forgiveness at one decision point: for each wait frame 0..maxWait after `pre`, can some single
 * action (jump, grapple+hold, or jump then grapple) land in [x0,x1] with feet <= fm (and pass `need`)?
 * Returns the good frames as ranges, e.g. [[12, 27]] = a 16-frame (0.27 s) window.
 */
export function windowR(lvl, pre, x0, x1, fm = 99, { maxWait = 90, need = null } = {}) {
  const ok = [];
  for (let w = 0; w <= maxWait; w++) {
    let good = false;
    const g0 = repR(lvl, [...pre, [w, false]]);
    if (g0.player.dead || g0.deaths) break;
    {
      const g = repR(lvl, [...pre, [w, false], [1, false, null, true]]);
      if (landR(g, x0, x1, fm, need) > 0) good = true;
    }
    if (!good && g0.assistAim().locked)
      for (let h = 4; h <= 120 && !good; h += 4) {
        const g = repR(lvl, [...pre, [w, false], [h, true]]);
        if (!g.player.dead && !g.deaths && landR(g, x0, x1, fm, need) > 0) good = true;
      }
    if (good) ok.push(w);
  }
  const ranges = [];
  for (const w of ok) { const r = ranges[ranges.length - 1]; if (r && w === r[1] + 1) r[1] = w; else ranges.push([w, w]); }
  return ranges;
}

/**
 * Walk a route and measure forgiveness at each step. Steps:
 *   [x0, x1, feetMax, opts?]  land there via the middle of the widest timing window
 *   { grab: check }           fire at the middle of the widest window where check(game) passes 30 frames later
 * Returns per-step { window: frames in the widest range, ranges } and whether the level finished.
 */
export function routeWindows(lvl, steps, { maxWait = 120 } = {}) {
  let pre = [];
  const report = [];
  for (const s of steps) {
    if (s.grab) {
      const good = [];
      for (let w = 0; w <= maxWait; w++) {
        const g0 = repR(lvl, [...pre, [w, false]]);
        if (g0.player.dead || g0.deaths) break;
        if (!g0.assistAim().locked) continue;
        if (s.grab(repR(lvl, [...pre, [w, false], [2, true], [30, false]]))) good.push(w);
      }
      const ranges = [];
      for (const w of good) { const r = ranges[ranges.length - 1]; if (r && w === r[1] + 1) r[1] = w; else ranges.push([w, w]); }
      if (!ranges.length) { report.push({ step: 'grab', window: 0 }); return { ok: false, report }; }
      const best = ranges.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const w = Math.floor((best[0] + best[1]) / 2);
      pre = [...pre, [w, false], [2, true], [1, false]];
      report.push({ step: 'grab', window: best[1] - best[0] + 1, ranges });
      continue;
    }
    const [x0, x1, fm, opts = {}] = s;
    const ranges = windowR(lvl, pre, x0, x1, fm, { maxWait, need: opts.need });
    if (!ranges.length) {
      // fall back to multi-grapple chains (rings) found by stepR
      const r = stepR(lvl, pre, x0, x1, fm, { chain: 3, need: opts.need, maxWait });
      if (!r) { report.push({ step: [x0, x1], window: 0, at: st(repR(lvl, pre)) }); return { ok: false, report }; }
      pre = r.pre;
      report.push({ step: [x0, x1], window: 'chain', how: r.how });
      continue;
    }
    const best = ranges.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    const w = Math.floor((best[0] + best[1]) / 2);
    // find the action at w
    let seg = null;
    const gj = repR(lvl, [...pre, [w, false], [1, false, null, true]]);
    const ij = landR(gj, x0, x1, fm, opts.need);
    if (ij > 0) seg = [[w, false], [1, false, null, true], [ij, false]];
    for (let h = 4; h <= 120 && !seg; h += 4) {
      const g = repR(lvl, [...pre, [w, false], [h, true]]);
      if (g.player.dead || g.deaths) continue;
      const i = landR(g, x0, x1, fm, opts.need);
      if (i > 0) seg = [[w, false], [h, true], [i, false]];
    }
    pre = [...pre, ...seg];
    report.push({ step: [x0, x1], window: best[1] - best[0] + 1, ranges });
  }
  const g = repR(lvl, [...pre, [400, false]]);
  return { ok: g.completed, report, final: st(g) };
}
export { LEVELS }; // for in-memory layout experiments
