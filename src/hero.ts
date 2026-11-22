// The hero: a musclebound commando drawn from simple shapes.
// Drawn around the player's hitbox (0.75 x 1.25 tiles); shoulders deliberately spill past it.
import type { Game } from './game';
import type { Vec } from './level';

const SKIN = '#d9a066';
const SKIN_DARK = '#a86f3e';
const HAIR = '#2a1d14';
const SHIRT = '#ece7dc';
const SHIRT_SHADE = '#c9c2b3';
const PANTS = '#46536e';
const PANTS_DARK = '#333e55';
const BOOT = '#2b1f17';
const BAND = '#d8342c';
const STRAP = '#6b4a2b';
const BULLET = '#e0b23c';
const METAL = '#8b97a8';
const METAL_DARK = '#4e5868';
const GLOW = '#7df0ff';

const SHOULDER_Y = -0.93;
const ARM_LEN = 0.44;
const GAUNTLET_TIP = 0.57;

export interface Pose {
  feet: Vec; // bottom-center of hitbox, world
  facing: number; // 1 right, -1 left
  tilt: number; // body rotation (radians) about the hip, when swinging
  aim: number; // front-arm world angle
  hand: Vec; // world position of the gauntlet tip (rope origin)
  phase: number; // run cycle
  running: boolean;
  air: boolean;
  hanging: boolean;
}

export function computePose(g: Game, aimWorld: Vec | null): Pose {
  const p = g.player;
  const feet = { x: p.x + p.w / 2, y: p.y + p.h };
  const c = g.center();
  const tip = g.hookTip();
  const hanging = g.hook.kind === 'anchored';

  let facing = p.facing || 1;
  let aim: number;
  if (tip) aim = Math.atan2(tip.y - c.y, tip.x - c.x);
  else if (aimWorld) aim = Math.atan2(aimWorld.y - c.y, aimWorld.x - c.x);
  else aim = facing > 0 ? 0.35 : Math.PI - 0.35; // relaxed, slightly down
  if (tip || aimWorld) {
    const ax = Math.cos(aim);
    if (Math.abs(ax) > 0.15) facing = Math.sign(ax);
  }

  // Lean into the rope while hanging, otherwise lean a touch with speed.
  let tilt = 0;
  if (hanging && tip) {
    tilt = Math.atan2(tip.x - c.x, -(tip.y - c.y));
    tilt = Math.max(-0.75, Math.min(0.75, tilt));
  } else if (!p.grounded) {
    tilt = Math.max(-0.25, Math.min(0.25, p.vx * 0.02));
  }

  const hip = { x: feet.x, y: feet.y - 0.5 };
  // Front shoulder, matching drawHero's local (0.22, SHOULDER_Y + 0.05); rope leaves the gauntlet tip.
  const sh = rotate({ x: feet.x + facing * 0.22, y: feet.y + SHOULDER_Y + 0.05 }, hip, tilt);
  const hand = { x: sh.x + Math.cos(aim) * GAUNTLET_TIP, y: sh.y + Math.sin(aim) * GAUNTLET_TIP };

  const running = p.grounded && Math.abs(p.vx) > 0.4;
  return { feet, facing, tilt, aim, hand, phase: p.x * 4.2, running, air: !p.grounded, hanging };
}

