import * as C from './config';
import { Input } from './input';
import { Renderer } from './render';
import { Audio } from './audio';
import { EndlessRun } from './endless';
import type { Game } from './game';

type Screen = 'title' | 'play' | 'dying' | 'pause' | 'countdown' | 'over';

/** Seconds of 3-2-1 over the frozen (unblurred) run before play resumes after a pause. */
const RESUME_COUNT = 3;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new Audio();

let screen: Screen = 'title';

// Grapple angle (degrees): a playtest option on the title and pause screens, saved between visits.
const ANGLE_KEY = 'whiplash.aimAngle';
const ANGLE_DEFAULT = (C.AUTO_AIM_ANGLE * 180) / Math.PI;
const ANGLE_MIN = 20, ANGLE_MAX = 75, ANGLE_STEP = 2.5;
let aimDeg = Number(localStorage.getItem(ANGLE_KEY)) || ANGLE_DEFAULT;
/** The current run. A fresh one sits behind the title screen as a backdrop. */
let run = newRun();

input.onFirstGesture = () => audio.unlock();

/** Set the grapple angle (snapped to the step, clamped) and refresh every − value + control. */
function setAimDeg(d: number) {
  aimDeg = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, Math.round(d / ANGLE_STEP) * ANGLE_STEP));
  localStorage.setItem(ANGLE_KEY, String(aimDeg));
  run.game.aimAngle = (aimDeg * Math.PI) / 180; // applies to the current run too (e.g. from Pause)
  for (const el of document.querySelectorAll('.angle-val')) el.textContent = `${aimDeg}°`;
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-action=angle-down]')) el.disabled = aimDeg <= ANGLE_MIN;
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-action=angle-up]')) el.disabled = aimDeg >= ANGLE_MAX;
}

function newRun(): EndlessRun {
  const r = new EndlessRun((s) => {
    audio.play(s);
    if (s === 'attach') input.rumble(0, 0.35, 60);
    else if (s === 'perfect') { input.rumble(0.2, 0.5, 90); renderer.punch(); }
    else if (s === 'death') input.rumble(0.8, 0.6, 280);
  });
  r.game.aimAngle = (aimDeg * Math.PI) / 180;
  renderer.resize();
  renderer.snapCamera(r.game);
  return r;
}

// ---------- Screens ----------

const $ = (id: string) => document.getElementById(id)!;
const screens: Record<'title' | 'pause' | 'over', HTMLElement> = { title: $('title'), pause: $('pause'), over: $('over') };

function show(s: Screen) {
  const from = screen;
  screen = s;
  setPadFocus(null);
  (document.activeElement as HTMLElement | null)?.blur?.(); // Space must never click a menu button mid-run
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== s);
  $('pause-btn').classList.toggle('hidden', s !== 'play' && s !== 'countdown');
  $('countdown').classList.toggle('hidden', s !== 'countdown');
  if (s === 'countdown') { countdownEnd = performance.now() + RESUME_COUNT * 1000; countdownShown = -1; }
  // Leaving the countdown keeps what's held, so the player can already be holding grapple when play resumes.
  if (!(from === 'countdown' && s === 'play')) input.releaseAll();
  if (s === 'pause') { $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`; $('music-btn').textContent = `Music: ${audio.musicOn ? 'on' : 'off'}`; }
  if (s === 'title') $('title-best').textContent = run.best > 0 ? `Best: ${run.best}  ·  farthest ${run.bestDist} m` : '';
  // The groove plays only while running (and during the resume countdown, so it's already going).
  if (s === 'play' || s === 'countdown') audio.startMusic(); else audio.stopMusic();
}

let countdownEnd = 0;
let countdownShown = -1;

/** Pause → play goes through a 3-2-1 over the live scene so the player can find their place first. */
function resume() { show('countdown'); }

/** Update the countdown number (with a blip and a pop as each one appears); starts play at zero. */
function tickCountdown(now: number) {
  const left = Math.ceil((countdownEnd - now) / 1000);
  if (left <= 0) { audio.countdown(true); show('play'); return; }
  if (left === countdownShown) return;
  countdownShown = left;
  const el = $('countdown');
  el.textContent = String(left);
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
  audio.countdown(false);
}

function startRun() {
  run = newRun();
  show('play');
}

function onRunOver() {
  const d = run.score, dist = run.distance, g = run.game;
  const farther = dist > run.bestDist && run.bestDist > 0;
  const best = run.finish();
  $('over-stats').textContent = best ? `${d}   — new best!` : `${d}   (best ${run.best})`;
  const bits = [`${dist} m${farther ? ' (farthest yet)' : ''}`, `${g.perfects} perfect`];
  $('over-detail').textContent = bits.join('  ·  ');
  show('over');
}

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest('button')?.dataset.action;
  if (!action) return;
  audio.unlock();
  switch (action) {
    case 'play': startRun(); break;
    case 'title': run = newRun(); show('title'); break;
    case 'resume': resume(); break;
    case 'restart': startRun(); break;
    case 'hard-reload': hardReload(); break;
    case 'angle-down': setAimDeg(aimDeg - ANGLE_STEP); break;
    case 'angle-up': setAimDeg(aimDeg + ANGLE_STEP); break;
    case 'mute': audio.setMuted(!audio.muted); $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`; break;
    case 'music': audio.setMusicOn(!audio.musicOn); $('music-btn').textContent = `Music: ${audio.musicOn ? 'on' : 'off'}`; break;
  }
});
// ---------- Controller on menus ----------
// D-pad / left stick up-down moves between buttons, left-right sets the grapple angle, A presses
// (the highlighted button, else the main one), B resumes from Pause. Menu toggles Pause in the loop.

