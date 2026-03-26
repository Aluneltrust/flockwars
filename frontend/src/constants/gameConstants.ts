// ============================================================================
// GAME CONSTANTS
// ============================================================================

export const MAX_SHEEP = 10;
export const CELL_EMPTY = 0;
export const CELL_SHEEP = 1;
export const CELL_HIT = 2;
export const CELL_MISS = 3;

// Configuration from environment
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3004';
export const BSV_NETWORK = import.meta.env.VITE_BSV_NETWORK || 'main';
// NOTE: TAAL_API_KEY lives server-side only (process.env.TAAL_API_KEY)
// Never expose API keys in the frontend bundle

// ============================================================================
// STAKE TIERS — must match server's constants.ts
// ============================================================================
// missCents: shooter pays escrow on miss
// hitCents: defender pays shooter on hit
// Server converts cents → sats at match time using live BSV price

export interface StakeTierDef {
  tier: number;
  name: string;
  missCents: number;
  hitCents: number;
}

export const STAKE_TIERS: StakeTierDef[] = [
  { tier: 1,   name: 'Penny',    missCents: 0.5,  hitCents: 1   },
  { tier: 5,   name: 'Nickel',   missCents: 2.5,  hitCents: 5   },
  { tier: 10,  name: 'Dime',     missCents: 5,    hitCents: 10  },
  { tier: 25,  name: 'Quarter',  missCents: 12.5, hitCents: 25  },
  { tier: 50,  name: 'Half',     missCents: 25,   hitCents: 50  },
  { tier: 100, name: 'Dollar',   missCents: 50,   hitCents: 100 },
];

export function getTierByValue(tier: number): StakeTierDef | undefined {
  return STAKE_TIERS.find(t => t.tier === tier);
}

// Arena helpers
export const createEmptyArena = (): Record<string, number> => ({});

// Hexagonal arena shape (7 rows forming a hexagon)
export const ARENA_ROWS = [0, 1, 2, 3, 4, 5, 6];
export const ARENA_COLS: Record<number, number[]> = {
  0: [3, 4, 5, 6],
  1: [2, 3, 4, 5, 6],
  2: [1, 2, 3, 4, 5, 6],
  3: [0, 1, 2, 3, 4, 5, 6],
  4: [1, 2, 3, 4, 5, 6],
  5: [2, 3, 4, 5, 6],
  6: [3, 4, 5, 6],
};

// ============================================================================
// HERD DEFINITIONS
// ============================================================================

export interface HerdShape {
  name: string;
  size: number;
  icon: string;
}

export const HERD_SHAPES: HerdShape[] = [
  { name: 'Wanderer', size: 1, icon: '🐑' },
  { name: 'Pair',     size: 2, icon: '🐑🐑' },
  { name: 'Trio',     size: 3, icon: '🔺' },
  { name: 'Quad',     size: 4, icon: '💎' },
];

// ============================================================================
// HEX GRID HELPERS
// ============================================================================

export const getHexNeighbors = (row: number, col: number): [number, number][] => {
  const isEvenRow = row % 2 === 0;
  if (isEvenRow) {
    return [
      [row - 1, col - 1], [row - 1, col],
      [row, col - 1], [row, col + 1],
      [row + 1, col - 1], [row + 1, col],
    ];
  } else {
    return [
      [row - 1, col], [row - 1, col + 1],
      [row, col - 1], [row, col + 1],
      [row + 1, col], [row + 1, col + 1],
    ];
  }
};

export const isValidCell = (row: number, col: number): boolean => {
  if (row < 0 || row > 6) return false;
  const cols = ARENA_COLS[row];
  return cols && cols.includes(col);
};

export const getAllArenaCells = (): [number, number][] => {
  const cells: [number, number][] = [];
  ARENA_ROWS.forEach(row => {
    ARENA_COLS[row].forEach(col => {
      cells.push([row, col]);
    });
  });
  return cells;
};

export const isAdjacentToAny = (
  row: number,
  col: number,
  positions: [number, number][]
): boolean => {
  const neighbors = getHexNeighbors(row, col);
  return positions.some(([pr, pc]) =>
    neighbors.some(([nr, nc]) => nr === pr && nc === pc)
  );
};

export const getValidPlacementCells = (
  currentHerdCells: [number, number][],
  arena: Record<string, number>
): [number, number][] => {
  if (currentHerdCells.length === 0) {
    return getAllArenaCells().filter(([r, c]) => {
      const key = `${r}-${c}`;
      return arena[key] !== CELL_SHEEP;
    });
  }

  const validCells = new Set<string>();
  for (const [pr, pc] of currentHerdCells) {
    const neighbors = getHexNeighbors(pr, pc);
    for (const [nr, nc] of neighbors) {
      const key = `${nr}-${nc}`;
      if (
        isValidCell(nr, nc) &&
        arena[key] !== CELL_SHEEP &&
        !currentHerdCells.some(([cr, cc]) => cr === nr && cc === nc)
      ) {
        validCells.add(`${nr}-${nc}`);
      }
    }
  }

  return Array.from(validCells).map(key => {
    const [r, c] = key.split('-').map(Number);
    return [r, c] as [number, number];
  });
};

export const getHerdPositions = (
  shape: HerdShape,
  anchorRow: number,
  anchorCol: number
): [number, number][] | null => {
  if (!isValidCell(anchorRow, anchorCol)) return null;
  return [[anchorRow, anchorCol]];
};

export const checkOverlap = (
  positions: [number, number][],
  arena: Record<string, number>
): boolean => {
  return positions.some(([row, col]) => {
    const key = `${row}-${col}`;
    return arena[key] === CELL_SHEEP;
  });
};

export const autoPlaceHerds = (): Record<string, number> => {
  const arena: Record<string, number> = {};
  const herdsToPlace = [...HERD_SHAPES].reverse();

  for (const herd of herdsToPlace) {
    let placed = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const herdCells: [number, number][] = [];
      const tempArena = { ...arena };
      let success = true;

      for (let i = 0; i < herd.size; i++) {
        const validCells = getValidPlacementCells(herdCells, tempArena);
        if (validCells.length === 0) { success = false; break; }
        const pick = validCells[Math.floor(Math.random() * validCells.length)];
        herdCells.push(pick);
        tempArena[`${pick[0]}-${pick[1]}`] = CELL_SHEEP;
      }

      if (success) {
        for (const [r, c] of herdCells) {
          arena[`${r}-${c}`] = CELL_SHEEP;
        }
        placed = true;
        break;
      }
    }

    if (!placed) console.warn(`Could not place ${herd.name}!`);
  }

  return arena;
};