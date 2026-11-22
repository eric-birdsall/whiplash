# Whiplash — Plan

An endless 2D grappling-hook runner. The hero never stops running; you jump, double jump, and fire a
grapple at 45° to swing across gaps between floating platforms. One life: go as far as you can.

**Audience:** teens and adults. A skill game: quick runs, instant retry, chase your best distance.

## Tech

| Decision | Choice |
|---|---|
| Build | Vite + TypeScript, no runtime dependencies |
| Rendering | Plain Canvas 2D, flat vector shapes (no art assets) |
| Physics | Custom: tile-grid AABB collision + rope distance constraint, fixed 60 Hz step |
| Audio | Synthesized with Web Audio (no files). SFX only, mute toggle. No music |
| World | Generated on the fly in `src/endless.ts`; the tile grid grows to the right as you run |
| Save | `localStorage` `whiplash.endless.best` (best distance) |
| Hosting | GitHub Pages via Actions workflow; Vite `base: './'`; installable PWA with offline play |

## Controls

**Touch (landscape only):** tap the **left half** of the screen to jump (tap again in the air to double
jump) · tap the **right half** to grapple, hold to swing, release to fling. Faint JUMP / HOOK labels sit
at the bottom corners. Portrait shows a "rotate your device" notice.

**Desktop:** Space / W / ↑ jump · click (anywhere), Shift, K or J to grapple, hold to swing · R restart · Esc pause.

## Moves

- **Run:** always to the right. Speed ramps from 7 to 10.5 tiles/s over the first 1,600 m.
- **Jump:** ≈2.4 tiles high, ≈5.5 tiles long at base speed (double jump adds ≈2.25 more height), with coyote time (0.1 s) and an input buffer (0.12 s).
- **Double jump:** one extra jump in the air, refreshed on landing or when the grapple catches.
- **Grapple:** no aiming. It always fires up and forward at 45°; if that line would miss, it bends up
  to ±14° toward the nearest-angle thing it can hang from. Rings beat wood. Range 11 tiles.
  - Only the **underside of wood** catches it (stone, and the tops and sides of wood, bounce it off).
    Rings work from any angle.
  - Hold to hang while the rope reels in; release to fling. Hanging uses lower gravity (20) for a
    slower, floatier swing.
  - **Forgiving input:** a tap is remembered for 0.25 s while held and fires as soon as the hook is
    ready; an airborne tap with nothing in reach waits (within that time) for a target. Misses snap back
    fast (160 tiles/s, 0.06 s cooldown).
  - A dotted guide line shows where the next grapple will go and rings the target when it's locked.
- **Fail:** falling off the bottom, or being pinned against a wall for 0.45 s, ends the run (no softlocks).

## The course

Each chunk is a floating stone platform (2 tiles thick, open air below) followed by one obstacle:

| Obstacle | Gap (tiles at base speed) | Notes |
|---|---|---|
| **beam** | 11–13 | hanging wood beam ~6 tiles above the takeoff; needs the grapple |
| **ring** | 11–12 | ring ~5 tiles above the takeoff; needs the grapple |
| **jump** | 2–4 | |
| **double** | 6–8 | |
| **step** | 0 | a 1–3 tile ledge to hop up (3 needs the double jump) |

- Gaps scale with speed; ledges move up to 1 up or 3 down.
- The first gap is always a beam (~25 m in). Beams are the most common obstacle; rings appear from ~45 m.
  Platforms shorten as difficulty rises (full difficulty at 1,500 m). No three identical obstacles in a row.
- The camera leads 10 tiles so the next landing is on screen.

**Checker (dev only):** `tools/endless-check.js` builds each obstacle at the ends of its ranges, at base
and top speed, and measures the timing window (frames where some jump / double jump / grapple clears it).
Every variant is beatable; the tightest is 23 frames (~0.38 s, a 13-tile beam at top speed). In the dev page's console:
`(await import('/tools/endless-check.js')).window('beam', { gap: 12, rise: 1, speed: 10.5 })`.
`window.__whiplash` (dev builds only) exposes the current run for debugging.

## Look

Flat vector art with a color language: wood (warm brown, bright underside lip) = grabbable;
dark stone = platforms; cyan rings = anchors. The hero is an original commando with a grapple gauntlet;
the hook head is an arcade-crane claw that opens in flight and clamps shut when it catches.

## Screen

Landscape, fixed 32 × 18-tile view (zoomed out), letterboxed. The HUD is sized from the screen, not the tiles. Title: **Run**, best distance, controls, and in the
top-left corner "Updated <build time>" plus **Reload latest**. Pause: Resume, Restart, Sound, Menu.
Run over: distance (and new best), Run again, Menu.

## Install & offline (PWA)

- `public/manifest.webmanifest`: name, fullscreen, landscape, icons (192, 512, maskable 512).
- iOS: `apple-touch-icon` (180), `apple-mobile-web-app-capable`, `black-translucent` status bar, title.
- Service worker: `vite.config.ts` writes `dist/sw.js` after each build, precaching every output file.
  The cache name is a hash of all files, so each deploy replaces the old cache. Pages are fetched
  network-first with `cache: 'no-cache'` (3 s timeout) so new deploys show up; hashed assets load cache-first.
  It's registered only in production builds (`npm run dev` has no service worker).
- **Reload latest** unregisters the service worker, clears caches, refreshes the HTTP cache and reloads.
  It does nothing when offline, so the saved copy isn't lost.
- Icons are drawn by `tools/make_icons.py` (Pillow): `python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python tools/make_icons.py`.
- On iPhone: Safari → Share → Add to Home Screen. The home-screen app's best score is separate from Safari's.

## Code layout

```
src/
  main.ts        screens, game loop, PWA registration
  endless.ts     course generator (EndlessGen) and run controller (EndlessRun)
  game.ts        simulation: running, jumps, grapple, rope, fail checks
  physics.ts     AABB vs tile grid, raycasts
  level.ts       tile types and world data
  render.ts      camera, tiles, rings, aim guide, rope + claw, HUD, touch zones
  hero.ts        the commando: pose and drawing
  claw.ts        the arcade-crane claw
  input.ts       keyboard / mouse / touch → InputState
  audio.ts       synthesized sound effects
  config.ts      every tuning constant
tools/
  endless-check.js  obstacle checker (dev only)
  make_icons.py     app icon generator
```

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

GitHub Pages: pushing to `main` builds and deploys via `.github/workflows/deploy.yml`.

## Later

Music · spikes or hazards on platforms · enemies to yank · pickups and score multipliers · gamepad ·
leaderboards.
