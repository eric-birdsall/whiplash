import * as C from './config';
import { Game } from './game';
import { parseLevel } from './level';
import { LEVELS } from './levels';
import { Input } from './input';
import { Renderer, formatTime } from './render';
import { Audio } from './audio';
import { loadSave, recordWin } from './save';

type Screen = 'title' | 'select' | 'play' | 'won' | 'pause' | 'complete';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new Audio();
const save = loadSave();

let screen: Screen = 'title';
let levelIndex = 0;
// Runner mode (default): always run right, tap to jump. Classic: move freely, no jump.
const MODE_KEY = 'whiplash.mode';
let runner = localStorage.getItem(MODE_KEY) !== 'classic';
let game = makeGame(0);
let mouseSeen = false;

/** Mode-specific rules on a game instance. */
function applyRules(g: Game) {
  g.ceilingOnly = runner;
  g.hookRange = runner ? C.RUNNER_HOOK_RANGE : C.HOOK_RANGE;
}

function applyMode() {
  input.runner = runner;
  document.body.classList.toggle('runner', runner);
  $('tagline').textContent = runner ? 'Never stop running.' : 'No jump. Just the hook.';
  document.querySelectorAll('.mode-btn').forEach((b) => { b.textContent = `Mode: ${runner ? 'Runner' : 'Classic'}`; });
}

input.onFirstGesture = () => audio.unlock();
canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouseSeen = true; });

function makeGame(i: number): Game {
  const g = new Game(parseLevel(LEVELS[i]), (s) => audio.play(s));
  applyRules(g);
  renderer.resize();
  renderer.snapCamera(g);
  return g;
}

// ---------- Screens ----------

const $ = (id: string) => document.getElementById(id)!;
const screens: Record<Exclude<Screen, 'play' | 'won'>, HTMLElement> = {
  title: $('title'), select: $('select'), pause: $('pause'), complete: $('complete'),
};

function show(s: Screen) {
  screen = s;
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== s);
  $('pause-btn').classList.toggle('hidden', s !== 'play');
  input.releaseAll();
  if (s === 'select') buildLevelList();
  if (s === 'pause') $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
}

function startLevel(i: number) {
  levelIndex = i;
  game = makeGame(i);
  show('play');
}

function buildLevelList() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    const best = save.best[i];
    b.disabled = i > save.unlocked;
    b.innerHTML = `<span>${i + 1}. ${lv.name}</span><small>${
      best ? `☠ ${best.deaths} · ${formatTime(best.time)}` : i > save.unlocked ? 'locked' : 'not cleared'
    }</small>`;
    b.onclick = () => startLevel(i);
    list.appendChild(b);
  });
}

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest('button')?.dataset.action;
  if (!action) return;
  audio.unlock();
  switch (action) {
    case 'play': startLevel(Math.min(save.unlocked, LEVELS.length - 1)); break;
    case 'select': show('select'); break;
    case 'title': show('title'); break;
    case 'resume': show('play'); break;
    case 'restart-level': startLevel(levelIndex); break;
    case 'hard-reload': hardReload(); break;
    case 'mode': runner = !runner; localStorage.setItem(MODE_KEY, runner ? 'runner' : 'classic'); applyMode(); applyRules(game); break;
    case 'mute': audio.setMuted(!audio.muted); $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`; break;
    case 'next': startLevel(Math.min(levelIndex + 1, LEVELS.length - 1)); break;
    case 'replay': startLevel(levelIndex); break;
  }
});
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
  } catch { /* reload anyway */ }
  location.reload();
}

function showBuildInfo() {
  const d = new Date(__BUILD_TIME__);
  const when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('build-info').textContent = `Updated ${when}`;
}

function onComplete() {
  recordWin(save, levelIndex, game.deaths, game.time, LEVELS.length);
  const last = levelIndex >= LEVELS.length - 1;
  $('complete-stats').textContent = `☠ ${game.deaths}   ⏱ ${formatTime(game.time)}${last ? '   — you finished every level!' : ''}`;
  ($('next-btn') as HTMLButtonElement).classList.toggle('hidden', last);
  show('complete');
}

// ---------- Orientation ----------

function checkOrientation() {
  const touch = input.touchMode;
  document.body.classList.toggle('touch', touch);
  const portrait = innerHeight > innerWidth;
  const block = touch && portrait;
  $('rotate').classList.toggle('hidden', !block);
  if (block && screen === 'play') show('pause');
}

addEventListener('resize', () => { renderer.resize(); checkOrientation(); });
addEventListener('orientationchange', () => setTimeout(() => { renderer.resize(); checkOrientation(); }, 100));
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'play') show('pause'); });
canvas.addEventListener('pointerdown', () => checkOrientation());

// ---------- Loop ----------

let last = performance.now();
let acc = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll();
  const st = input.state;

  if (screen === 'play') {
    if (st.pause) show('pause');
    else {
      if (st.restart) { game.restart(); renderer.snapCamera(game); }
      acc += dt;
      let pressed = st.hookPressed;
      let jump = st.jumpPressed;
      while (acc >= C.STEP) {
        const aim = runner ? game.assistAim() : renderer.screenToWorld(st.aimX, st.aimY);
        const wasDead = game.player.dead;
        game.update(C.STEP, runner ? 1 : st.moveX, st.hookDown, pressed, aim, runner && jump);
        if (wasDead && !game.player.dead) renderer.snapCamera(game);
        pressed = false;
        jump = false;
        acc -= C.STEP;
      }
      if (game.completed && screen === 'play') {
        // Let the win burst play for a beat.
        screen = 'won';
        setTimeout(() => { if (screen === 'won') onComplete(); }, 800);
      }
    }
  } else if (st.pause && screen === 'pause') {
    show('play');
  } else {
    acc = 0;
    if (screen === 'won') game.update(dt, 0, false, false, { x: 0, y: 0 }); // particles only
  }

  renderer.updateCamera(game, dt);
  const showAim = screen === 'play' && (runner || (mouseSeen && !input.touchMode));
  renderer.draw(game, {
    aim: !showAim ? null : runner ? game.assistAim() : renderer.screenToWorld(st.aimX, st.aimY),
    touch: input.touchMode && (screen === 'play' || screen === 'won'),
    buttons: input.buttons(),
    held: input.heldDirs(),
    runner,
    zones: input.heldZones(),
  });
  input.clearEdges();
  requestAnimationFrame(frame);
}

// Offline play (iPhone "Add to Home Screen"): the service worker is generated by the production build.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}

applyMode();
showBuildInfo();
renderer.resize();
checkOrientation();
show('title');
requestAnimationFrame(frame);
