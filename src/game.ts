import * as C from './config';
import { Beam, Level, Ring, Spark, Tile, Vec, motionOffset } from './level';
import { Box, Grid, boxHitsGrid, moveAxis, overlaps, rayBox, raycastGrid, rayCircle } from './physics';

export const MAT_WOOD = 1;
export const MAT_STONE = 3;

export interface Player extends Box {
  vx: number;
  vy: number;
  grounded: boolean;
  facing: number;
  dead: boolean;
}

export type Hook =
  | { kind: 'idle' }
  // target = the ring or beam spot it locked onto when fired: they move, so the hook homes in on it.
  | { kind: 'flying'; x: number; y: number; dx: number; dy: number; dist: number; held: boolean; target?: AimTarget }
  // on = the ring or beam it caught (it moves, so the anchor follows), at offset (ox, oy) from its x, y.
  | { kind: 'anchored'; x: number; y: number; len: number; ring: boolean; on?: Ring | Beam; ox: number; oy: number }
  | { kind: 'returning'; x: number; y: number };

export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number;
}

export type Sfx = 'fire' | 'attach' | 'clank' | 'miss' | 'death' | 'jump' | 'perfect' | 'chain' | 'spark' | 'best';

/** A locked spot on a mover: (ox, oy) from its x, y (a ring's centre, or a point on a beam's underside). */
export type AimTarget = { on: Ring | Beam; ox: number; oy: number };

/** Floating text in world space ("PERFECT", "×2", "+10 m"). */
export interface Popup { text: string; x: number; y: number; life: number; max: number; color: string; big: boolean }

/** What a hook ray hits first: something to hang from ('wood' underside or 'ring'), or a 'solid' it bounces off. */
export type HookHit = { t: number; what: 'wood' | 'ring' | 'solid'; rx?: number; ry?: number; on?: Ring | Beam };

/**
 * The Endless runner: always running right, jump + double jump, and a fixed 60° grapple with aim
 * assist that catches only wood undersides and rings. One life; the world grows via appendColumns.
 */
export class Game implements Grid {
  w: number;
  h: number;
  player: Player;
  hook: Hook = { kind: 'idle' };
  cooldown = 0;
  hookRange = C.HOOK_RANGE;
  /** Grapple angle above horizontal (radians). Set from the menu's playtest option. */
  aimAngle = C.AUTO_AIM_ANGLE;
  /** Horizontal run speed (ramps up with distance). */
  runSpeed: number = C.RUN_SPEED;
  /** How far ahead (tiles) the camera looks. */
  cameraLead = 7.5;
  /** HUD lines: distance (big) and best. */
  hudTitle = '';
  hudStats = '';
  particles: Particle[] = [];
  popups: Popup[] = [];
  time = 0;
  /** Why the run ended (for tools). */
  lastDeath: { reason: string; x: number; y: number } | null = null;
  private hookBuffer = 0;
  private airJumpsLeft = 0;
  private blockedX = false;
  private pinned = 0;
  private jumpBuffer = 0;
  private coyote = 0;
  /** Swung on the rope since last touching the ground (landing then gives a speed burst). */
  private swung = false;
  /** Extra run speed from landing a swing; fades to 0 over LAND_BOOST_TIME. */
  landBoost = 0;
  /** Chain links since last touching the ground: rope catches plus perfect releases. */
  links = 0;
  /** Bonus metres earned from chains (added to the score). */
  bonus = 0;
  /** Perfect releases this run (for tools and stats). */
  perfects = 0;
  /** Play a sound through this run's sound hook (for the run controller). */
  sfxOut: (s: Sfx) => void;
  /** Momentum 0..1: earned by swinging well, drained by time on the ground. Adds speed and multiplies score. */
  momentum = 0;
  /** Seconds since last leaving the ground (0 while airborne). */
  private groundTime = 0;
  /** Sparks picked up this run, and how many in a row since last touching the ground (raises the chime). */
  sparks = 0;
  sparkStreak = 0;
  /** Seconds into the double-jump front tuck, or -1 when not flipping (cosmetic). */
  flipT = -1;