let padFocus: HTMLButtonElement | null = null;
function setPadFocus(b: HTMLButtonElement | null) {
  padFocus?.classList.remove('pad-focus');
  padFocus = b;
  b?.classList.add('pad-focus');
}

function padOnMenu() {
  if (screen !== 'title' && screen !== 'pause' && screen !== 'over') return;
  const p = input.padMenu, el = screens[screen];
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button:not(.link)')].filter((b) => !b.closest('.stepper'));
  if (p.up || p.down) {
    const i = padFocus ? buttons.indexOf(padFocus) : -1;
    setPadFocus(i < 0 ? buttons[0] : buttons[(i + (p.down ? 1 : -1) + buttons.length) % buttons.length]);
  }
  if (el.querySelector('.stepper')) {
    if (p.left) setAimDeg(aimDeg - ANGLE_STEP);
    if (p.right) setAimDeg(aimDeg + ANGLE_STEP);
  }
  if (p.confirm) (padFocus ?? el.querySelector<HTMLButtonElement>('button.primary'))?.click();
  else if (p.back && screen === 'pause') resume();
}

$('pause-btn').addEventListener('pointerdown', (e) => { e.stopPropagation(); show('pause'); });

/** Throw away the offline cache and service worker, then load the newest deploy from the network. */
async function hardReload() {
  const el = $('build-info');
  if (!navigator.onLine) { el.textContent = "You're offline: keeping the saved copy"; return; }
  el.textContent = 'Reloading…';
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    // Refresh the browser's HTTP cache too (GitHub Pages serves pages with a 10-minute max-age).
    await fetch(location.href, { cache: 'reload' });
  } catch { /* reload anyway */ }
  location.reload();
}

function showBuildInfo() {
  const d = new Date(__BUILD_TIME__);
  const when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('build-info').textContent = `Updated ${when}`;
}

// ---------- Orientation ----------

function checkOrientation() {
  const touch = input.touchMode;
  document.body.classList.toggle('touch', touch);
  const block = touch && innerHeight > innerWidth;
  $('rotate').classList.toggle('hidden', !block);
  if (block && (screen === 'play' || screen === 'countdown')) show('pause');
}

addEventListener('resize', () => { renderer.resize(); checkOrientation(); });
addEventListener('orientationchange', () => setTimeout(() => { renderer.resize(); checkOrientation(); }, 100));
document.addEventListener('visibilitychange', () => { if (document.hidden && (screen === 'play' || screen === 'countdown')) show('pause'); });
canvas.addEventListener('pointerdown', () => checkOrientation());

