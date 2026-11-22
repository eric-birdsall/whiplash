import * as C from './config';
import { Input } from './input';
import { Renderer } from './render';
import { Audio } from './audio';
import { EndlessRun } from './endless';

type Screen = 'title' | 'play' | 'dying' | 'pause' | 'over';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new Audio();

let screen: Screen = 'title';
/** The current run. A fresh one sits behind the title screen as a backdrop. */
let run = newRun();

input.onFirstGesture = () => audio.unlock();

function newRun(): EndlessRun {
  const r = new EndlessRun((s) => audio.play(s));
  renderer.resize();
  renderer.snapCamera(r.game);
  return r;
}

// ---------- Screens ----------

const $ = (id: string) => document.getElementById(id)!;
const screens: Record<'title' | 'pause' | 'over', HTMLElement> = { title: $('title'), pause: $('pause'), over: $('over') };

function show(s: Screen) {
  screen = s;
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== s);
  $('pause-btn').classList.toggle('hidden', s !== 'play');
  input.releaseAll();
  if (s === 'pause') $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
  if (s === 'title') $('title-best').textContent = run.best > 0 ? `Best: ${run.best} m` : '';
}

function startRun() {
  run = newRun();
  show('play');
}

function onRunOver() {
  const d = run.distance;
  const best = run.finish();
  $('over-stats').textContent = best ? `${d} m   — new best!` : `${d} m   (best ${run.best} m)`;
  show('over');
}

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest('button')?.dataset.action;
  if (!action) return;
  audio.unlock();
  switch (action) {
    case 'play': startRun(); break;
    case 'title': run = newRun(); show('title'); break;
    case 'resume': show('play'); break;
    case 'restart': startRun(); break;
    case 'hard-reload': hardReload(); break;
    case 'mute': audio.setMuted(!audio.muted); $('mute-btn').textContent = `Sound: ${audio.muted ? 'off' : 'on'}`; break;
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
  const game = run.game;

  if (screen === 'play') {
    if (st.pause) show('pause');
    else if (st.restart) startRun();
    else {
      acc += dt;
      let pressed = st.hookPressed;
      let jump = st.jumpPressed;
      while (acc >= C.STEP) {
        run.tick();
        game.update(C.STEP, st.hookDown, pressed, jump);
        pressed = jump = false;
        acc -= C.STEP;
      }
      if (game.player.dead) {
        screen = 'dying'; // let the burst play, then show the score
        setTimeout(() => { if (screen === 'dying') onRunOver(); }, 900);
      }
    }
  } else if (st.pause && screen === 'pause') {
    show('play');
  } else {
    acc = 0;
    if (screen === 'dying') game.update(dt, false, false, false); // particles only
  }

  renderer.updateCamera(run.game, dt);
  renderer.draw(run.game, {
    aim: screen === 'play' ? run.game.assistAim() : null,
    touch: input.touchMode && (screen === 'play' || screen === 'dying'),
    zones: input.heldZones(),
  });
  input.clearEdges();
  requestAnimationFrame(frame);
}

// Dev only: a console handle for debugging and screenshots.
if (import.meta.env.DEV) (window as unknown as { __whiplash: object }).__whiplash = { get game() { return run.game; }, get run() { return run; }, renderer };

// Offline play (iPhone "Add to Home Screen"): the service worker is generated by the production build.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}

showBuildInfo();
renderer.resize();
checkOrientation();
show('title');
requestAnimationFrame(frame);
