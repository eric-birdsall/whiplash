import * as C from './config';
import { Level, Tile, Vec } from './level';
import { Box, Grid, boxHitsGrid, moveAxis, overlaps, raycastGrid, rayBox, rayCircle } from './physics';

export const MAT_WOOD = 1;
export const MAT_METAL = 2;
export const MAT_STONE = 3;

export interface Body extends Box {
  vx: number;
  vy: number;
}

export interface Player extends Body {
  grounded: boolean;
  facing: number;
  dead: boolean;
  deadTimer: number;
  keys: number;
}

export interface Crate extends Body {
  home: Vec;
  grounded: boolean;
}

export interface KeyObj {
  x: number; // center
  y: number;
  home: Vec;
  collected: boolean;
  bob: number;
}

export interface Lever { tx: number; ty: number; on: boolean; }
export interface Plate { tx: number; ty: number; pressed: boolean; }
export interface Door { cells: Vec[]; open: boolean; }

export type Target =
  | { kind: 'key'; key: KeyObj }
  | { kind: 'crate'; crate: Crate };

export type Hook =
  | { kind: 'idle' }
  | { kind: 'flying'; x: number; y: number; dx: number; dy: number; dist: number; held: boolean }
  | { kind: 'anchored'; x: number; y: number; len: number; ring: boolean }
  | { kind: 'pulling'; target: Target; t: number; blocked: number }
  | { kind: 'returning'; x: number; y: number };

export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number;
}

export type Sfx = 'fire' | 'attach' | 'clank' | 'miss' | 'pull' | 'key' | 'door' | 'lever' | 'plate'
  | 'gate' | 'death' | 'checkpoint' | 'mantle' | 'win' | 'jump';

interface Snapshot {
  crates: { x: number; y: number }[];
  keys: { x: number; y: number; collected: boolean }[];
  levers: boolean[];
  doors: boolean[];
  playerKeys: number;
}

export class Game implements Grid {
  w: number;
  h: number;
  player: Player;
  hook: Hook = { kind: 'idle' };
  cooldown = 0;
  /** Runner mode: wood only catches the hook on its underside (a ceiling), not ledge tops or walls. */
  ceilingOnly = false;
  hookRange = C.HOOK_RANGE;
  private jumpBuffer = 0;
  private coyote = 0;
  crates: Crate[];
  keys: KeyObj[];
  levers: Lever[];
  plates: Plate[];
  doors: Door[];
  gates: Vec[];
  gatesOpen = false;
  checkpoint: Vec;
  checkpointIndex = -1;
  particles: Particle[] = [];
  deaths = 0;
  time = 0;
  completed = false;
  private dyn: Uint8Array; // dynamic solids (closed doors/gates) → material
  private snap!: Snapshot;

  constructor(public level: Level, private sfx: (s: Sfx) => void = () => {}) {
    this.w = level.w;
    this.h = level.h;
    this.dyn = new Uint8Array(level.w * level.h);
    this.player = {
      x: 0, y: 0, w: C.PLAYER_W, h: C.PLAYER_H, vx: 0, vy: 0,
      grounded: false, facing: 1, dead: false, deadTimer: 0, keys: 0,
    };
    this.crates = level.crates.map((c) => ({
      x: c.x - C.CRATE_SIZE / 2, y: c.y - C.CRATE_SIZE, w: C.CRATE_SIZE, h: C.CRATE_SIZE,
      vx: 0, vy: 0, home: { ...c }, grounded: false,
    }));
    this.keys = level.keys.map((k, i) => ({ x: k.x, y: k.y, home: { ...k }, collected: false, bob: i * 1.7 }));
    this.levers = level.levers.map((l) => ({ tx: l.x, ty: l.y, on: false }));
    this.plates = level.plates.map((p) => ({ tx: p.x, ty: p.y, pressed: false }));
    this.doors = level.doors.map((cells) => ({ cells, open: false }));
    this.gates = level.gates;
    this.checkpoint = { ...level.start };
    this.rebuildDyn();
    this.takeSnapshot();
    this.placePlayer();
  }

  // ---------- Grid ----------

