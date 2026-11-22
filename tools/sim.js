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

// ---------- Runner mode (auto-run right, jump, ceiling-only grapple, touch rule) ----------
// Segments: [frames, hookHeld, aim?, jumpOnFirstFrame?]. moveX is always 1.
// Touch rule: hook taps must land right of the camera center (the right half of the screen).

export const mkR = (i) => { const g = mk(i); g.ceilingOnly = true; return g; };
export const camCenter = (g) => g.w <= 24 ? g.w / 2 : Math.max(12, Math.min(g.w - 12, g.center().x + 1.5));

export function repR(lvl, segs) {
  const g = mkR(lvl);
  for (const [n, hold, aim, j] of segs)
    for (let i = 0; i < n; i++) g.update(DT, 1, hold, hold && i === 0, aim || NONE, !!j && i === 0);
  return g;
}

function landR(g, x0, x1, fm) {
  for (let i = 0; i < 240; i++) {
    g.update(DT, 1, false, false, NONE, false);
    if (g.player.dead) return -1;
    if (g.player.grounded) { const s = st(g); return s.x >= x0 && s.x <= x1 && s.feet <= fm ? i + 1 : -1; }
  }
  return -1;
}

/** Find wait + (jump | hook+hold) that lands grounded with center in [x0,x1] and feet <= fm. */
export function stepR(lvl, pre, x0, x1, fm = 99, { maxWait = 90 } = {}) {
  for (let w = 0; w <= maxWait; w += 3) {
    {
      const g = repR(lvl, [...pre, [w, false], [1, false, null, true]]);
      const i = landR(g, x0, x1, fm);
      if (i > 0) return { pre: [...pre, [w, false], [1, false, null, true], [i, false]], how: ['jump', w] };
    }
    const g0 = repR(lvl, [...pre, [w, false]]);
    if (g0.player.dead) break;
    const c = g0.center();
    for (let ax = Math.ceil(camCenter(g0)); ax <= c.x + 9; ax++)
      for (let ay = Math.floor(c.y - 9); ay <= c.y + 2; ay++) {
        if (Math.hypot(ax - c.x, ay - c.y) > 9.5) continue;
        for (let h = 6; h <= 120; h += 6) {
          const aim = { x: ax + 0.01, y: ay + 0.01 };
          const g = repR(lvl, [...pre, [w, false], [h, true, aim]]);
          if (g.player.dead) continue;
          const i = landR(g, x0, x1, fm);
          if (i > 0) return { pre: [...pre, [w, false], [h, true, aim], [i, false]], how: ['hook', w, ax, ay, h] };
        }
      }
  }
  return null;
}

/** Tap a target (key / lever) as soon as it is tappable and `check(game)` passes 30 frames later. */
export function scanR(lvl, pre, aim, check, maxWait = 90) {
  for (let n = 0; n <= maxWait; n += 2) {
    const g0 = repR(lvl, [...pre, [n, false]]);
    if (aim.x <= camCenter(g0)) continue;
    const p2 = [...pre, [n, false], [2, true, aim], [1, false]];
    if (check(repR(lvl, [...p2, [30, false]]))) return p2;
  }
  return null;
}
