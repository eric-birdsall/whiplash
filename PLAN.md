# Whiplash — Plan

An endless 2D grappling-hook runner. The hero never stops running; you jump, double jump, and fire a
grapple at 60° to swing across gaps between floating platforms. One life: go as far and as fast as you can.
Swinging well builds **momentum**, which makes you faster and multiplies your score.

**Audience:** teens and adults. A skill game: quick runs, instant retry, chase your best distance.

## Tech

| Decision | Choice |
|---|---|
| Build | Vite + TypeScript, no runtime dependencies |
| Rendering | Plain Canvas 2D, flat vector shapes (no art assets) |
| Physics | Custom: tile-grid AABB collision + rope distance constraint, fixed 60 Hz step |
| Audio | Synthesized with Web Audio (no files): SFX, plus a looping groove whose layers follow the swing chain. Sound and Music toggles |
| World | Generated on the fly in `src/endless.ts`; the tile grid grows to the right as you run |
| Save | `localStorage` `whiplash.endless.bestScore` (best score), `…bestDist` (farthest metres, seeded from the old `…best`), `…lastDeath` (where the last run ended), `whiplash.music` |
| Hosting | GitHub Pages via Actions workflow; Vite `base: './'`; installable PWA with offline play |

## Controls

**Touch (landscape only):** tap the **left half** of the screen to jump (tap again in the air to double
jump) · tap the **right half** to grapple, hold to swing, release to fling. Faint JUMP / HOOK labels sit
at the bottom corners. Portrait shows a "rotate your device" notice.

**Desktop:** W jump · E or click (anywhere) to grapple, hold to swing · R restart · Esc pause.

**Controller** (Xbox / standard layout, Gamepad API): A or LB jump · RT, RB, X or B grapple, hold to swing ·
View restart · Menu pause. On menus: d-pad or left stick up/down picks a button, left/right sets the
grapple angle, A presses (the main button if none is picked), B resumes. Light rumble on a catch and a
perfect release, a strong one on death. Using a controller swaps the controls line and hides the touch zones.

## Moves

- **Run:** always to the right. The base speed ramps from 7 to 10.5 tiles/s over the first 1,600 m; momentum adds up
  to 2.5 more (so up to 13). Gaps are built for the base speed only, so momentum only ever makes them easier to clear
  (at +2.5 every obstacle stays beatable; some grapple gaps even become double-jumpable, which earns no momentum).
- **Jump:** ≈2.4 tiles high, ≈5.5 tiles long at base speed (double jump adds ≈2.25 more height), with coyote time (0.1 s) and an input buffer (0.12 s).
- **Double jump:** one extra jump in the air, refreshed on landing or when the grapple catches. The hero does a front tuck (one
  forward spin over 0.5 s; cosmetic, cancelled by landing or firing the grapple).
- **Grapple:** no aiming. It always fires up and forward at 60°; if that line would miss, it bends up
  to ±14° toward the nearest-angle thing it can hang from. Rings beat wood. Range 16.5 tiles. A locked shot homes in
  on its (moving) target.
  - Only the **underside of wood** catches it (stone, and the tops and sides of wood, bounce it off).
    Rings work from any angle.
  - Hold to hang while the rope reels in; release to fling. Hanging uses lower gravity (20) for a
    slower, floatier swing.
  - **Forgiving input:** a tap is remembered for 0.25 s while held and fires as soon as the hook is
    ready; an airborne tap with nothing in reach waits (within that time) for a target. Misses snap back
    fast (160 tiles/s, 0.06 s cooldown).
  - A dotted guide line shows where the next grapple will go and rings the target when it's locked.
- **Perfect release:** let go just past the bottom of the swing (rope 0–28° ahead of straight down) for a
  harder fling (+3 forward, +4.5 up), a gold flash and a chime. The rope turns gold while you're in the window
  (about 0.15 s). Releases that early can still fall short on the hardest beams: it's a bonus, not a guarantee.
- **Landing burst:** landing after a swing raises run speed by 4.5 tiles/s, fading out over 0.8 s.
- **Swing chains:** every rope catch and every perfect release since you last touched the ground is a link
  (×2, ×3… pops up from the second link). Landing with 2+ links grows the landing burst (+30% per extra
  link, up to ×2) and adds 5 bonus metres per extra link to the score. A single catch + perfect release is ×2.
- **Momentum** (0–1, `MOM_*` in `src/config.ts`): +0.06 per rope catch, +0.07 more for a perfect release, +0.03 per extra
  link when landing a chain. It drains 0.11/s while you stay on the ground for more than 0.5 s, never in the air.
  It adds run speed and multiplies points: ×1.0 at empty, ×2.0 at full. The HUD shows the multiplier beside the score and a bar
  under it (gold when full); from 25% a trail streams behind the hero, cyan turning gold near full.
- **Score:** every metre and chain bonus metre is worth the multiplier at the moment you earn it.
- **Fail:** falling off the bottom, or being pinned against a wall for 0.45 s, ends the run (no softlocks).

## The course

Each chunk is a floating stone platform (2 tiles thick, open air below) followed by one obstacle:

| Obstacle | Gap (tiles at base speed) | Notes |
|---|---|---|
| **beam** | 11–13 | moving wood beam 8 tiles above the takeoff (near the top of the screen), 2–6 tiles wide (narrow ones more common as difficulty rises); needs the grapple |
| **ring** | 11–12 | ring ~7 tiles above the takeoff; needs the grapple |
| **jump** | 2–4 | |
| **double** | 6–8 | |
| **step** | 0 | a 1–3 tile ledge to hop up (3 needs the double jump) |
| **chain** | 19–21 | two rings ~6.5 tiles above the takeoff, at 27% and 68% of the gap: swing rope to rope. From ~90 m |

