// World data for the Endless run (built by src/endless.ts).

export const enum Tile {
  Empty = 0,
  Wood = 1, // grapple surface: only its underside catches the hook
  Stone = 4, // floating platforms
}

export type Vec = { x: number; y: number };

/** Back-and-forth sine motion around a home position: offset = (ax, ay) · sin(2π·t/period + phase). */
export interface Motion { ax: number; ay: number; period: number; phase: number }

/** A grapple ring. x, y = where it is now; bx, by = home. */
export interface Ring { x: number; y: number; bx: number; by: number; m?: Motion }

/**
 * A hanging wood beam (top-left x, y; w × h tiles). Solid for the hero; only its underside catches the
 * hook. dx, dy = how far it moved this step (to carry a rider).
 */
export interface Beam { x: number; y: number; w: number; h: number; bx: number; by: number; m?: Motion; dx: number; dy: number }

/** A pickup. Moves with the anchor it belongs to (same Motion), so its arc stays reachable. */
export interface Spark { x: number; y: number; bx: number; by: number; m?: Motion; taken: boolean }

export interface Level {
  name: string;
  hint?: string;
  w: number;
  h: number;
  tiles: Uint8Array; // row-major, w * h
  start: Vec; // feet position
  rings: Ring[];
  beams: Beam[];
  sparks?: Spark[];
}

/** Where a moving thing's home is offset to at time t. */
export function motionOffset(m: Motion | undefined, t: number): Vec {
  if (!m) return { x: 0, y: 0 };
  const s = Math.sin((2 * Math.PI * t) / m.period + m.phase);
  return { x: m.ax * s, y: m.ay * s };
}
