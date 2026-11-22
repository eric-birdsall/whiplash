import * as C from './config';
import { Game } from './game';
import { Tile, Vec } from './level';
import { TouchButton } from './input';
import { Pose, computePose, drawHero } from './hero';
import { CLAW_BACK, drawClaw } from './claw';

const CLAW_SCALE = 1.3;

const COL = {
  bgTop: '#141b2d',
  bgBot: '#24304a',
  wood: '#8a5a34',
  woodTop: '#c98a52',
  woodLine: '#6e4527',
  metal: '#566273',
  metalTop: '#8b97a8',
  metalDark: '#3e4856',
  spike: '#ff4d5e',
  ring: '#7df0ff',
  gold: '#ffc93c',
  goldDark: '#c48a12',
  rope: '#f4e9d0',
  text: '#eef3ff',
  green: '#7dff9a',
};

export class Renderer {
  ctx: CanvasRenderingContext2D;
  ppt = 40; // pixels per tile (device px)
  ox = 0; // view offset (device px)
  oy = 0;
  camX = 0; // world coords of view top-left
  camY = 0;
  dpr = 1;
  private stars: { x: number; y: number; r: number; d: number }[] = [];

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 90; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.5 + 0.4, d: Math.random() * 0.5 + 0.1 });
    }
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ppt = Math.min(this.canvas.width / C.VIEW_W, this.canvas.height / C.VIEW_H);
    this.ox = (this.canvas.width - this.ppt * C.VIEW_W) / 2;
    this.oy = (this.canvas.height - this.ppt * C.VIEW_H) / 2;
  }

  /** Snap the camera onto the player (call on level start / respawn). */
  snapCamera(g: Game) {
    const t = this.cameraTarget(g);
    this.camX = t.x; this.camY = t.y;
  }

  private cameraTarget(g: Game): Vec {
    const c = g.center();
    let x = c.x - C.VIEW_W / 2 + g.player.facing * 1.5;
    let y = c.y - C.VIEW_H / 2 - 0.5;
    x = g.w <= C.VIEW_W ? (g.w - C.VIEW_W) / 2 : Math.max(0, Math.min(g.w - C.VIEW_W, x));
    y = g.h <= C.VIEW_H ? (g.h - C.VIEW_H) / 2 : Math.max(0, Math.min(g.h - C.VIEW_H, y));
    return { x, y };
  }

  updateCamera(g: Game, dt: number) {
    if (g.player.dead) return;
    const t = this.cameraTarget(g);
    const k = 1 - Math.exp(-6 * dt);
    this.camX += (t.x - this.camX) * k;
    this.camY += (t.y - this.camY) * k;
  }

  /** CSS-pixel canvas coords → world. */
  screenToWorld(sx: number, sy: number): Vec {
    return {
      x: (sx * this.dpr - this.ox) / this.ppt + this.camX,
      y: (sy * this.dpr - this.oy) / this.ppt + this.camY,
    };
  }

  draw(g: Game, opts: { aim: Vec | null; touch: boolean; buttons: TouchButton[]; held: Set<number> }) {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // View clip
    const vw = this.ppt * C.VIEW_W, vh = this.ppt * C.VIEW_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, vw, vh);
    ctx.clip();
    this.drawBackground(vw, vh);

    // World transform
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.ppt, this.ppt);
    ctx.translate(-this.camX, -this.camY);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.drawTiles(g);
    this.drawFlags(g);
    this.drawObjects(g);
    if (opts.aim && !g.player.dead && !g.completed) this.drawAim(g, opts.aim);
    const pose = computePose(g, opts.aim);
    this.drawRope(g, pose);
    if (!g.player.dead) this.drawPlayer(g, pose);
    this.drawParticles(g);
    ctx.restore();

    this.drawHud(g);
    if (opts.touch) this.drawButtons(opts.buttons, opts.held);
  }

  private drawBackground(vw: number, vh: number) {
    const { ctx } = this;
    const grd = ctx.createLinearGradient(0, this.oy, 0, this.oy + vh);
    grd.addColorStop(0, COL.bgTop);
    grd.addColorStop(1, COL.bgBot);
    ctx.fillStyle = grd;
    ctx.fillRect(this.ox, this.oy, vw, vh);
    ctx.fillStyle = 'rgba(200,220,255,0.35)';
    for (const s of this.stars) {
      const px = ((s.x * vw * 1.5 - this.camX * this.ppt * s.d) % vw + vw) % vw;
      const py = ((s.y * vh * 1.3 - this.camY * this.ppt * s.d) % vh + vh) % vh;
      ctx.fillRect(this.ox + px, this.oy + py, s.r * this.dpr, s.r * this.dpr);
    }
    // Distant hills
    ctx.fillStyle = 'rgba(60,80,120,0.35)';
    ctx.beginPath();
    ctx.moveTo(this.ox, this.oy + vh);
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * vw;
      const wx = x / this.ppt + this.camX * 0.3;
      ctx.lineTo(this.ox + x, this.oy + vh * 0.72 + Math.sin(wx * 0.35) * vh * 0.05 + Math.sin(wx * 0.9) * vh * 0.02);
    }
    ctx.lineTo(this.ox + vw, this.oy + vh);
    ctx.fill();
  }

  private drawTiles(g: Game) {
    const { ctx } = this;
    const x0 = Math.max(0, Math.floor(this.camX) - 1), x1 = Math.min(g.w - 1, Math.ceil(this.camX + C.VIEW_W) + 1);
    const y0 = Math.max(0, Math.floor(this.camY) - 1), y1 = Math.min(g.h - 1, Math.ceil(this.camY + C.VIEW_H) + 1);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = g.tileAt(tx, ty);
        const open = !g.solid(tx, ty - 1);
        if (t === Tile.Wood) {
          ctx.fillStyle = COL.wood;
          ctx.fillRect(tx, ty, 1.01, 1.01);
          ctx.strokeStyle = COL.woodLine;
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          const off = (tx + ty) % 2 ? 0.5 : 0;
          ctx.moveTo(tx, ty + 0.5); ctx.lineTo(tx + 1, ty + 0.5);
          ctx.moveTo(tx + off + 0.25, ty); ctx.lineTo(tx + off + 0.25, ty + 0.5);
          ctx.moveTo(tx + 0.75 - off * 0.5, ty + 0.5); ctx.lineTo(tx + 0.75 - off * 0.5, ty + 1);
          ctx.stroke();
          if (open) { ctx.fillStyle = COL.woodTop; ctx.fillRect(tx, ty, 1.01, 0.14); }
        } else if (t === Tile.Metal) {
          this.drawMetal(tx, ty, open);
        } else if (t === Tile.Spikes) {
          ctx.fillStyle = COL.spike;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            ctx.moveTo(tx + i / 3, ty + 1);
            ctx.lineTo(tx + i / 3 + 1 / 6, ty + 0.4);
            ctx.lineTo(tx + (i + 1) / 3, ty + 1);
          }
          ctx.fill();
        }
      }
    }

    // Doors
    for (const d of g.doors) {
      for (const c of d.cells) {
        if (d.open) {
          ctx.strokeStyle = 'rgba(255,201,60,0.25)';
          ctx.lineWidth = 0.05;
          ctx.strokeRect(c.x + 0.1, c.y + 0.05, 0.8, 0.9);
          continue;
        }
        this.drawMetal(c.x, c.y, false);
        ctx.fillStyle = COL.gold;
        ctx.beginPath();
        ctx.arc(c.x + 0.5, c.y + 0.42, 0.13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(c.x + 0.44, c.y + 0.45, 0.12, 0.28);
      }
    }
    // Gates
    for (const gt of g.gates) {
      if (g.gatesOpen) {
        ctx.strokeStyle = 'rgba(125,255,154,0.25)';
        ctx.lineWidth = 0.05;
        ctx.strokeRect(gt.x + 0.1, gt.y + 0.05, 0.8, 0.9);
        continue;
      }
      ctx.fillStyle = COL.metalDark;
      ctx.fillRect(gt.x, gt.y, 1, 1);
      ctx.fillStyle = COL.metalTop;
      for (let i = 0; i < 3; i++) ctx.fillRect(gt.x + 0.12 + i * 0.3, gt.y, 0.14, 1);
    }
  }

  private drawMetal(tx: number, ty: number, open: boolean) {
    const { ctx } = this;
    ctx.fillStyle = COL.metal;
    ctx.fillRect(tx, ty, 1.01, 1.01);
    ctx.fillStyle = COL.metalDark;
    ctx.fillRect(tx, ty + 0.9, 1.01, 0.1);
    ctx.fillStyle = COL.metalTop;
    if (open) ctx.fillRect(tx, ty, 1.01, 0.1);
    for (const [rx, ry] of [[0.18, 0.22], [0.82, 0.22], [0.18, 0.75], [0.82, 0.75]]) {
      ctx.fillRect(tx + rx - 0.04, ty + ry - 0.04, 0.08, 0.08);
    }
  }

  private drawFlags(g: Game) {
    const { ctx } = this;
    g.level.checkpoints.forEach((cp, i) => {
      const active = i <= g.checkpointIndex && g.checkpointIndex >= 0 && i === g.checkpointIndex;
      ctx.strokeStyle = '#c9d2e3';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(cp.x - 0.2, cp.y); ctx.lineTo(cp.x - 0.2, cp.y - 1.8);
      ctx.stroke();
      ctx.fillStyle = active ? COL.green : '#7a8496';
      ctx.beginPath();
      ctx.moveTo(cp.x - 0.17, cp.y - 1.8);
      ctx.lineTo(cp.x + 0.55, cp.y - 1.55);
      ctx.lineTo(cp.x - 0.17, cp.y - 1.3);
      ctx.fill();
    });
    const e = g.level.exit;
    const t = performance.now() / 1000;
    ctx.fillStyle = 'rgba(255,201,60,0.15)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - 1.1, 0.75 + Math.sin(t * 3) * 0.05, 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(e.x - 0.25, e.y); ctx.lineTo(e.x - 0.25, e.y - 2.1);
    ctx.stroke();
    ctx.fillStyle = COL.gold;
    ctx.beginPath();
    const wv = Math.sin(t * 5) * 0.06;
    ctx.moveTo(e.x - 0.22, e.y - 2.1);
    ctx.quadraticCurveTo(e.x + 0.3, e.y - 2.0 + wv, e.x + 0.75, e.y - 1.8);
    ctx.quadraticCurveTo(e.x + 0.3, e.y - 1.6 - wv, e.x - 0.22, e.y - 1.5);
    ctx.fill();
  }

  private drawObjects(g: Game) {
    const { ctx } = this;
    const t = performance.now() / 1000;
    // Rings
    for (const r of g.level.rings) {
      ctx.strokeStyle = 'rgba(125,240,255,0.25)';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(r.x, r.y, C.RING_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COL.ring;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(r.x, r.y, C.RING_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Plates
    for (const p of g.plates) {
      ctx.fillStyle = COL.metalDark;
      ctx.fillRect(p.tx + 0.05, p.ty + 0.88, 0.9, 0.12);
      ctx.fillStyle = p.pressed ? COL.green : '#e2e8f2';
      ctx.fillRect(p.tx + 0.12, p.ty + (p.pressed ? 0.82 : 0.72), 0.76, p.pressed ? 0.08 : 0.16);
    }
    // Levers
    for (const l of g.levers) {
      const cx = l.tx + 0.5, cy = l.ty + 0.75;
      ctx.fillStyle = COL.metalDark;
      ctx.fillRect(l.tx + 0.2, l.ty + 0.7, 0.6, 0.3);
      ctx.strokeStyle = '#d9dee8';
      ctx.lineWidth = 0.1;
      const a = l.on ? -0.6 : -2.55;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 0.6, cy + Math.sin(a) * 0.6);
      ctx.stroke();
      ctx.fillStyle = l.on ? COL.green : COL.gold;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 0.6, cy + Math.sin(a) * 0.6, 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    // Crates
    for (const c of g.crates) {
      ctx.fillStyle = COL.goldDark;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = COL.gold;
      const i = 0.1;
      ctx.fillRect(c.x + i, c.y + i, c.w - 2 * i, c.h - 2 * i);
      ctx.strokeStyle = COL.goldDark;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.moveTo(c.x + i, c.y + i); ctx.lineTo(c.x + c.w - i, c.y + c.h - i);
      ctx.moveTo(c.x + c.w - i, c.y + i); ctx.lineTo(c.x + i, c.y + c.h - i);
      ctx.stroke();
    }
    // Keys
    for (const k of g.keys) {
      if (k.collected) continue;
      const y = k.y + Math.sin(k.bob * 3) * 0.06;
      ctx.fillStyle = 'rgba(255,201,60,0.18)';
      ctx.beginPath();
      ctx.arc(k.x, y, 0.45 + Math.sin(t * 4) * 0.03, 0, Math.PI * 2);
      ctx.fill();
      this.drawKey(k.x, y, 1);
    }
  }

  private drawKey(x: number, y: number, s: number) {
    const { ctx } = this;
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 0.09 * s;
    ctx.beginPath();
    ctx.arc(x - 0.13 * s, y, 0.13 * s, 0, Math.PI * 2);
    ctx.moveTo(x, y); ctx.lineTo(x + 0.3 * s, y);
    ctx.moveTo(x + 0.22 * s, y); ctx.lineTo(x + 0.22 * s, y + 0.12 * s);
    ctx.moveTo(x + 0.3 * s, y); ctx.lineTo(x + 0.3 * s, y + 0.15 * s);
    ctx.stroke();
  }

  private drawAim(g: Game, aim: Vec) {
    const { ctx } = this;
    const c = g.center();
    let dx = aim.x - c.x, dy = aim.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    dx /= len; dy /= len;
    const busy = g.hook.kind !== 'idle';
    const hit = g.castHook(c.x, c.y, dx, dy, C.HOOK_RANGE);
    const t = hit ? hit.t : C.HOOK_RANGE;
    let color = 'rgba(255,255,255,0.35)';
    if (hit) {
      color = {
        wood: COL.woodTop, ring: COL.ring, metal: '#9aa6b8', key: COL.gold, crate: COL.gold, lever: COL.gold,
      }[hit.what];
    }
    ctx.globalAlpha = busy ? 0.25 : 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.04;
    ctx.setLineDash([0.12, 0.22]);
    ctx.beginPath();
    ctx.moveTo(c.x + dx * 0.6, c.y + dy * 0.6);
    ctx.lineTo(c.x + dx * t, c.y + dy * t);
    ctx.stroke();
    ctx.setLineDash([]);
    const ex = c.x + dx * t, ey = c.y + dy * t;
    ctx.lineWidth = 0.07;
    if (hit && hit.what !== 'metal') {
      ctx.beginPath();
      ctx.arc(ex, ey, 0.22, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(ex - 0.15, ey - 0.15); ctx.lineTo(ex + 0.15, ey + 0.15);
      ctx.moveTo(ex + 0.15, ey - 0.15); ctx.lineTo(ex - 0.15, ey + 0.15);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private clawOpen = 0;
  private lastRopeDraw = 0;

  private drawRope(g: Game, pose: Pose) {
    if (g.player.dead) return;
    const { ctx } = this;
    const tip = g.hookTip();
    const c = pose.hand;

    // Ease the claw toward the pose its state calls for.
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRopeDraw) / 1000);
    this.lastRopeDraw = now;
    const k = g.hook.kind;
    const want = k === 'flying' ? 1 : k === 'returning' ? 0.55 : k === 'idle' ? 0.12 : 0;
    const rate = want < this.clawOpen ? 30 : 9; // snaps shut, opens a bit slower
    this.clawOpen += (want - this.clawOpen) * Math.min(1, rate * dt);

    if (!tip) {
      // Ready: claw docked on the gauntlet.
      const ds = CLAW_SCALE * 0.75;
      drawClaw(ctx, c.x + Math.cos(pose.aim) * CLAW_BACK * ds, c.y + Math.sin(pose.aim) * CLAW_BACK * ds,
        pose.aim, this.clawOpen, ds);
      return;
    }

    const a = Math.atan2(tip.y - c.y, tip.x - c.x);
    const ex = tip.x - Math.cos(a) * CLAW_BACK * CLAW_SCALE, ey = tip.y - Math.sin(a) * CLAW_BACK * CLAW_SCALE;
    const taut = k === 'anchored' || k === 'pulling';
    ctx.strokeStyle = COL.rope;
    ctx.lineWidth = taut ? 0.06 : 0.045;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    if (taut) {
      ctx.lineTo(ex, ey);
    } else {
      // A little wobble while flying / returning
      const mx = (c.x + ex) / 2, my = (c.y + ey) / 2;
      const dx = ex - c.x, dy = ey - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const w = Math.sin(now / 40) * 0.15;
      ctx.quadraticCurveTo(mx - (dy / d) * w, my + (dx / d) * w, ex, ey);
    }
    ctx.stroke();
    drawClaw(ctx, tip.x, tip.y, a, this.clawOpen, CLAW_SCALE);
  }

  private drawPlayer(g: Game, pose: Pose) {
    drawHero(this.ctx, g, pose, performance.now() / 1000);
    const p = g.player;
    for (let i = 0; i < p.keys; i++) this.drawKey(p.x + p.w / 2 - 0.15, p.y - 0.4 - i * 0.3, 0.8);
  }

  private drawParticles(g: Game) {
    const { ctx } = this;
    for (const pt of g.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(g: Game) {
    const { ctx } = this;
    const s = this.dpr;
    const fs = Math.max(13, Math.min(20, this.ppt / s * 0.42)) * s;
    ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const x = this.ox + fs * 0.8, y = this.oy + fs * 0.7;
    const label = `${g.level.name}`;
    const stats = `☠ ${g.deaths}    ⏱ ${formatTime(g.time)}`;
    ctx.fillStyle = COL.text;
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, x, y);
    ctx.globalAlpha = 0.7;
    ctx.fillText(stats, x, y + fs * 1.35);
    if (g.level.hint && g.time < 9) {
      ctx.globalAlpha = Math.min(0.85, (9 - g.time) / 1.5);
      ctx.textAlign = 'center';
      ctx.fillText(g.level.hint, this.canvas.width / 2, this.oy + this.ppt * C.VIEW_H - fs * 2.2);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  private drawButtons(buttons: TouchButton[], held: Set<number>) {
    const { ctx } = this;
    const s = this.dpr;
    for (const b of buttons) {
      const on = held.has(b.dir);
      ctx.fillStyle = on ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.13)';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(b.x * s, b.y * s, b.r * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      const ax = b.x * s, ay = b.y * s, r = b.r * s * 0.38;
      ctx.moveTo(ax + b.dir * r, ay);
      ctx.lineTo(ax - b.dir * r * 0.7, ay - r);
      ctx.lineTo(ax - b.dir * r * 0.7, ay + r);
      ctx.fill();
    }
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

