import * as C from './config';
import { Game } from './game';
import { Motion, Tile, Vec } from './level';
import { Pose, computePose, drawHero } from './hero';
import { CLAW_BACK, drawClaw } from './claw';

const CLAW_SCALE = 1.3;

const COL = {
  bgTop: '#141b2d',
  bgBot: '#24304a',
  wood: '#8a5a34',
  woodTop: '#c98a52',
  woodLine: '#6e4527',
  stone: '#2c3342',
  stoneTop: '#4a5468',
  stoneLine: '#222836',
  ring: '#7df0ff',
  rope: '#f4e9d0',
  perfect: '#ffe36b',
  text: '#eef3ff',
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
  /** View size multiplier (1 = VIEW_W × VIEW_H tiles; bigger = zoomed out). Eases toward speed's target. */
  zoom = 1;
  private punchT = 0;
  /** Recent hero centres, newest last (the momentum trail). */
  private trail: Vec[] = [];

  /** Visible world size in tiles right now. */
  get vw() { return C.VIEW_W * this.zoom; }
  get vh() { return C.VIEW_H * this.zoom; }
  /** Device pixels per world tile right now. */
  get sc() { return this.ppt / this.zoom; }

  /** Perfect release: a quick camera punch-in. */
  punch() { this.punchT = 1; }

  private zoomTarget(g: Game) {
    const f = Math.min(1, Math.max(0, (g.runSpeed - C.ZOOM_FROM) / (C.ZOOM_AT - C.ZOOM_FROM)));
    return 1 + C.ZOOM_OUT * f;
  }

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
    this.zoom = this.zoomTarget(g);
    this.punchT = 0;
    this.trail = [];
    const t = this.cameraTarget(g);
    this.camX = t.x; this.camY = t.y;
  }

  private cameraTarget(g: Game): Vec {
    const c = g.center();
    const vw = this.vw, vh = this.vh;
    let x = c.x - vw / 2 + g.cameraLead;
    let y = c.y - vh / 2 - 0.5;
    x = g.w <= vw ? (g.w - vw) / 2 : Math.max(0, Math.min(g.w - vw, x));
    y = g.h <= vh ? (g.h - vh) / 2 : Math.max(0, Math.min(g.h - vh, y));
    return { x, y };
  }

  updateCamera(g: Game, dt: number) {
    if (g.player.dead) return;
    // Zoom out with speed (slowly), punch in on a perfect release (quickly, then ease back).
    // Zooming about the view centre keeps the hero steady on screen.
    this.punchT = Math.max(0, this.punchT - dt / 0.45);
    const want = this.zoomTarget(g) - 0.07 * Math.sin(this.punchT * Math.PI * 0.5);
    const z0 = this.zoom;
    this.zoom += (want - this.zoom) * (1 - Math.exp(-(this.punchT > 0 ? 10 : 1.5) * dt));
    this.camX -= (C.VIEW_W * (this.zoom - z0)) / 2;
    this.camY -= (C.VIEW_H * (this.zoom - z0)) / 2;
    const t = this.cameraTarget(g);
    const k = 1 - Math.exp(-6 * dt);
    this.camX += (t.x - this.camX) * k;
    this.camY += (t.y - this.camY) * k;
  }

  draw(g: Game, opts: {
    aim: Vec | null; touch: boolean; zones: { jump: boolean; hook: boolean };
    /** Course markers (world x): the farthest run ever and where the last run ended. */
    markers?: { best?: { x: number; m: number }; last?: { x: number; m: number } };
  }) {
    const { ctx, canvas } = this;
    const now = performance.now();
    if (!g.player.dead) {
      this.trail.push(g.center());
      if (this.trail.length > 16) this.trail.shift();
    }
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
    ctx.scale(this.sc, this.sc);
    ctx.translate(-this.camX, -this.camY);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (opts.markers) this.drawMarkers(opts.markers);
    this.drawTiles(g);
    this.drawBeams(g);
    this.drawRings(g);
    if (!g.player.dead) this.drawTrail(g);
    if (opts.aim && !g.player.dead) this.drawAim(g, opts.aim);
    const pose = computePose(g, opts.aim);
    this.drawRope(g, pose);
    if (!g.player.dead) this.drawPlayer(g, pose);
    this.drawParticles(g);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSpeedLines(g, now / 1000, vw, vh);
    ctx.restore();

    if (opts.markers) this.drawMarkerLabels(opts.markers);
    this.drawPopups(g);
    this.drawHud(g);
    if (opts.touch) this.drawZones(opts.zones);
  }

  /** On touch screens: label the two halves of the screen. */
  private drawZones(zones: { jump: boolean; hook: boolean }) {
    const { ctx, canvas } = this;
    const s = this.dpr;
    const w = canvas.width, h = canvas.height;
    const fs = Math.max(12, Math.min(18, h / s * 0.035)) * s;
    // Faint divider along the bottom of the center line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([6 * s, 8 * s]);
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.62);
    ctx.lineTo(w / 2, h - 12 * s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const label = (text: string, x: number, align: CanvasTextAlign, on: boolean) => {
      ctx.textAlign = align;
      ctx.fillStyle = on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)';
      ctx.fillText(text, x, h - fs * 1.1);
    };
    label('▲ JUMP', fs * 1.2, 'left', zones.jump);
    label('HOOK ◆', w - fs * 1.2, 'right', zones.hook);
    ctx.textAlign = 'left';
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
      const wx = x / this.sc + this.camX * 0.3;
      ctx.lineTo(this.ox + x, this.oy + vh * 0.72 + Math.sin(wx * 0.35) * vh * 0.05 + Math.sin(wx * 0.9) * vh * 0.02);
    }
    ctx.lineTo(this.ox + vw, this.oy + vh);
    ctx.fill();
  }

  private drawTiles(g: Game) {
    const { ctx } = this;
    const x0 = Math.max(0, Math.floor(this.camX) - 1), x1 = Math.min(g.w - 1, Math.ceil(this.camX + this.vw) + 1);
    const y0 = Math.max(0, Math.floor(this.camY) - 1), y1 = Math.min(g.h - 1, Math.ceil(this.camY + this.vh) + 1);

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
          // The grab surface: a bright lip along the underside.
          if (!g.solid(tx, ty + 1)) { ctx.fillStyle = COL.woodTop; ctx.fillRect(tx, ty + 0.86, 1.01, 0.14); }
        } else if (t === Tile.Stone) {
          this.drawStone(tx, ty, open);
        }
      }
    }
  }

  /** Plain dark stone: staggered blocks, so it reads as ground rather than something to grab. */
  private drawStone(tx: number, ty: number, open: boolean) {
    const { ctx } = this;
    ctx.fillStyle = COL.stone;
    ctx.fillRect(tx, ty, 1.01, 1.01);
    ctx.strokeStyle = COL.stoneLine;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    const off = ty % 2 ? 0.5 : 0;
    ctx.moveTo(tx, ty + 0.5); ctx.lineTo(tx + 1, ty + 0.5);
    ctx.moveTo(tx + off, ty); ctx.lineTo(tx + off, ty + 0.5);
    ctx.moveTo(tx + 0.5 - off, ty + 0.5); ctx.lineTo(tx + 0.5 - off, ty + 1);
    ctx.stroke();
    if (open) { ctx.fillStyle = COL.stoneTop; ctx.fillRect(tx, ty, 1.01, 0.12); }
  }

  /** A faint dotted line along a mover's path, from (x, y) at its home offset (so you can read where it goes). */
  private drawTrack(m: Motion | undefined, x: number, y: number) {
    if (!m) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(200,220,255,0.16)';
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.08, 0.2]);
    ctx.beginPath();
    ctx.moveTo(x - m.ax, y - m.ay);
    ctx.lineTo(x + m.ax, y + m.ay);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const s of [-1, 1]) {
      ctx.fillStyle = 'rgba(200,220,255,0.22)';
      ctx.beginPath();
      ctx.arc(x + s * m.ax, y + s * m.ay, 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Hanging wood beams (they move, so they're drawn at fractional positions, not as tiles). */
  private drawBeams(g: Game) {
    const { ctx } = this;
    for (const b of g.level.beams) {
      if (b.x + b.w < this.camX - 3 || b.x > this.camX + this.vw + 3) continue;
      this.drawTrack(b.m, b.bx + b.w / 2, b.by + b.h / 2);
      ctx.fillStyle = COL.wood;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = COL.woodLine;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + 0.5); ctx.lineTo(b.x + b.w, b.y + 0.5);
      for (let i = 0; i < b.w; i++) {
        const off = i % 2 ? 0.5 : 0;
        ctx.moveTo(b.x + i + off + 0.25, b.y); ctx.lineTo(b.x + i + off + 0.25, b.y + 0.5);
        ctx.moveTo(b.x + i + 0.75 - off * 0.5, b.y + 0.5); ctx.lineTo(b.x + i + 0.75 - off * 0.5, b.y + 1);
      }
      ctx.stroke();
      ctx.fillStyle = COL.woodTop;
      ctx.fillRect(b.x, b.y, b.w, 0.14);
      // The grab surface: a bright lip along the underside.
      ctx.fillRect(b.x, b.y + b.h - 0.14, b.w, 0.14);
    }
  }

  private drawRings(g: Game) {
    const { ctx } = this;
    for (const r of g.level.rings) {
      if (r.x < this.camX - 2 || r.x > this.camX + this.vw + 2) continue;
      this.drawTrack(r.m, r.bx, r.by);
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
  }

  /** Behind the hero once momentum builds: a fading ribbon, cyan turning gold at full momentum. */
  private drawTrail(g: Game) {
    const m = g.momentum;
    if (m < 0.25 || this.trail.length < 3) return;
    const { ctx } = this;
    const k = (m - 0.25) / 0.75;
    const col = k > 0.85 ? '255,227,107' : '125,240,255';
    const n = this.trail.length;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      ctx.strokeStyle = `rgba(${col},${(0.08 + 0.4 * k) * f})`;
      ctx.lineWidth = (0.12 + 0.4 * k) * f;
      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.stroke();
    }
  }

  /** Faint horizontal streaks rushing past at high speed (screen space, inside the view clip). */
  private drawSpeedLines(g: Game, t: number, vw: number, vh: number) {
    const sp = g.player.dead ? 0 : g.player.vx;
    const k = Math.min(1, Math.max(0, (sp - 10.5) / 3.5));
    if (k <= 0) return;
    const { ctx } = this;
    const n = Math.round(6 + 14 * k);
    ctx.lineWidth = Math.max(1, this.dpr);
    for (let i = 0; i < n; i++) {
      const h1 = Math.sin(i * 127.1) * 43758.5453, h2 = Math.sin(i * 311.7) * 23421.631;
      const fy = h1 - Math.floor(h1), fx = h2 - Math.floor(h2);
      const len = vw * (0.05 + 0.08 * fy) * (0.5 + k);
      const x = this.ox + vw - (((t * (1.6 + fy) + fx) % 1) * (vw + len));
      const y = this.oy + vh * (0.06 + 0.88 * fy);
      ctx.strokeStyle = `rgba(220,235,255,${0.05 + 0.13 * k})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  }

  /** The BEST flag and the last run's end, as dashed lines down the whole view (world space). */
  private drawMarkers(mk: NonNullable<Parameters<Renderer['draw']>[1]['markers']>) {
    const { ctx } = this;
    const line = (x: number, color: string) => {
      if (x < this.camX - 2 || x > this.camX + this.vw + 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.07;
      ctx.setLineDash([0.35, 0.3]);
      ctx.beginPath();
      ctx.moveTo(x, this.camY);
      ctx.lineTo(x, this.camY + this.vh);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const showLast = mk.last && (!mk.best || Math.abs(mk.last.m - mk.best.m) > 4);
    if (showLast) line(mk.last!.x, 'rgba(255,120,120,0.35)');
    if (mk.best) {
      line(mk.best.x, 'rgba(255,227,107,0.5)');
      // Pennant near the top of the view.
      const x = mk.best.x, y = this.camY + 1.2;
      ctx.fillStyle = COL.perfect;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + 1.3, y + 0.45); ctx.lineTo(x, y + 0.9);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Marker captions, in screen space so they stay crisp. */
  private drawMarkerLabels(mk: NonNullable<Parameters<Renderer['draw']>[1]['markers']>) {
    const { ctx } = this;
    const s = this.dpr;
    const fs = Math.max(11, Math.min(16, (this.canvas.height / s) * 0.024)) * s;
    ctx.font = `800 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = (x: number, y: number, text: string, color: string) => {
      const sx = this.ox + (x - this.camX) * this.sc, sy = this.oy + (y - this.camY) * this.sc;
      if (sx < this.ox - 200 || sx > this.ox + this.ppt * C.VIEW_W) return;
      ctx.lineWidth = fs * 0.25;
      ctx.strokeStyle = 'rgba(5,7,12,0.8)';
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = color;
      ctx.fillText(text, sx, sy);
    };
    if (mk.best) label(mk.best.x + 1.5, this.camY + 1.65, `BEST ${mk.best.m} m`, COL.perfect);
    if (mk.last && (!mk.best || Math.abs(mk.last.m - mk.best.m) > 4)) {
      label(mk.last.x + 0.3, this.camY + this.vh - 1.2, `✕ last run`, 'rgba(255,150,150,0.8)');
    }
  }

  private drawAim(g: Game, aim: Vec) {
    const { ctx } = this;
    const c = g.center();
    let dx = aim.x - c.x, dy = aim.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    dx /= len; dy /= len;
    const busy = g.hook.kind !== 'idle';
    const hit = g.castHook(c.x, c.y, dx, dy, g.hookRange);
    const t = hit ? hit.t : g.hookRange;
    let color = 'rgba(255,255,255,0.35)';
    if (hit) {
      color = { wood: COL.woodTop, ring: COL.ring, solid: '#9aa6b8' }[hit.what];
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
    if (hit && hit.what !== 'solid') {
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
    const taut = k === 'anchored';
    // Gold rope = let go now for a perfect release.
    ctx.strokeStyle = taut && g.isPerfect() ? COL.perfect : COL.rope;
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

  /** "PERFECT", "×2", "+10 m": world-anchored text, drawn in screen space so it stays crisp. */
  private drawPopups(g: Game) {
    const { ctx } = this;
    const s = this.dpr;
    const fs = Math.max(14, Math.min(22, (this.canvas.height / s) * 0.032)) * s;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const u of g.popups) {
      const t = u.life / u.max;
      const x = this.ox + (u.x - this.camX) * this.sc, y = this.oy + (u.y - this.camY) * this.sc;
      const pop = 1 + 0.35 * Math.max(0, (t - 0.85) / 0.15); // quick pop on appearing
      ctx.font = `900 ${(u.big ? 1.6 : 1.15) * fs * pop}px system-ui, -apple-system, sans-serif`;
      ctx.globalAlpha = Math.min(1, t * 2.5);
      ctx.lineWidth = fs * 0.22;
      ctx.strokeStyle = 'rgba(5,7,12,0.8)';
      ctx.strokeText(u.text, x, y);
      ctx.fillStyle = u.color;
      ctx.fillText(u.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  private drawHud(g: Game) {
    const { ctx } = this;
    const s = this.dpr;
    // Sized from the screen, not the tile size, so zooming out doesn't shrink the HUD.
    const fs = Math.max(14, Math.min(22, (this.canvas.height / s) * 0.032)) * s;
    ctx.textBaseline = 'top';
    ctx.fillStyle = COL.text;
    const x = this.ox + fs * 0.9, y = this.oy + fs * 0.7;
    ctx.font = `800 ${fs * 1.5}px system-ui, -apple-system, sans-serif`;
    ctx.globalAlpha = 0.95;
    ctx.fillText(g.hudTitle, x, y);
    // Momentum: the score multiplier next to the score, and a bar under it (gold when full).
    const m = g.momentum, full = m > 0.97;
    const tw = ctx.measureText(g.hudTitle).width;
    ctx.font = `800 ${fs * 1.05}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = full ? COL.perfect : m > 0.02 ? COL.ring : 'rgba(238,243,255,0.45)';
    ctx.fillText(`×${(1 + C.MOM_SCORE * m).toFixed(1)}`, x + tw + fs * 0.5, y + fs * 0.38);
    const bw = fs * 7, bh = fs * 0.32, by = y + fs * 1.75;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(238,243,255,0.16)';
    ctx.fillRect(x, by, bw, bh);
    ctx.fillStyle = full ? COL.perfect : COL.ring;
    ctx.fillRect(x, by, bw * m, bh);
    ctx.fillStyle = COL.text;
    ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(g.hudStats, x, y + fs * 2.35);
    if (g.level.hint && g.time < 9) {
      ctx.globalAlpha = Math.min(0.85, (9 - g.time) / 1.5);
      ctx.textAlign = 'center';
      ctx.fillText(g.level.hint, this.canvas.width / 2, this.oy + this.ppt * C.VIEW_H - fs * 2.2);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }


}
