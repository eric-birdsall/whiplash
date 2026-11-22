// Tile-grid AABB collision and ray casting. Boxes use top-left x,y.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Grid {
  w: number;
  h: number;
  /** Material of a solid cell (0 = not solid). Out of bounds: sides/top solid metal, bottom open. */
  solid(tx: number, ty: number): number;
}

const EPS = 1e-6;

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boxHitsGrid(b: Box, g: Grid): boolean {
  const x0 = Math.floor(b.x), x1 = Math.floor(b.x + b.w - EPS);
  const y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - EPS);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) if (g.solid(tx, ty)) return true;
  return false;
}

/** Push callback: try to move obstacle `o` by dx; return how far it actually moved. */
export type PushFn = (o: Box, dx: number) => number;

/**
 * Move a box along one axis by `d`, stopping at tiles and obstacles.
 * Returns true if blocked.
 */
export function moveAxis(
  b: Box, axis: 'x' | 'y', d: number, g: Grid, obstacles: Box[] = [], push?: PushFn,
): boolean {
  let blocked = false;
  let remaining = d;
  while (Math.abs(remaining) > EPS) {
    const step = Math.sign(remaining) * Math.min(Math.abs(remaining), 0.4);
    remaining -= step;
    b[axis] += step;

    // Tiles
    if (boxHitsGrid(b, g)) {
      blocked = true;
      if (axis === 'x') {
        b.x = step > 0 ? Math.floor(b.x + b.w) - b.w - EPS * 10 : Math.floor(b.x) + 1 + EPS * 10;
      } else {
        b.y = step > 0 ? Math.floor(b.y + b.h) - b.h - EPS * 10 : Math.floor(b.y) + 1 + EPS * 10;
      }
      // Tiny safety: if still overlapping (corner case), undo the step.
      if (boxHitsGrid(b, g)) b[axis] -= step;
      break;
    }

    // Obstacles (crates, for the player)
    for (const o of obstacles) {
      if (o === b || !overlaps(b, o)) continue;
      if (axis === 'x' && push) {
        const want = step > 0 ? b.x + b.w - o.x : b.x - (o.x + o.w);
        push(o, want);
        if (!overlaps(b, o)) continue;
      }
      blocked = true;
      const size = axis === 'x' ? b.w : b.h;
      const oPos = o[axis];
      const oSize = axis === 'x' ? o.w : o.h;
      b[axis] = step > 0 ? oPos - size - EPS * 10 : oPos + oSize + EPS * 10;
    }
    if (blocked) break;
  }
  return blocked;
}

export interface RayHit {
  t: number; // distance along ray
  x: number;
  y: number;
  tx: number;
  ty: number;
  material: number;
  nx: number;
  ny: number;
}

/** Amanatides–Woo DDA through the tile grid. dir must be normalized. */
export function raycastGrid(ox: number, oy: number, dx: number, dy: number, maxT: number, g: Grid): RayHit | null {
  let tx = Math.floor(ox), ty = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? tx + 1 - ox : ox - tx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? ty + 1 - oy : oy - ty) * tDeltaY : Infinity;
  let t = 0, nx = 0, ny = 0;

  const startMat = g.solid(tx, ty);
  if (startMat) return { t: 0, x: ox, y: oy, tx, ty, material: startMat, nx: 0, ny: 0 };

  while (t <= maxT) {
    if (tMaxX < tMaxY) {
      t = tMaxX; tMaxX += tDeltaX; tx += stepX; nx = -stepX; ny = 0;
    } else {
      t = tMaxY; tMaxY += tDeltaY; ty += stepY; nx = 0; ny = -stepY;
    }
    if (t > maxT) break;
    if (ty >= g.h + 2) break;
    const m = g.solid(tx, ty);
    if (m) return { t, x: ox + dx * t, y: oy + dy * t, tx, ty, material: m, nx, ny };
  }
  return null;
}

/** Ray vs AABB (slab). Returns entry distance or null. */
export function rayBox(ox: number, oy: number, dx: number, dy: number, maxT: number, b: Box): number | null {
  let tmin = 0, tmax = maxT;
  for (const [o, d, lo, hi] of [[ox, dx, b.x, b.x + b.w], [oy, dy, b.y, b.y + b.h]] as const) {
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Ray vs circle. */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, maxT: number, cx: number, cy: number, r: number): number | null {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return c < 0 ? 0 : null;
  return t;
}