// ---------- Loop ----------

let last = performance.now();
let acc = 0;
/** Did this frame run at least one physics step (and so consume the presses)? */
let stepped = true;

/** Positions before the latest physics step, for render interpolation. */
type Snap = { game: Game; px: number; py: number; hook: string; hx: number; hy: number };
function snapshot(g: Game): Snap {
  const h = g.hook;
  return { game: g, px: g.player.x, py: g.player.y, hook: h.kind, hx: h.kind === 'idle' ? 0 : h.x, hy: h.kind === 'idle' ? 0 : h.y };
}
let prev: Snap = snapshot(run.game);

/** Move the player (and a moving hook) to `alpha` of the way from `from` to now. Returns an undo. */
function interpolate(g: Game, from: Snap, alpha: number): () => void {
  if (from.game !== g || alpha >= 1) return () => {};
  const p = g.player, h = g.hook;
  const px = p.x, py = p.y;
  p.x = from.px + (px - from.px) * alpha;
  p.y = from.py + (py - from.py) * alpha;
  if (h.kind === 'idle' || h.kind !== from.hook) return () => { p.x = px; p.y = py; };
  const hx = h.x, hy = h.y;
  h.x = from.hx + (hx - from.hx) * alpha;
  h.y = from.hy + (hy - from.hy) * alpha;
  return () => { p.x = px; p.y = py; h.x = hx; h.y = hy; };
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll();
  const st = input.state;
  const game = run.game;
  if (input.padActivity) audio.unlock();
  if (document.body.classList.contains('pad') !== input.padMode) document.body.classList.toggle('pad', input.padMode);

  if (screen === 'play') {
    if (st.pause) show('pause');
    else if (st.restart) startRun();
    else {
      acc += dt;
      let pressed = st.hookPressed;
      let jump = st.jumpPressed;
      stepped = false;
      while (acc >= C.STEP) {
        stepped = true;
        prev = snapshot(game);
        run.tick();
        game.update(C.STEP, st.hookDown, pressed, jump);
        pressed = jump = false;
        acc -= C.STEP;
      }
      // More of the groove the longer the chain; back to the base beat on landing.
      audio.setMusicLevel(Math.min(3, game.links));
      if (game.player.dead) {
        screen = 'dying'; // let the burst play, then show the score
        audio.stopMusic();
        setTimeout(() => { if (screen === 'dying') onRunOver(); }, 900);
      }
    }
  } else if (st.pause && screen === 'pause') {
    resume();
  } else if (screen === 'countdown') {
    acc = 0;
    if (st.pause) show('pause');
    else if (st.restart) startRun();
    else tickCountdown(now);
  } else {
    padOnMenu();
    acc = 0;
    if (screen === 'dying') game.update(dt, false, false, false); // particles only
  }

  // Draw between the last two physics steps so motion is smooth on any refresh rate.
  // (Snapping to the latest step makes the hero judder against the camera, which reads as blur.)
  const restore = interpolate(run.game, prev, screen === 'play' ? acc / C.STEP : 1);
  renderer.updateCamera(run.game, dt);
  renderer.draw(run.game, {
    aim: screen === 'play' ? run.game.assistAim() : null,
    touch: input.touchMode && !input.padMode && (screen === 'play' || screen === 'dying' || screen === 'countdown'),
    zones: input.heldZones(),
    markers: {
      best: run.bestDist > 0 ? { x: run.xAt(run.bestDist), m: run.bestDist } : undefined,
      last: run.lastDeath > 0 ? { x: run.xAt(run.lastDeath), m: run.lastDeath } : undefined,
    },
  });
  restore();
  input.clearEdges(stepped || screen !== 'play');
  requestAnimationFrame(frame);
}

// Dev only: a console handle for debugging and screenshots.
if (import.meta.env.DEV) (window as unknown as { __whiplash: object }).__whiplash = { get game() { return run.game; }, get run() { return run; }, renderer };

// Offline play (iPhone "Add to Home Screen"): the service worker is generated by the production build.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}

showBuildInfo();
setAimDeg(aimDeg);
renderer.resize();
checkOrientation();
show('title');
requestAnimationFrame(frame);
