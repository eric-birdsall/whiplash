// ASCII map → Level data. See PLAN.md for the legend.

export const enum Tile {
  Empty = 0,
  Wood = 1,
  Metal = 2,
  Spikes = 3,
}

export interface LevelDef {
  name: string;
  hint?: string;
  map: string[];
}

export type Vec = { x: number; y: number };

export interface Level {
  name: string;
  hint?: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  start: Vec;
  exit: Vec;
  checkpoints: Vec[];
  rings: Vec[];
  keys: Vec[];
  crates: Vec[];
  plates: Vec[];
  levers: Vec[];
  doors: Vec[][]; // groups of tile coords
  gates: Vec[];
}

export function parseLevel(def: LevelDef): Level {
  const rows = def.map;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tiles = new Uint8Array(w * h);
  const lvl: Level = {
    name: def.name, hint: def.hint, w, h, tiles,
    start: { x: 1, y: 1 }, exit: { x: w - 2, y: 1 },
    checkpoints: [], rings: [], keys: [], crates: [], plates: [], levers: [], doors: [], gates: [],
  };
  const doorCells: Vec[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] ?? '.';
      const i = y * w + x;
      switch (c) {
        case '#': tiles[i] = Tile.Wood; break;
        case '=': tiles[i] = Tile.Metal; break;
        case '^': tiles[i] = Tile.Spikes; break;
        case 'o': lvl.rings.push({ x: x + 0.5, y: y + 0.5 }); break;
        case 'K': lvl.keys.push({ x: x + 0.5, y: y + 0.5 }); break;
        case 'C': lvl.crates.push({ x: x + 0.5, y: y + 1 }); break; // bottom-center
        case 'P': lvl.plates.push({ x, y }); break;
        case 'L': lvl.levers.push({ x, y }); break;
        case 'D': doorCells.push({ x, y }); break;
        case 'G': lvl.gates.push({ x, y }); break;
        case 'S': lvl.start = { x: x + 0.5, y: y + 1 }; break;
        case 'E': lvl.exit = { x: x + 0.5, y: y + 1 }; break;
        case 'F': lvl.checkpoints.push({ x: x + 0.5, y: y + 1 }); break;
      }
    }
  }

  // Group door cells by 4-connectivity.
  const seen = new Set<string>();
  for (const cell of doorCells) {
    const k = `${cell.x},${cell.y}`;
    if (seen.has(k)) continue;
    const group: Vec[] = [];
    const stack = [cell];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop()!;
      group.push(c);
      for (const n of doorCells) {
        const nk = `${n.x},${n.y}`;
        if (!seen.has(nk) && Math.abs(n.x - c.x) + Math.abs(n.y - c.y) === 1) {
          seen.add(nk);
          stack.push(n);
        }
      }
    }
    lvl.doors.push(group);
  }
  return lvl;
}