  solid(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.w || ty < 0) return MAT_METAL;
    if (ty >= this.h) return 0;
    const i = ty * this.w + tx;
    const t = this.level.tiles[i];
    if (t === Tile.Wood) return MAT_WOOD;
    if (t === Tile.Metal) return MAT_METAL;
    if (t === Tile.Stone) return MAT_STONE;
    return this.dyn[i];
  }

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return Tile.Empty;
    return this.level.tiles[ty * this.w + tx];
  }

  private rebuildDyn() {
    this.dyn.fill(0);
    for (const d of this.doors) if (!d.open) for (const c of d.cells) this.dyn[c.y * this.w + c.x] = MAT_METAL;
    if (!this.gatesOpen) for (const g of this.gates) this.dyn[g.y * this.w + g.x] = MAT_METAL;
  }

  // ---------- Checkpoints / death ----------

  private takeSnapshot() {
    this.snap = {
      crates: this.crates.map((c) => ({ x: c.x, y: c.y })),
      keys: this.keys.map((k) => ({ x: k.x, y: k.y, collected: k.collected })),
      levers: this.levers.map((l) => l.on),
      doors: this.doors.map((d) => d.open),
      playerKeys: this.player.keys,
    };
  }

  private restoreSnapshot() {
    const s = this.snap;
    this.crates.forEach((c, i) => { c.x = s.crates[i].x; c.y = s.crates[i].y; c.vx = 0; c.vy = 0; });
    this.keys.forEach((k, i) => { k.x = s.keys[i].x; k.y = s.keys[i].y; k.collected = s.keys[i].collected; });
    this.levers.forEach((l, i) => { l.on = s.levers[i]; });
    this.doors.forEach((d, i) => { d.open = s.doors[i]; });
    this.player.keys = s.playerKeys;
    this.updateTriggers(true);
    this.rebuildDyn();
  }

  private placePlayer() {
    const p = this.player;
    p.x = this.checkpoint.x - p.w / 2;
    p.y = this.checkpoint.y - p.h - 0.01;
    p.vx = p.vy = 0;
    p.dead = false;
    p.grounded = false;
    this.hook = { kind: 'idle' };
    this.jumpBuffer = this.coyote = 0;
  }

  restart() {
    if (this.completed) return;
    this.restoreSnapshot();
    this.placePlayer();
  }

  private kill() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.deadTimer = C.RESPAWN_DELAY;
    this.deaths++;
    this.hook = { kind: 'idle' };
    this.burst(p.x + p.w / 2, p.y + p.h / 2, 26, '#ff5a5a', 9);
    this.sfx('death');
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

  private crateBoxes(except?: Box): Box[] {
    return this.crates.filter((c) => c !== except);
  }

  private onGround(b: Box, obstacles: Box[]): boolean {
    const probe = { x: b.x, y: b.y + b.h, w: b.w, h: 0.04 };
    if (boxHitsGrid(probe, this)) return true;
    return obstacles.some((o) => o !== b && overlaps(probe, o));
  }

  // ---------- Update ----------

  /** Advance one fixed step. aim is in world coordinates. */
  update(dt: number, moveX: number, hookDown: boolean, hookPressed: boolean, aim: Vec, jumpPressed = false) {
    this.updateParticles(dt);
    for (const k of this.keys) k.bob += dt;
    if (this.completed) return;
    this.time += dt;

    const p = this.player;
    if (p.dead) {
      p.deadTimer -= dt;
      if (p.deadTimer <= 0) {
        this.restoreSnapshot();
        this.placePlayer();
      }
      return;
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    if (hookPressed && this.hook.kind === 'idle' && this.cooldown <= 0) this.fire(aim);
    this.updateHook(dt, hookDown);
    this.tryJump(dt, jumpPressed);
    this.updatePlayer(dt, moveX);
    if (this.hook.kind === 'anchored') this.tryMantle();
    this.updateCrates(dt);
    this.updateDoors();
    this.updateTriggers(false);
    this.checkHazards();
    this.checkFlags();
  }

  /**
   * Runner aim: a fixed 45° shot up and forward. If it would miss, bend up to AIM_ASSIST toward the
   * closest angle that hits something grabbable (wood ceiling, ring, key, crate, lever).
   * Returns a world point along the chosen direction, plus whether it locks onto something.
   */
  assistAim(): { x: number; y: number; locked: boolean } {
    const c = this.center();
    const f = this.player.facing >= 0 ? 1 : -1;
    const stepA = (1.5 * Math.PI) / 180;
    for (let k = 0; k * stepA <= C.AIM_ASSIST + 1e-6; k++) {
      for (const s of k === 0 ? [1] : [1, -1]) {
        const a = C.AUTO_AIM_ANGLE + s * k * stepA;
        const dx = Math.cos(a) * f, dy = -Math.sin(a);
        const hit = this.castHook(c.x, c.y, dx, dy, this.hookRange);
        if (hit && hit.what !== 'metal') return { x: c.x + dx * 5, y: c.y + dy * 5, locked: true };
      }
    }
    const a = C.AUTO_AIM_ANGLE;
    return { x: c.x + Math.cos(a) * f * 5, y: c.y - Math.sin(a) * 5, locked: false };
  }

  private fire(aim: Vec) {
    const c = this.center();
    let dx = aim.x - c.x, dy = aim.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    dx /= len; dy /= len;
    this.hook = { kind: 'flying', x: c.x, y: c.y, dx, dy, dist: 0, held: true };
    if (Math.abs(dx) > 0.2) this.player.facing = Math.sign(dx);
    this.sfx('fire');
  }

  private updateHook(dt: number, hookDown: boolean) {
    const h = this.hook;
    const c = this.center();
    switch (h.kind) {
      case 'flying': {
        if (!hookDown) h.held = false;
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
        switch (hit.what) {
          case 'wood':
          case 'ring': {
            if (!h.held) { this.hook = { kind: 'returning', x: hx, y: hy }; return; }
            const ax = hit.what === 'ring' ? hit.rx! : hx;
            const ay = hit.what === 'ring' ? hit.ry! : hy;
            const len = Math.max(C.ROPE_MIN, Math.hypot(c.x - ax, c.y - ay));
            this.hook = { kind: 'anchored', x: ax, y: ay, len, ring: hit.what === 'ring' };
            this.burst(ax, ay, 6, hit.what === 'ring' ? '#7df0ff' : '#e0a464', 4, 6);
            this.sfx('attach');
            return;
          }
          case 'metal':
            this.hook = { kind: 'returning', x: hx, y: hy };
            this.burst(hx, hy, 8, '#cfe3ff', 6, 10);
            this.sfx('clank');
            return;
          case 'lever': {
            const lv = hit.lever!;
            lv.on = !lv.on;
            this.hook = { kind: 'returning', x: hx, y: hy };
            this.burst(hx, hy, 8, '#ffd23f', 4, 6);
            this.sfx('lever');
            return;
          }
          case 'key':
            this.hook = { kind: 'pulling', target: { kind: 'key', key: hit.key! }, t: 0, blocked: 0 };
            this.sfx('pull');
            return;
          case 'crate':
            this.hook = { kind: 'pulling', target: { kind: 'crate', crate: hit.crate! }, t: 0, blocked: 0 };
            this.sfx('pull');
            return;
        }
        return;
      }
      case 'anchored': {
        if (!hookDown) { this.hook = { kind: 'idle' }; this.cooldown = C.HOOK_COOLDOWN * 0.5; return; }
        const dist = Math.hypot(c.x - h.x, c.y - h.y);
        h.len = Math.max(C.ROPE_MIN, Math.min(h.len, dist) - C.REEL_SPEED * dt);
        return;
      }
      case 'pulling': {
        h.t += dt;
        const tg = h.target;
        if (tg.kind === 'key') {
          const k = tg.key;
          const dx = c.x - k.x, dy = c.y - k.y;
          const d = Math.hypot(dx, dy);
          const s = Math.min(d, C.PULL_SPEED * 1.3 * dt);
          k.x += (dx / d) * s; k.y += (dy / d) * s;
          if (d < 0.6) this.collectKey(k);
        } else {
          const cr = tg.crate;
          const dx = c.x - (cr.x + cr.w / 2);
          // Stops when something blocks it — usually the player, or a trench wall.
          if (h.blocked > 0.08 || h.t > 2.5 || Math.abs(dx) < 0.2) {
            cr.vx *= 0.3;
            this.hook = { kind: 'idle' };
            this.cooldown = C.HOOK_COOLDOWN;
            return;
          }
          // Horizontal drag; gravity still applies so crates fall into gaps.
          const target = Math.sign(dx) * C.PULL_SPEED;
          cr.vx += (target - cr.vx) * Math.min(1, 12 * dt);
        }
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

  /** What the hook would hit first along a ray (also used for the aim preview). */
  castHook(ox: number, oy: number, dx: number, dy: number, maxT: number) {
    type Hit = {
      t: number; what: 'wood' | 'metal' | 'ring' | 'key' | 'crate' | 'lever';
      rx?: number; ry?: number; key?: KeyObj; crate?: Crate; lever?: Lever;
    };
    let best: Hit | null = null;
    const consider = (h: Hit) => { if (!best || h.t < best.t) best = h; };

    const g = raycastGrid(ox, oy, dx, dy, maxT, this);
    if (g) {
      // Runner: only wood undersides grip. Classic: wood and stone grip on any face.
      const grips = this.ceilingOnly
        ? g.material === MAT_WOOD && g.ny > 0
        : g.material === MAT_WOOD || g.material === MAT_STONE;
      consider({ t: g.t, what: grips ? 'wood' : 'metal' });
    }

    for (const r of this.level.rings) {
      const t = rayCircle(ox, oy, dx, dy, maxT, r.x, r.y, C.RING_RADIUS + 0.12);
      if (t !== null) consider({ t, what: 'ring', rx: r.x, ry: r.y });
    }
    for (const k of this.keys) {
      if (k.collected) continue;
      const s = C.KEY_SIZE + 0.2;
      const t = rayBox(ox, oy, dx, dy, maxT, { x: k.x - s / 2, y: k.y - s / 2, w: s, h: s });
      if (t !== null) consider({ t, what: 'key', key: k });
    }
    for (const cr of this.crates) {
      const t = rayBox(ox, oy, dx, dy, maxT, cr);
      if (t !== null) consider({ t, what: 'crate', crate: cr });
    }
    for (const lv of this.levers) {
      const t = rayBox(ox, oy, dx, dy, maxT, { x: lv.tx + 0.1, y: lv.ty + 0.1, w: 0.8, h: 0.8 });
      if (t !== null) consider({ t, what: 'lever', lever: lv });
    }
    return best as Hit | null;
  }

  /** Runner-mode jump, with coyote time and an input buffer so taps feel fair. */
  private tryJump(dt: number, pressed: boolean) {
    const p = this.player;
    this.jumpBuffer = pressed ? C.JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    this.coyote = p.grounded ? C.COYOTE : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer <= 0 || this.coyote <= 0) return;
    p.vy = -C.JUMP_VEL;
    p.grounded = false;
    this.jumpBuffer = this.coyote = 0;
    this.burst(p.x + p.w / 2, p.y + p.h, 6, '#c9b48a', 3);
    this.sfx('jump');
  }

  private updatePlayer(dt: number, moveX: number) {
    const p = this.player;
    const h = this.hook;
    const anchored = h.kind === 'anchored';
    if (moveX) p.facing = moveX;

    // Horizontal control
    if (p.grounded) {
      const target = moveX * C.RUN_SPEED;
      if (moveX) {
        const a = C.GROUND_ACCEL * dt;
        p.vx += Math.max(-a, Math.min(a, target - p.vx));
      } else {
        const f = C.GROUND_FRICTION * dt;
        p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
      }
    } else if (anchored) {
      p.vx += moveX * C.SWING_PUMP * dt;
    } else {
      if (moveX) {
        const target = moveX * C.RUN_SPEED;
        if ((moveX > 0 && p.vx < target) || (moveX < 0 && p.vx > target)) {
          p.vx += moveX * C.AIR_ACCEL * dt;
          if ((moveX > 0 && p.vx > target) || (moveX < 0 && p.vx < target)) p.vx = target;
        }
      } else {
        p.vx *= 1 - C.AIR_DRAG * dt;
      }
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

    const crates = this.crates;
    let pushing = false;
    const push = (o: Box, dx: number) => {
      const cr = o as Crate;
      pushing = true;
      const before = cr.x;
      moveAxis(cr, 'x', dx, this, [...this.crateBoxes(cr)]);
      return cr.x - before;
    };
    const sx = p.x, sy = p.y;
    if (moveAxis(p, 'x', p.vx * dt, this, crates, p.grounded ? push : undefined)) {
      // Auto step-up over tiny lips (e.g. a crate sitting in a trench), never a full tile.
      let stepped = false;
      if (p.grounded) {
        for (const lift of [0.1, 0.2, 0.3]) {
          const t = { x: sx, y: sy - lift, w: p.w, h: p.h };
          if (boxHitsGrid(t, this) || crates.some((c) => overlaps(t, c))) break;
          const before = t.x;
          moveAxis(t, 'x', p.vx * dt, this, crates);
          if (Math.abs(t.x - before) > Math.abs(p.x - sx) + 1e-3) {
            p.x = t.x; p.y = t.y; stepped = true;
            break;
          }
        }
      }
      if (!stepped) p.vx = 0;
    }
    if (pushing) p.vx = Math.max(-C.PUSH_SPEED, Math.min(C.PUSH_SPEED, p.vx));
    if (moveAxis(p, 'y', p.vy * dt, this, crates)) p.vy = 0;
    p.grounded = this.onGround(p, crates);
    if (p.grounded && p.vy > 0) p.vy = 0;
  }

  /** Reeled against a wall with the anchor on its ledge top → pop up onto the ledge. */
  private tryMantle() {
    const h = this.hook;
    if (h.kind !== 'anchored') return;
    const p = this.player;
    const cx = p.x + p.w / 2;
    const s = Math.sign(h.x - cx);
    if (Math.abs(h.x - cx) < 0.05) return;
    const col = s > 0 ? Math.floor(p.x + p.w + 0.08) : Math.floor(p.x - 0.08);
    const face = s > 0 ? col : col + 1;
    if (Math.abs((s > 0 ? p.x + p.w : p.x) - face) > 0.1) return;

    const top = p.y, bottom = p.y + p.h;
    for (let ty = Math.floor(top - 0.7); ty <= Math.floor(bottom - 0.05); ty++) {
      if (!this.solid(col, ty) || this.solid(col, ty - 1)) continue;
      const r = ty;
      if (r < top - 0.7 || r > bottom - 0.05) continue;
      if (h.y > r + 0.75) continue;
      if (s * (h.x - face) < -0.3) continue;
      const dest: Box = { x: s > 0 ? col + 0.05 : col + 1 - p.w - 0.05, y: r - p.h - 0.01, w: p.w, h: p.h };
      if (boxHitsGrid(dest, this)) continue;
      if (this.crates.some((c) => overlaps(dest, c))) continue;
      p.x = dest.x; p.y = dest.y;
      p.vx = s * 2; p.vy = 0;
      this.hook = { kind: 'idle' };
      this.cooldown = C.HOOK_COOLDOWN;
      this.sfx('mantle');
      this.burst(p.x + p.w / 2, r, 8, '#e0a464', 3, 8);
      return;
    }
  }

  private updateCrates(dt: number) {
    const p = this.player;
    const pulling = this.hook.kind === 'pulling' && this.hook.target.kind === 'crate' ? this.hook.target.crate : null;
    for (const cr of this.crates) {
      cr.vy = Math.min(C.MAX_FALL, cr.vy + C.GRAVITY * dt);
      if (cr.grounded && cr !== pulling) {
        const f = 30 * dt;
        cr.vx = Math.abs(cr.vx) <= f ? 0 : cr.vx - Math.sign(cr.vx) * f;
      }
      const others = [...this.crateBoxes(cr), p];
      const bx = moveAxis(cr, 'x', cr.vx * dt, this, others);
      if (bx) {
        cr.vx = 0;
        if (cr === pulling && this.hook.kind === 'pulling') this.hook.blocked += dt;
      } else if (cr === pulling && this.hook.kind === 'pulling') {
        this.hook.blocked = 0;
      }
      // At rest, ease onto the tile grid so crates drop into 1-wide holes and stack neatly.
      if (cr !== pulling && cr.grounded && Math.abs(cr.vx) < 0.5) {
        const off = (1 - cr.w) / 2;
        const lo = Math.floor(cr.x - off) + off, hi = lo + 1;
        const drops = (x: number) => {
          const b = { x, y: cr.y + 0.2, w: cr.w, h: cr.h };
          return !boxHitsGrid(b, this) && !others.some((o) => overlaps(b, o));
        };
        let tx = cr.x - lo < hi - cr.x ? lo : hi;
        if (drops(lo) !== drops(hi)) tx = drops(lo) ? lo : hi;
        const dx = tx - cr.x;
        if (Math.abs(dx) > 1e-3) moveAxis(cr, 'x', Math.sign(dx) * Math.min(Math.abs(dx), 3 * dt), this, others);
      }
      if (moveAxis(cr, 'y', cr.vy * dt, this, others)) cr.vy = 0;
      cr.grounded = this.onGround(cr, others);
      if (cr.y > this.h + 3) {
        cr.x = cr.home.x - cr.w / 2; cr.y = cr.home.y - cr.h; cr.vx = cr.vy = 0;
        if (cr === pulling) this.hook = { kind: 'idle' };
      }
    }
  }

  private collectKey(k: { x: number; y: number; collected: boolean }) {
    k.collected = true;
    this.player.keys++;
    this.burst(k.x, k.y, 14, '#ffd23f', 5, 4);
    this.sfx('key');
    const h = this.hook;
    if (h.kind === 'pulling' && h.target.kind === 'key' && h.target.key === k) {
      this.hook = { kind: 'idle' };
      this.cooldown = C.HOOK_COOLDOWN;
    }
  }

  private updateDoors() {
    const p = this.player;
    // Running (or jumping) into a key grabs it too.
    for (const k of this.keys) {
      if (k.collected) continue;
      const s = C.KEY_SIZE;
      if (overlaps(p, { x: k.x - s / 2, y: k.y - s / 2, w: s, h: s })) this.collectKey(k);
    }
    if (p.keys <= 0) return;
    const reach = { x: p.x - 0.15, y: p.y - 0.15, w: p.w + 0.3, h: p.h + 0.3 };
    for (const d of this.doors) {
      if (d.open) continue;
      if (d.cells.some((c) => overlaps(reach, { x: c.x, y: c.y, w: 1, h: 1 }))) {
        d.open = true;
        p.keys--;
        for (const c of d.cells) this.burst(c.x + 0.5, c.y + 0.5, 6, '#ffd23f', 4, 4);
        this.rebuildDyn();
        this.sfx('door');
        if (p.keys <= 0) return;
      }
    }
  }

  private updateTriggers(silent: boolean) {
    const bodies: Box[] = [this.player, ...this.crates];
    for (const pl of this.plates) {
      const zone = { x: pl.tx + 0.05, y: pl.ty + 0.6, w: 0.9, h: 0.45 };
      const was = pl.pressed;
      pl.pressed = bodies.some((b) => !(b === this.player && this.player.dead) && overlaps(b, zone));
      if (!silent && pl.pressed !== was) this.sfx('plate');
    }
    const triggers = this.plates.length + this.levers.length;
    const want = triggers > 0 && this.plates.every((p) => p.pressed) && this.levers.every((l) => l.on);
    if (want === this.gatesOpen) return;
    if (!want) {
      // Don't close a gate on top of something.
      const blocked = this.gates.some((g) => bodies.some((b) => overlaps(b, { x: g.x, y: g.y, w: 1, h: 1 })));
      if (blocked) return;
    }
    this.gatesOpen = want;
    this.rebuildDyn();
    if (!silent) this.sfx('gate');
  }

  private checkHazards() {
    const p = this.player;
    if (p.y > this.h + 1) { this.kill(); return; }
    const x0 = Math.floor(p.x), x1 = Math.floor(p.x + p.w);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + p.h);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (this.tileAt(tx, ty) !== Tile.Spikes) continue;
        if (overlaps(p, { x: tx + 0.12, y: ty + 0.3, w: 0.76, h: 0.7 })) { this.kill(); return; }
      }
  }

  private checkFlags() {
    const p = this.player;
    this.level.checkpoints.forEach((cp, i) => {
      if (i === this.checkpointIndex) return;
      if (overlaps(p, { x: cp.x - 0.5, y: cp.y - 2, w: 1, h: 2 })) {
        this.checkpointIndex = i;
        this.checkpoint = { ...cp };
        this.takeSnapshot();
        this.burst(cp.x, cp.y - 1.6, 14, '#7dff9a', 5, 4);
        this.sfx('checkpoint');
      }
    });
    const e = this.level.exit;
    if (overlaps(p, { x: e.x - 0.5, y: e.y - 2, w: 1, h: 2 })) {
      this.completed = true;
      this.hook = { kind: 'idle' };
      this.burst(e.x, e.y - 1.5, 40, '#ffd23f', 9, 6);
      this.sfx('win');
    }
  }

  private updateParticles(dt: number) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.vy += pt.grav * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  /** Where the rope's far end is, for drawing. */
  hookTip(): Vec | null {
    const h = this.hook;
    switch (h.kind) {
      case 'idle': return null;
      case 'flying': case 'anchored': case 'returning': return { x: h.x, y: h.y };
      case 'pulling':
        return h.target.kind === 'key'
          ? { x: h.target.key.x, y: h.target.key.y }
          : { x: h.target.crate.x + h.target.crate.w / 2, y: h.target.crate.y + h.target.crate.h / 2 };
    }
  }
}