  constructor(public level: Level, private sfx: (s: Sfx) => void = () => {}) {
    this.sfxOut = sfx;
    this.w = level.w;
    this.h = level.h;
    this.player = {
      x: level.start.x - C.PLAYER_W / 2, y: level.start.y - C.PLAYER_H - 0.01, w: C.PLAYER_W, h: C.PLAYER_H,
      vx: 0, vy: 0, grounded: false, facing: 1, dead: false,
    };
    this.level.beams ??= [];
    this.level.sparks ??= [];
    this.updateMovers(true);
  }

  /**
   * Append columns on the right. Each column is h tile values, top to bottom.
   * Rings far behind the player are dropped so hook raycasts stay cheap.
   */
  appendColumns(cols: Uint8Array[], rings: Ring[], beams: Beam[] = [], sparks: Spark[] = []) {
    const oldW = this.w, h = this.h, nw = oldW + cols.length;
    const t = new Uint8Array(nw * h);
    for (let y = 0; y < h; y++) {
      t.set(this.level.tiles.subarray(y * oldW, (y + 1) * oldW), y * nw);
      for (let i = 0; i < cols.length; i++) t[y * nw + oldW + i] = cols[i][y];
    }
    this.level.tiles = t;
    this.level.w = this.w = nw;
    const cutoff = this.player.x - 40;
    this.level.rings = this.level.rings.filter((r) => r.x > cutoff).concat(rings);
    this.level.beams = this.level.beams.filter((b) => b.x + b.w > cutoff).concat(beams);
    this.level.sparks = this.level.sparks!.filter((k) => k.x > cutoff && !k.taken).concat(sparks);
    this.updateMovers(true);
  }

  /** Beams near a box (the only ones collision needs to look at). */
  private beamsNear(b: Box): Beam[] {
    return this.level.beams.filter((o) => o.x < b.x + b.w + 3 && o.x + o.w > b.x - 3);
  }

  /**
   * Move rings and beams to where they are at the current time. A hero standing on a beam rides it; a
   * beam moving into the hero shoves them out of the way. `place` just sets positions (no carrying).
   */
  private updateMovers(place = false) {
    const t = this.time;
    for (const r of this.level.rings) {
      const o = motionOffset(r.m, t);
      r.x = r.bx + o.x; r.y = r.by + o.y;
    }
    for (const k of this.level.sparks!) {
      const o = motionOffset(k.m, t);
      k.x = k.bx + o.x; k.y = k.by + o.y;
    }
    const p = this.player;
    for (const b of this.level.beams) {
      const o = motionOffset(b.m, t);
      const nx = b.bx + o.x, ny = b.by + o.y;
      b.dx = place ? 0 : nx - b.x; b.dy = place ? 0 : ny - b.y;
      const riding = !place && !p.dead && p.vy >= 0 && Math.abs(p.y + p.h - b.y) < 0.06 && p.x < b.x + b.w && p.x + p.w > b.x;
      b.x = nx; b.y = ny;
      if (place || !b.m) continue;
      if (riding) {
        const moved = { x: p.x + b.dx, y: p.y + b.dy, w: p.w, h: p.h };
        if (!boxHitsGrid(moved, this)) { p.x = moved.x; p.y = moved.y; }
      }
      if (overlaps(p, b)) {
        // Shove out along the shallowest side.
        const outs: [number, 'x' | 'y'][] = [
          [b.x - (p.x + p.w), 'x'], [b.x + b.w - p.x, 'x'], [b.y - (p.y + p.h), 'y'], [b.y + b.h - p.y, 'y'],
        ];
        outs.sort((a, c) => Math.abs(a[0]) - Math.abs(c[0]));
        const [d, axis] = outs[0];
        p[axis] += d + Math.sign(d) * 1e-4;
        if (axis === 'y' && d > 0) p.vy = Math.max(p.vy, b.dy / C.STEP);
      }
    }
    // A rope caught on something that moves follows it.
    const h = this.hook;
    if (h.kind === 'anchored' && h.on) { h.x = h.on.x + h.ox; h.y = h.on.y + h.oy; }
  }

  // ---------- Grid ----------

