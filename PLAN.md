# Whiplash — MVP Plan

A 2D grappling-hook platformer. Swing from the hook, reel yourself in, and yank things to you.
Two modes: **Runner** (always running, tap to jump, time your grapples) and **Classic** (free movement, no jump).

**Audience:** teens and adults. A skill game — you can fall and die, retry instantly.

## Tech

| Decision | Choice |
|---|---|
| Build | Vite + TypeScript, no runtime dependencies |
| Rendering | Plain Canvas 2D, flat vector shapes (no art assets) |
| Physics | Custom: tile-grid AABB collision + rope distance constraint, fixed 60 Hz step |
| Audio | Synthesized with Web Audio (no files). SFX only, mute toggle. No music in MVP |
| Levels | ASCII tile maps in `src/levels/` |
| Save | `localStorage` (unlocked levels, best deaths/time) |
| Hosting | GitHub Pages via Actions workflow; Vite `base: './'` so it works under any subpath |

## Modes

Toggle on the title and pause screens (saved in `localStorage` as `whiplash.mode`). Both modes share levels and saves.

- **Runner (default):** the hero always runs right. You time jumps and grapples. Hanging on the rope
  still pumps the swing forward. Jump ≈ 1.5 tiles high and ≈ 4.4 tiles long, with coyote time (0.1 s)
  and an input buffer (0.12 s).
- **Classic:** move freely, no jump. The original puzzle-platformer design.

Keys are collected by hooking them *or* by touching them (e.g. jumping through a floating key).

**Fixed 45° grapple with aim assist (Runner):** no aiming. Every grapple fires up and forward at 45°.
If that line would miss, it bends up to ±14° toward the nearest-angle grabbable thing (wood ceiling,
ring, key, crate, lever). Hook range is 11 tiles in Runner (9 in Classic). A dotted guide line shows
where the next grapple will go and rings the target when it's locked, so the game is all about timing.
Level rule: anything you need to grab must sit up-and-ahead of where you'll be, near that 45° line.
Keys can also be placed in a swing's path and collected by touch.

**Ceiling-only grapple (Runner):** wood only catches the hook on its *underside*: you grapple ceilings,
not ledge tops or walls (those clank off like metal). Rings work from any angle; keys, crates and levers
still get pulled. Runner levels therefore need wood ceilings (or rings) wherever a climb is higher than a jump.
Classic mode still grips any wood face.

## Controls

**Runner, desktop:** Space / W / ↑ jump · click (anywhere) or Shift / K to grapple, hold to stay attached · R restart · Esc pause.