- **Everything you grapple moves** (`MOTION` in `src/endless.ts`): a smooth back-and-forth every 2.4–3.4 s from a
  random starting point. Rings bob up and down ±2 tiles (60%) or slide side to side ±2.8. Beams slide up to 7 tiles
  forward of their usual spot (60%) or sink up to 2.2 tiles below their usual height, and come back. They never go further
  back or higher: a beam drifting back toward the takeoff made the widest gaps unbeatable, and higher would leave the screen.
  Motion starts at 60% of that size and reaches full size at full difficulty. A faint dotted line shows each one's path.
  A rope that catches follows its anchor; you can ride on top of a beam, and a beam moving into you shoves you aside.
  Once the grapple locks on, the hook homes in on that spot as it flies, so a moving target can't dodge a locked shot.
- Gaps scale with speed; ledges move up to 1 up or 3 down.
- The first gap is always a beam (~25 m in). Beams are the most common obstacle; rings appear from ~45 m.
  Platforms shorten as difficulty rises (full difficulty at 1,500 m). No three identical obstacles in a row.
- **High route:** 40% of platforms 8+ tiles long (after ~75 m) get a still ring high over them (8.5 tiles up).
  Walking under it is safe; catching it straight out of the last obstacle keeps a chain going instead of landing. The checker confirms it never makes the next obstacle harder (rings beat wood for aim assist, so
  it was worth checking).
- The camera leads 10 tiles so the next landing is on screen.

**Checker (dev only):** `strip()` also takes `genSpeed` (build the gap for one speed, run at another: momentum),
`high` (force the high-route ring) and `plat`.
 `tools/endless-check.js` builds each obstacle at the ends of its ranges, at base
and top speed, and measures the timing window (frames where some jump / double jump / grapple clears it).
Beams are checked at their narrowest and widest. Every variant is beatable; the tightest is 30 frames (~0.5 s, an
11-tile double-jump gap at top speed). Still rings 36+ frames and beams 52+ at top speed. `checkMoving()` checks rings,
beams and chains at full motion from 8 starting points in their motion (both directions) and reports the worst: at top
speed rings 30+, beams 18+ (a narrow sinking beam), chains 19+ frames (base speed: 30+, 35+, 82+). Chains are checked
with two-swing inputs only, and take about 30 s. At base speed a great single swing can sometimes (~5% of tries) skip a chain ring. In the dev page's console:
`(await import('/tools/endless-check.js')).window('beam', { gap: 12, rise: 1, speed: 10.5, move: 1, phase: 0 })`.
The full moving sweep is too slow for the browser console; bundle the checker with esbuild and run it in Node.
`window.__whiplash` (dev builds only) exposes the current run for debugging.

## Look

Flat vector art with a color language: wood (warm brown, bright underside lip) = grabbable;
dark stone = platforms; cyan rings = anchors; gold = perfect releases and full momentum. The hero is an original commando with a grapple gauntlet;
the hook head is an arcade-crane claw that opens in flight and clamps shut when it catches.

## Feel

- **Perfect release:** a quick camera punch-in (no slow motion: tried it, it broke the flow).
- **Zoom:** the view widens with run speed, from 32 × 18 tiles at 8.5 tiles/s to ×1.14 at 13.
- **Speed lines** stream past above 10.5 tiles/s.
- **Course markers:** a gold dashed line and **BEST n m** pennant at your farthest distance, and a faint red line at where the
  last run ended (hidden when within 4 m of the best). Passing the best pops **NEW BEST!** with a fanfare.
- **Music:** A minor (Am F C G), 128 BPM, scheduled ahead on the audio clock. The base layer (kick and bass) plays during a run.
  Each chain link fades in another layer (1: hats and snare, 2: arpeggio, 3: lead), and they ease out when you land. It stops
  on Pause and on death.

## Screen

Landscape, fixed 32 × 18-tile view (zoomed out), letterboxed. The HUD is sized from the screen, not the tiles. Title: **Run**, best distance, controls, and in the
top-left corner "Updated <build time>" plus **Reload latest**. Pause: Resume, Restart, Sound, Music, Menu. Resuming shows the frozen, unblurred run under a 3-2-1 countdown (a blip per number) before play continues.
Both title and pause have a **Grapple angle − / +** playtest option (20–75° in 2.5° steps, default 60°, saved
in `localStorage` `whiplash.aimAngle`; a change from Pause applies to the current run). The checker always uses the default.
Run over: score (and new best), then distance and perfect releases; Run again, Menu. The title shows best score and farthest distance.

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
  level.ts       tile types, world data, moving rings and beams
  render.ts      camera + zoom, tiles, beams, rings, markers, aim guide, rope + claw, trail, speed lines, HUD, touch zones
  hero.ts        the commando: pose and drawing
  claw.ts        the arcade-crane claw
  input.ts       keyboard / mouse / touch / controller → InputState
  audio.ts       synthesized sound effects and layered music
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

Daily seeded run · small goals (×5 chain, 3 perfects in a row) · new zones every ~500 m · spikes or hazards on platforms · enemies to yank · pickups and score multipliers · gamepad ·
leaderboards.
