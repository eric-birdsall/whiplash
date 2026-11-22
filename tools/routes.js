// Reference Runner-mode routes for the timing-window report (dev only). See tools/sim.js routeWindows().
// Each step: [x0, x1, feetMax, opts?] = land there; { grab } = fire when it makes check(game) true.
export const ROUTES = {
  0: [[9.4, 14.6, 9.05], [19.4, 24.6, 9.05], [32.4, 37.6, 9.05], [38.4, 46, 7.05]],
  1: [[15.5, 21.5, 11.05], [22.5, 27.5, 8.05], [40.5, 46.5, 8.05], [46.5, 55, 7.05]],
  2: [
    [9, 12.9, 12.05, { need: (g) => g.player.keys > 0 }],
    [25.2, 27.9, 8.05],
    [40.5, 49, 8.05, { need: (g) => g.keys.every((k) => k.collected) }],
  ],
  3: [[13, 15.2, 12.05], [17.3, 23.3, 11.95], { grab: (g) => g.levers[0].on }, [42, 51, 12.05]],
  4: [
    [10.3, 13.8, 13.05], [14.3, 19.6, 12.05], [38.3, 41.8, 10.05],
    [48.3, 50.6, 10.05, { need: (g) => g.keys[0].collected }],
    { grab: (g) => g.levers[0].on },
  ],
};

/** Timing windows (frames) for every step of every level; 60 frames = 1 s. */
export async function windowsAll(levels = [0, 1, 2, 3, 4]) {
  const S = await import('/tools/sim.js?' + Date.now());
  const out = {};
  for (const l of levels) {
    const r = S.routeWindows(l, ROUTES[l], { maxWait: 240 });
    out['L' + (l + 1)] = { ok: r.ok, windows: r.report.map((x) => x.window), stuck: r.report.filter((x) => x.window === 0).map((x) => x.at) };
  }
  return out;
}
