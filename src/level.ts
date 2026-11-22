// World data for the Endless run (built by src/endless.ts).

export const enum Tile {
  Empty = 0,
  Wood = 1, // grapple surface: only its underside catches the hook
  Stone = 4, // floating platforms
}

export type Vec = { x: number; y: number };

export interface Level {
  name: string;
  hint?: string;
  w: number;
  h: number;
  tiles: Uint8Array; // row-major, w * h
  start: Vec; // feet position
  rings: Vec[];
}