  solid(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.w) return MAT_STONE;
    if (ty < 0 || ty >= this.h) return 0;
    const t = this.level.tiles[ty * this.w + tx];
    return t === Tile.Wood ? MAT_WOOD : t === Tile.Stone ? MAT_STONE : 0;
  }

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return Tile.Empty;
    return this.level.tiles[ty * this.w + tx];
  }

  // ---------- Helpers ----------

  center(): Vec {
    const p = this.player;
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, grav = 18) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.3 + Math.random() * 0.4;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 0.06 + Math.random() * 0.08, grav,
      });
    }
  }

  private onGround(b: Box): boolean {
    const feet = { x: b.x, y: b.y + b.h, w: b.w, h: 0.04 };
    return boxHitsGrid(feet, this) || this.level.beams.some((o) => overlaps(feet, o));
  }

  private kill(reason: string) {
    const p = this.player;
    if (p.dead) return;
    this.lastDeath = { reason, x: p.x + p.w / 2, y: p.y + p.h };
    p.dead = true;
    this.hook = { kind: 'idle' };
    this.burst(p.x + p.w / 2, Math.min(p.y + p.h / 2, this.h - 1), 26, '#ff5a5a', 9);
    this.sfx('death');
  }

  // ---------- Update ----------

  /** Advance one fixed step. */
  update(dt: number, hookDown: boolean, hookPressed: boolean, jumpPressed: boolean) {
    this.updateParticles(dt);
    const p = this.player;
    if (p.dead) return;
    this.time += dt;
    this.updateMovers();

    this.cooldown = Math.max(0, this.cooldown - dt);
    // Forgiving grapple: remember a tap while it's held and fire once the hook is ready. While
    // airborne, wait (within the buffer) for something to lock onto instead of wasting the shot.
    if (hookPressed) this.hookBuffer = C.HOOK_BUFFER;
    else this.hookBuffer = hookDown ? Math.max(0, this.hookBuffer - dt) : 0;
    if (this.hookBuffer > 0 && this.hook.kind === 'idle' && this.cooldown <= 0) {
      const a = this.assistAim();
      if (p.grounded || a.locked || this.hookBuffer <= dt * 1.5) { this.fire(a); this.hookBuffer = 0; }
    }
    this.updateHook(dt, hookDown);
    this.tryJump(dt, jumpPressed);
    this.blockedX = false;
    this.updatePlayer(dt);
    // The tuck ends on its own, on landing, or when the grapple fires (the arm is needed).
    if (this.flipT >= 0) {
      this.flipT += dt;
      if (this.flipT >= C.FLIP_TIME || p.grounded || this.hook.kind !== 'idle') this.flipT = -1;
    }
    this.collectSparks();
    if (p.y > this.h + 1) this.kill('fell');
    this.checkPinned(dt);
  }

  private addMomentum(n: number) { this.momentum = Math.max(0, Math.min(1, this.momentum + n)); }

  /** Pick up any spark the hero touches: bonus metres, a little momentum, and a chime that climbs per streak. */
  private collectSparks() {
    const c = this.center();
    for (const k of this.level.sparks!) {
      if (k.taken || Math.abs(k.x - c.x) > C.SPARK_RADIUS + 0.5) continue;
      if (Math.hypot(k.x - c.x, k.y - c.y) > C.SPARK_RADIUS) continue;
      k.taken = true;
      this.sparks++;
      this.sparkStreak++;
      this.bonus += C.SPARK_BONUS;
      this.addMomentum(C.MOM_SPARK);
      this.burst(k.x, k.y, 8, '#ffe36b', 4, 2);
      this.sfx('spark');
    }
  }

  /**
   * The aim: a fixed 60° shot up and forward. If it would miss, bend up to AIM_ASSIST toward the
   * closest angle that hits something to hang from; rings beat wood. Returns a world point along the
   * chosen direction, plus whether it locks onto something.
   */
  assistAim(): { x: number; y: number; locked: boolean; target?: AimTarget } {
    const c = this.center();
    const stepA = (1.5 * Math.PI) / 180;
    let best: { a: number; pri: number; target?: AimTarget } | null = null;
    for (let k = 0; k * stepA <= C.AIM_ASSIST + 1e-6; k++) {
      for (const s of k === 0 ? [1] : [1, -1]) {
        const a = this.aimAngle + s * k * stepA;
        const hit = this.castHook(c.x, c.y, Math.cos(a), -Math.sin(a), this.hookRange);
        if (!hit || hit.what === 'solid') continue;
        const pri = hit.what === 'ring' ? 2 : 1;
        if (best && pri <= best.pri) continue;
        const on = hit.on;
        const target = on && { on, ox: c.x + Math.cos(a) * hit.t - on.x, oy: c.y - Math.sin(a) * hit.t - on.y };
        if (target && hit.what === 'ring') { target.ox = 0; target.oy = 0; }
        if (target && 'w' in target.on) target.ox = Math.min(target.on.w - 0.15, Math.max(0.15, target.ox));
        best = { a, pri, target };
      }
    }
    const a = best ? best.a : this.aimAngle;
    return { x: c.x + Math.cos(a) * 5, y: c.y - Math.sin(a) * 5, locked: !!best, target: best?.target };
  }

  private fire(aim: Vec & { target?: AimTarget }) {
    const c = this.center();
    let dx = aim.x - c.x, dy = aim.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    dx /= len; dy /= len;
    this.hook = { kind: 'flying', x: c.x, y: c.y, dx, dy, dist: 0, held: true, target: aim.target };
    this.sfx('fire');
  }

  private updateHook(dt: number, hookDown: boolean) {
    const h = this.hook;
    const c = this.center();
    switch (h.kind) {
      case 'flying': {
        if (!hookDown) h.held = false;
        if (h.target) {
          const { on, ox, oy } = h.target;
          // Aim a hair above a beam's underside so the ray still enters through the bottom face.
          const tx = on.x + ox - h.x, ty = on.y + oy - ('w' in on ? 0.02 : 0) - h.y, td = Math.hypot(tx, ty);
          if (td > 1e-3) { h.dx = tx / td; h.dy = ty / td; }
        }
        const step = Math.min(C.HOOK_SPEED * dt, this.hookRange - h.dist);
        const hit = this.castHook(h.x, h.y, h.dx, h.dy, step);
        if (!hit) {
          h.x += h.dx * step; h.y += h.dy * step; h.dist += step;
          if (h.dist >= this.hookRange - 1e-4) {
            this.hook = { kind: 'returning', x: h.x, y: h.y };
            this.sfx('miss');
          }
          return;
        }
        const hx = h.x + h.dx * hit.t, hy = h.y + h.dy * hit.t;
        if (hit.what === 'solid' || !h.held) {
          this.hook = { kind: 'returning', x: hx, y: hy };
          if (hit.what === 'solid') { this.burst(hx, hy, 8, '#cfe3ff', 6, 10); this.sfx('clank'); }
          return;
        }
        const ring = hit.what === 'ring';
        const ax = ring ? hit.rx! : hx, ay = ring ? hit.ry! : hy;
        const len = Math.max(C.ROPE_MIN, Math.hypot(c.x - ax, c.y - ay));
        const on = hit.on;
        this.hook = { kind: 'anchored', x: ax, y: ay, len, ring, on, ox: on ? ax - on.x : 0, oy: on ? ay - on.y : 0 };
        this.burst(ax, ay, 6, ring ? '#7df0ff' : '#e0a464', 4, 6);
        this.sfx('attach');
        this.addLink(null);
        return;
      }
      case 'anchored': {
        if (!hookDown) { this.release(h); return; }
        const dist = Math.hypot(c.x - h.x, c.y - h.y);
        h.len = Math.max(C.ROPE_MIN, Math.min(h.len, dist) - C.REEL_SPEED * dt);
        return;
      }
      case 'returning': {
        const dx = c.x - h.x, dy = c.y - h.y;
        const d = Math.hypot(dx, dy);
        const s = C.HOOK_RETURN_SPEED * dt;
        if (d <= s + 0.3) {
          this.hook = { kind: 'idle' };
          this.cooldown = C.HOOK_COOLDOWN;
        } else {
          h.x += (dx / d) * s; h.y += (dy / d) * s;
        }
        return;
      }
    }
  }

  /** Let go of the rope. Just past the bottom of the swing is a perfect release: a harder fling. */
  private release(h: { x: number; y: number }) {
    const p = this.player;
    this.hook = { kind: 'idle' };
    this.cooldown = C.HOOK_COOLDOWN * 0.5;
    if (this.isPerfect(h)) {
      p.vx += C.PERFECT_FLING_X;
      p.vy -= C.PERFECT_FLING_Y;
      this.perfects++;
      const c = this.center();
      this.burst(c.x, c.y, 14, '#ffe36b', 6, 4);
      this.sfx('perfect');
      this.addMomentum(C.MOM_PERFECT);
      this.addLink('PERFECT');
    }
  }

  /** Would letting go now be a perfect release? (Also used to light up the hero.) */
  isPerfect(h: { x: number; y: number } | null = this.hook.kind === 'anchored' ? this.hook : null): boolean {
    const p = this.player;
    if (!h || p.grounded || p.vx <= 0) return false;
    const c = this.center();
    const a = Math.atan2(c.x - h.x, c.y - h.y); // 0 = straight below the anchor, + = ahead of it
    return a >= C.PERFECT_MIN && a <= C.PERFECT_MAX;
  }

  /** One more chain link; shows the count from ×2 up. */
  private addLink(label: string | null) {
    this.links++;
    this.addMomentum(C.MOM_CATCH);
    const c = this.center();
    const text = this.links >= 2 ? (label ? `${label} ×${this.links}` : `×${this.links}`) : label;
    if (text) this.popup(text, c.x, c.y - 1.4, label ? '#ffe36b' : '#7df0ff', false);
  }

  popup(text: string, x: number, y: number, color: string, big: boolean) {
    this.popups.push({ text, x, y, life: 1, max: 1, color, big });
  }

  /** What the hook would hit first along a ray (also used for the aim preview). */
  castHook(ox: number, oy: number, dx: number, dy: number, maxT: number): HookHit | null {
    let best: HookHit | null = null;
    const g = raycastGrid(ox, oy, dx, dy, maxT, this);
    // Only the underside of wood grips; stone, and the tops and sides of wood, bounce the hook off.
    if (g) best = { t: g.t, what: g.material === MAT_WOOD && g.ny > 0 ? 'wood' : 'solid' };
    for (const r of this.level.rings) {
      const t = rayCircle(ox, oy, dx, dy, maxT, r.x, r.y, C.RING_RADIUS + 0.12);
      if (t !== null && (!best || t < best.t)) best = { t, what: 'ring', rx: r.x, ry: r.y, on: r };
    }
    for (const b of this.level.beams) {
      if (b.x > ox + maxT + 1 || b.x + b.w < ox - maxT - 1) continue;
      const t = rayBox(ox, oy, dx, dy, maxT, b);
      if (t === null || (best && t >= best.t)) continue;
      // Only a ray coming up through the bottom face grips.
      const under = t > 0 && dy < 0 && Math.abs(oy + dy * t - (b.y + b.h)) < 1e-3;
      best = { t, what: under ? 'wood' : 'solid', on: under ? b : undefined };
    }
    return best;
  }

  /** Jump with coyote time and an input buffer, plus one double jump refreshed on landing or grappling. */
  private tryJump(dt: number, pressed: boolean) {
    const p = this.player;
    if (p.grounded || this.hook.kind === 'anchored') this.airJumpsLeft = 1;
    this.coyote = p.grounded ? C.COYOTE : Math.max(0, this.coyote - dt);
    if (pressed && !p.grounded && this.coyote <= 0 && this.airJumpsLeft > 0 && this.hook.kind !== 'anchored') {
      this.airJumpsLeft--;
      p.vy = -C.DOUBLE_JUMP_VEL;
      this.flipT = 0;
      this.jumpBuffer = 0;
      this.burst(p.x + p.w / 2, p.y + p.h, 10, '#7df0ff', 4);
      this.sfx('jump');
      return;
    }
    this.jumpBuffer = pressed ? C.JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer <= 0 || this.coyote <= 0) return;
    p.vy = -C.JUMP_VEL;
    p.grounded = false;
    this.jumpBuffer = this.coyote = 0;
    this.burst(p.x + p.w / 2, p.y + p.h, 6, '#c9b48a', 3);
    this.sfx('jump');
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const h = this.hook;
    const anchored = h.kind === 'anchored';

    if (anchored) this.swung = true;
    this.landBoost = Math.max(0, this.landBoost - (C.LAND_BOOST / C.LAND_BOOST_TIME) * dt);

    // Always running right: accelerate on the ground, steer toward run speed in the air, pump on the rope.
    if (p.grounded) {
      const a = C.GROUND_ACCEL * dt;
      p.vx += Math.max(-a, Math.min(a, this.runSpeed + this.landBoost - p.vx));
    } else if (anchored) {
      p.vx += C.SWING_PUMP * dt;
    } else if (p.vx < this.runSpeed) {
      p.vx = Math.min(this.runSpeed, p.vx + C.AIR_ACCEL * dt);
    }

    p.vy = Math.min(C.MAX_FALL, p.vy + (anchored ? C.SWING_GRAVITY : C.GRAVITY) * dt);

    // Rope: one-sided distance constraint, solved on velocity.
    if (h.kind === 'anchored') {
      const cx = p.x + p.w / 2 + p.vx * dt;
      const cy = p.y + p.h / 2 + p.vy * dt;
      const ddx = cx - h.x, ddy = cy - h.y;
      const d = Math.hypot(ddx, ddy);
      if (d > h.len && d > 1e-4) {
        const nx = ddx / d, ny = ddy / d;
        const vr = p.vx * nx + p.vy * ny;
        if (vr > 0) { p.vx -= nx * vr; p.vy -= ny * vr; }
        const corr = Math.min(14, (d - h.len) / dt);
        p.vx -= nx * corr; p.vy -= ny * corr;
      }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > C.ROPE_MAX_SPEED) { p.vx *= C.ROPE_MAX_SPEED / sp; p.vy *= C.ROPE_MAX_SPEED / sp; }
    }

    const sx = p.x, sy = p.y;
    const near = this.beamsNear(p);
    if (moveAxis(p, 'x', p.vx * dt, this, near)) {
      // Auto step-up over tiny lips, never a full tile.
      let stepped = false;
      if (p.grounded) {
        for (const lift of [0.1, 0.2, 0.3]) {
          const t = { x: sx, y: sy - lift, w: p.w, h: p.h };
          if (boxHitsGrid(t, this) || near.some((o) => overlaps(t, o))) break;
          const before = t.x;
          moveAxis(t, 'x', p.vx * dt, this, near);
          if (Math.abs(t.x - before) > Math.abs(p.x - sx) + 1e-3) {
            p.x = t.x; p.y = t.y; stepped = true;
            break;
          }
        }
      }
      if (!stepped) { p.vx = 0; this.blockedX = true; }
    }
    if (moveAxis(p, 'y', p.vy * dt, this, near)) p.vy = 0;
    const wasGrounded = p.grounded;
    p.grounded = this.onGround(p);
    if (p.grounded && p.vy > 0) p.vy = 0;
    if (p.grounded && !wasGrounded && this.swung) {
      // Landing out of a swing: a short speed burst, at least as fast as the boosted run speed.
      // A chain (2+ links) grows the burst and cashes in as bonus distance.
      const extra = Math.max(0, this.links - 1);
      this.landBoost = C.LAND_BOOST * Math.min(C.CHAIN_BOOST_MAX, 1 + C.CHAIN_BOOST_PER_LINK * extra);
      p.vx = Math.max(p.vx, this.runSpeed + this.landBoost);
      this.burst(p.x, p.y + p.h, 8 + extra * 6, '#7df0ff', 3 + extra, 6);
      if (extra > 0) {
        this.addMomentum(C.MOM_CHAIN * extra);
        const m = C.CHAIN_BONUS_PER_LINK * extra;
        this.bonus += m;
        this.popup(`+${m} m`, p.x + p.w / 2, p.y - 1, '#ffe36b', true);
        this.sfx('chain');
      }
    }
    if (p.grounded && !anchored) { this.swung = false; this.links = 0; this.sparkStreak = 0; }
    // Momentum drains while you stay on the ground (after a short grace), never in the air.
    this.groundTime = p.grounded ? this.groundTime + dt : 0;
    if (this.groundTime > C.MOM_GRACE) this.addMomentum(-C.MOM_DECAY * dt);
  }

  /** Pinned against a wall you can't get past → the run ends (no softlocks). */
  private checkPinned(dt: number) {
    const p = this.player;
    if (p.dead) return;
    if (this.blockedX && p.grounded) {
      // Hanging on the rope pauses the clock; it doesn't reset it.
      if (this.hook.kind !== 'anchored') this.pinned += dt;
    } else if (!this.blockedX) {
      this.pinned = 0;
    }
    if (this.pinned >= C.PIN_KILL) this.kill('pinned');
  }

  private updateParticles(dt: number) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.vy += pt.grav * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const u of this.popups) { u.life -= dt; u.y -= 1.2 * dt; }
    this.popups = this.popups.filter((u) => u.life > 0);
  }

  /** Where the rope's far end is, for drawing. */
  hookTip(): Vec | null {
    const h = this.hook;
    return h.kind === 'idle' ? null : { x: h.x, y: h.y };
  }
}