**Runner, mobile:** tap the **left half** of the screen to jump · tap the **right half** to grapple
(where you tap doesn't matter), hold to stay attached. Faint JUMP / HOOK labels sit at the bottom corners.

**Classic, desktop:** A/D or ←/→ move · click aims & fires the hook, hold to stay attached · R restart · Esc pause.

**Classic, mobile (landscape only):** big ◀ ▶ buttons bottom-left · tap anywhere else fires the hook toward that
point, hold to stay attached · multitouch so you can hold ▶ while hooking.

Portrait shows a "rotate your device" notice. Touch controls appear only on touch devices.

Input is a thin layer producing `{ moveX, hookDown, hookPressed, jumpPressed, aimScreen }`, so gamepad can be added later.

In Classic: **no jump.** Ever.

## The hook

- Fires as a fast projectile in the aim direction, max range ~9 tiles. Hits the first thing on its path.
- **What it does on hit** (color language in brackets):
  - **Wood** tiles `[warm brown]` and **rings** `[glowing]` → **anchor**.
  - **Metal** tiles, doors, gates `[cool gray]` → slick, the hook bounces back.
  - **Light objects** — keys, crates `[gold]` → yanked to you (commits even if you let go).
  - **Lever** → flips it, hook returns.
  - Nothing within range → hook returns.
- **Mass rule:** light objects come to you; heavy/fixed things (tiles, rings) pull *you* to them.
- **While anchored (hold):** the rope reels in steadily to a short minimum length. Left/right pumps the
  swing. **Release** to let go and keep all your momentum (fling). Rope is a one-sided distance constraint
  (can go slack, never stretches).
- **Mantle:** if you're reeled against a wall and the anchor is at that ledge's top, you pop up onto
  the ledge. This is how you climb, and it handles small steps too (the player is 1.25 tiles tall).
- After the hook returns there's a tiny cooldown (~0.15 s).
- **Aim preview (desktop):** a dotted line to the cursor shows what the hook would hit, colored by material.
- **Pulled crates** are dragged horizontally (gravity still on) until something blocks them, so they fall
  into gaps. At rest, crates ease onto the tile grid and prefer dropping into a hole they fit.
- **Auto step-up** of ≤0.3 tiles so you can walk over a crate bridge sitting a hair below the floor.

## World

| Char | Thing |
|---|---|
| `#` | Wood — solid, hookable. **Only used where it can be grabbed:** a tile with open air below (a ceiling underside) |
| `%` | Stone — plain solid ground for floors and walls. Never grips in Runner; grips like wood in Classic |
| `=` | Metal — solid, slick |
| `^` | Spikes — kill on touch, not solid |
| `o` | Ring anchor |
| `K` | Key — pull to collect |
| `D` | Locked door — solid metal; touch it holding a key to open (connected `D`s are one door) |
| `C` | Crate — gravity box; pull it or push it (slowly). Fills gaps, holds plates |
| `P` | Pressure plate — pressed by player or crate. Put plates at the bottom of a 1-wide hole so the crate drops in flush and doesn't block the (jumpless) path |
| `L` | Lever — hook it to toggle |
| `G` | Gate — solid metal; open while **all** plates are pressed and **all** levers are on |
| `S` | Player start |
| `F` | Checkpoint flag |
| `E` | Exit flag — touch to finish |

Falling off the bottom of the map is death. Crates that fall out of the world return to their start.

## Failure

- Spikes and pits kill. ~0.5 s respawn at the last checkpoint, no lives.
- Objects reset to the snapshot taken when the checkpoint was reached → no softlocks.
- HUD death counter.

## Screen

- Fixed virtual view of 24 × 13.5 tiles (16:9), scaled to fit, letterboxed.
- Camera follows the player smoothly, clamped to level bounds.

## Levels (MVP = 5)

1. **First Swing** — wood ceiling, swing over spike pits, mantle up a ledge.
2. **Slick** — metal everywhere; find the wood patches and rings.
3. **Fetch** — keys over chasms, locked doors.
4. **Heavy Lifting** — crates as bridges and plate weights, a lever, a gate.
5. **Everything** — combines all of it.

Title screen → level select (unlocks in order) → play → level complete (deaths, time) → next.

## Code layout

```
src/
  main.ts        boot, fixed-step loop, screen state
  config.ts      all tuning constants
  input.ts       keyboard / mouse / touch → InputState
  level.ts       ASCII parse → Level (tiles + object list)
  levels/        the five maps
  physics.ts     AABB vs tile collision, raycast
  game.ts        world state, player, hook, objects, triggers, death/respawn
  render.ts      canvas drawing, camera, particles, touch buttons
  audio.ts       synthesized SFX
  ui.ts          DOM menus (title, select, pause, complete, rotate notice)
  save.ts        localStorage
```

## Install & offline (PWA)

- `public/manifest.webmanifest`: name, fullscreen, landscape, icons (192, 512, maskable 512).
- iOS: `apple-touch-icon` (180), `apple-mobile-web-app-capable`, `black-translucent` status bar, title.
- Service worker: `vite.config.ts` writes `dist/sw.js` after each build, precaching every output file.
  The cache name is a hash of all files, so each deploy replaces the old cache. Pages load
  network-first (3 s timeout) so new deploys show up; hashed assets load cache-first.
  It's registered only in production builds (`npm run dev` has no service worker).
- Icons are drawn by `tools/make_icons.py` (Pillow): `python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python tools/make_icons.py`.
- Title screen top-left: "Updated <build time>" (baked in at build, shown in local time) and
  **Reload latest**, which unregisters the service worker, clears caches, refreshes the HTTP cache and
  reloads. It does nothing when offline, so the saved copy isn't lost.
- On iPhone: open the site in Safari → Share → Add to Home Screen. Saves made in the home-screen app
  are separate from Safari's.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

GitHub Pages: push to `main` on a GitHub repo and set Settings → Pages → Source to **GitHub Actions**;
`.github/workflows/deploy.yml` builds and deploys.

**Level solver (dev only):** `tools/sim.js` runs the real simulation headlessly from the dev page's console
and brute-forces swings, to check a level is still solvable after tuning. See the header comment in that file.
Every MVP level has been solved with it.

## Out of scope for MVP (later)

Rope wrapping around corners · enemies · gamepad · music · character sprites · level editor / Tiled ·
speedrun timer leaderboards.