function rotate(pt: Vec, about: Vec, a: number): Vec {
  const s = Math.sin(a), c = Math.cos(a);
  const dx = pt.x - about.x, dy = pt.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Leg from hip, thigh angle a (0 = straight down, + = forward), knee bend k (>= 0). */
function leg(ctx: CanvasRenderingContext2D, hx: number, hy: number, a: number, k: number, color: string, boot: string) {
  const L = 0.215; // + boot depth so soles sit on the floor
  const kx = hx + Math.sin(a) * L, ky = hy + Math.cos(a) * L;
  const b = a - k;
  const fx = kx + Math.sin(b) * L, fy = ky + Math.cos(b) * L;
  limb(ctx, hx, hy, kx, ky, 0.17, color);
  limb(ctx, kx, ky, fx, fy, 0.15, color);
  // Boot points forward (+x in local space)
  ctx.fillStyle = boot;
  ctx.beginPath();
  ctx.moveTo(fx - 0.1, fy - 0.06);
  ctx.lineTo(fx + 0.06, fy - 0.06);
  ctx.lineTo(fx + 0.18, fy + 0.02);
  ctx.lineTo(fx + 0.18, fy + 0.07);
  ctx.lineTo(fx - 0.1, fy + 0.07);
  ctx.closePath();
  ctx.fill();
}

function legAngles(pose: Pose, front: boolean): [number, number] {
  if (pose.hanging) return front ? [0.35, 0.5] : [-0.1, 0.25];
  if (pose.air) return front ? [0.55, 0.9] : [-0.25, 0.35];
  if (pose.running) {
    const s = Math.sin(pose.phase + (front ? 0 : Math.PI));
    return [s * 0.65, Math.max(0, -s) * 0.9 + 0.1];
  }
  return front ? [0.12, 0.05] : [-0.12, 0.05];
}

export function drawHero(ctx: CanvasRenderingContext2D, g: Game, pose: Pose, time: number) {
  const f = pose.facing;
  ctx.save();
  // Local space: origin at feet, +x = forward, y down. Rotate about hip for tilt.
  ctx.translate(pose.feet.x, pose.feet.y - 0.5);
  ctx.rotate(pose.tilt);
  ctx.translate(0, 0.5);
  ctx.scale(f, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bob = pose.running ? Math.abs(Math.sin(pose.phase)) * -0.04 : Math.sin(time * 2.2) * 0.008;
  const hipY = -0.5 + bob;
  const shY = SHOULDER_Y + bob;
  const shX = 0.08;

  // Back arm: swings opposite the front leg when running, braces when hanging.
  const backSwing = pose.running ? Math.sin(pose.phase) * 0.7 : pose.air ? -0.6 : 0.15;
  const bx = -0.2, by = shY + 0.04;
  const be = { x: bx + Math.sin(backSwing) * 0.22, y: by + Math.cos(backSwing) * 0.22 };
  const bh = { x: be.x + Math.sin(backSwing + 0.5) * 0.2, y: be.y + Math.cos(backSwing + 0.5) * 0.2 };
  limb(ctx, bx, by, be.x, be.y, 0.16, SKIN_DARK);
  limb(ctx, be.x, be.y, bh.x, bh.y, 0.13, SKIN_DARK);
  ctx.fillStyle = SKIN_DARK;
  ctx.beginPath(); ctx.arc(bh.x, bh.y, 0.075, 0, Math.PI * 2); ctx.fill();

  // Back leg
  const [ba, bk] = legAngles(pose, false);
  leg(ctx, -0.06, hipY, ba, bk, PANTS_DARK, BOOT);

  // Torso: big V. Tank top over a broad chest.
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(-0.33, shY - 0.02);
  ctx.quadraticCurveTo(0.02, shY - 0.1, 0.38, shY - 0.02);
  ctx.lineTo(0.2, hipY + 0.02);
  ctx.lineTo(-0.2, hipY + 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.moveTo(-0.22, shY + 0.02);
  ctx.lineTo(-0.1, shY + 0.02);
  ctx.quadraticCurveTo(0.05, shY + 0.14, 0.18, shY + 0.02);
  ctx.lineTo(0.28, shY + 0.02);
  ctx.lineTo(0.21, hipY + 0.04);
  ctx.lineTo(-0.21, hipY + 0.04);
  ctx.closePath();
  ctx.fill();
  // Pec / ab shading
  ctx.strokeStyle = SHIRT_SHADE;
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(-0.08, shY + 0.2); ctx.quadraticCurveTo(0.05, shY + 0.26, 0.2, shY + 0.18);
  ctx.moveTo(0.04, shY + 0.3); ctx.lineTo(0.03, hipY - 0.04);
  ctx.stroke();
  // Belt
  ctx.fillStyle = STRAP;
  ctx.fillRect(-0.22, hipY - 0.03, 0.44, 0.08);
  ctx.fillStyle = BULLET;
  ctx.fillRect(0.05, hipY - 0.025, 0.08, 0.07);
  // Bandolier across the chest
  ctx.strokeStyle = STRAP;
  ctx.lineWidth = 0.075;
  ctx.beginPath();
  ctx.moveTo(-0.2, shY + 0.02);
  ctx.lineTo(0.2, hipY - 0.02);
  ctx.stroke();
  ctx.fillStyle = BULLET;
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const x = -0.2 + 0.4 * t, y = shY + 0.02 + (hipY - 0.04 - shY) * t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.9);
    ctx.fillRect(-0.018, -0.05, 0.036, 0.07);
    ctx.restore();
  }
  // Traps / neck
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(-0.12, shY - 0.04);
  ctx.lineTo(0.18, shY - 0.04);
  ctx.lineTo(0.12, shY - 0.15);
  ctx.lineTo(-0.04, shY - 0.15);
  ctx.closePath();
  ctx.fill();
  // Back shoulder cap
  ctx.fillStyle = SKIN_DARK;
  ctx.beginPath(); ctx.arc(-0.22, shY + 0.05, 0.1, 0, Math.PI * 2); ctx.fill();

  // Front leg
  const [fa, fk] = legAngles(pose, true);
  leg(ctx, 0.07, hipY, fa, fk, PANTS, BOOT);

  // Head
  drawHead(ctx, shX - 0.02, shY - 0.27, pose, time);

  // Front arm: aims at the hook (local angle mirrors with facing).
  const aimLocal = Math.atan2(Math.sin(pose.aim), Math.cos(pose.aim) * f) - pose.tilt * f;
  const ux = Math.cos(aimLocal), uy = Math.sin(aimLocal);
  const sx = shX + 0.14, sy = shY + 0.05;
  const ex = sx + ux * 0.21, ey = sy + uy * 0.21;
  const hx = sx + ux * ARM_LEN, hy = sy + uy * ARM_LEN;
  // Deltoid + bicep
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(sx, sy, 0.115, 0, Math.PI * 2); ctx.fill();
  limb(ctx, sx, sy, ex, ey, 0.19, SKIN);
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(sx + ux * 0.11 - uy * 0.03, sy + uy * 0.11 + ux * 0.03, 0.1, 0, Math.PI * 2); ctx.fill();
  limb(ctx, ex, ey, hx, hy, 0.15, SKIN);
  // Grapple gauntlet on the forearm
  ctx.save();
  ctx.translate(ex + ux * 0.02, ey + uy * 0.02);
  ctx.rotate(aimLocal);
  ctx.fillStyle = METAL_DARK;
  ctx.fillRect(0, -0.1, 0.28, 0.2);
  ctx.fillStyle = METAL;
  ctx.fillRect(0.02, -0.085, 0.24, 0.08);
  ctx.fillStyle = METAL_DARK;
  ctx.fillRect(0.24, -0.06, 0.1, 0.12);
  const armed = g.hook.kind === 'idle' && g.cooldown <= 0;
  ctx.fillStyle = armed ? GLOW : '#2c6b75';
  ctx.fillRect(0.06, 0.02, 0.12, 0.04);
  ctx.restore();

  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, x: number, y: number, pose: Pose, time: number) {
  // Ear (back)
  ctx.fillStyle = SKIN_DARK;
  ctx.beginPath(); ctx.arc(x - 0.08, y + 0.02, 0.045, 0, Math.PI * 2); ctx.fill();
  // Skull + big square jaw jutting forward
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.moveTo(x - 0.13, y - 0.12);
  ctx.lineTo(x + 0.11, y - 0.13);
  ctx.quadraticCurveTo(x + 0.16, y - 0.05, x + 0.15, y + 0.04);
  ctx.lineTo(x + 0.17, y + 0.12);
  ctx.lineTo(x + 0.14, y + 0.17);
  ctx.lineTo(x - 0.06, y + 0.17);
  ctx.lineTo(x - 0.13, y + 0.06);
  ctx.closePath();
  ctx.fill();
  // Stubble
  ctx.fillStyle = 'rgba(60,40,25,0.35)';
  ctx.beginPath();
  ctx.moveTo(x - 0.06, y + 0.06);
  ctx.lineTo(x + 0.15, y + 0.06);
  ctx.lineTo(x + 0.17, y + 0.12);
  ctx.lineTo(x + 0.14, y + 0.17);
  ctx.lineTo(x - 0.06, y + 0.17);
  ctx.lineTo(x - 0.11, y + 0.08);
  ctx.closePath();
  ctx.fill();
  // Buzz cut
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(x - 0.14, y - 0.06);
  ctx.lineTo(x - 0.14, y - 0.15);
  ctx.quadraticCurveTo(x, y - 0.2, x + 0.12, y - 0.15);
  ctx.lineTo(x + 0.12, y - 0.11);
  ctx.lineTo(x - 0.06, y - 0.11);
  ctx.lineTo(x - 0.08, y - 0.04);
  ctx.closePath();
  ctx.fill();
  // Headband with tails streaming behind
  ctx.fillStyle = BAND;
  ctx.fillRect(x - 0.14, y - 0.11, 0.28, 0.05);
  const wave = Math.sin(time * 9) * 0.03;
  const stream = pose.running || pose.air ? 0.06 : 0;
  ctx.beginPath();
  ctx.moveTo(x - 0.13, y - 0.1);
  ctx.quadraticCurveTo(x - 0.24, y - 0.1 + wave, x - 0.3 - stream, y - 0.04 + wave - stream);
  ctx.lineTo(x - 0.28 - stream, y + 0.0 + wave - stream * 0.5);
  ctx.quadraticCurveTo(x - 0.2, y - 0.04, x - 0.13, y - 0.06);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 0.13, y - 0.08);
  ctx.quadraticCurveTo(x - 0.22, y - 0.02 - wave, x - 0.25 - stream, y + 0.06 - wave);
  ctx.lineTo(x - 0.22 - stream, y + 0.08 - wave);
  ctx.quadraticCurveTo(x - 0.18, y + 0.0, x - 0.12, y - 0.05);
  ctx.fill();
  // Angry brow + eye
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 0.05, y - 0.03, 0.06, 0.035);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(x + 0.085, y - 0.025, 0.025, 0.03);
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(x + 0.03, y - 0.06);
  ctx.lineTo(x + 0.13, y - 0.035);
  ctx.stroke();
  // Grim mouth
  ctx.strokeStyle = '#6b3d22';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(x + 0.07, y + 0.11);
  ctx.lineTo(x + 0.14, y + 0.1);
  ctx.stroke();
}
