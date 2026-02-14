// ============================================================================
// GAME CONSTANTS — Single source of truth
// ============================================================================

export const MAX_SHEEP = 10;

// ============================================================================
// STAKE TIERS (costs in cents, converted to sats at runtime)
// ============================================================================

export interface StakeTierDef {
  tier: number;        // ID (1, 5, 10, 25, 50, 75, 100)
  name: string;
  missCents: number;   // shooter pays escrow on miss
  hitCents: number;    // defender pays shooter on hit
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

// ============================================================================
// PRICE CONVERSION
// ============================================================================

export function centsToSats(cents: number, bsvPriceUsd: number): number {
  if (bsvPriceUsd <= 0) throw new Error('Invalid BSV price');
  const dollars = cents / 100;
  const bsv = dollars / bsvPriceUsd;
  return Math.ceil(bsv * 100_000_000);
}

// ============================================================================
// BALANCE REQUIREMENTS
// ============================================================================
// Max 27 misses (37 cells - 10 sheep) + all 10 sheep can be hit
// Player needs: (27 × missCents) + (10 × hitCents) + TX fee buffer

export function getMinBalanceCents(tier: StakeTierDef): number {
  const maxMissCost = 27 * tier.missCents;
  const maxHitCost = MAX_SHEEP * tier.hitCents;
  return Math.ceil((maxMissCost + maxHitCost) * 1.1); // 10% buffer
}

export function getMinBalanceSats(tier: StakeTierDef, bsvPriceUsd: number): number {
  return centsToSats(getMinBalanceCents(tier), bsvPriceUsd);
}

// ============================================================================
// ARENA GEOMETRY (Hex grid — 37 cells)
// ============================================================================

export const ARENA_ROWS = [0, 1, 2, 3, 4, 5, 6];
export const ARENA_COLS: Record<number, number[]> = {
  0: [3, 4, 5, 6],       // 4
  1: [2, 3, 4, 5, 6],    // 5
  2: [1, 2, 3, 4, 5, 6], // 6
  3: [0, 1, 2, 3, 4, 5, 6], // 7
  4: [1, 2, 3, 4, 5, 6], // 6
  5: [2, 3, 4, 5, 6],    // 5
  6: [3, 4, 5, 6],       // 4 = 37 total
};

export function isValidCell(row: number, col: number): boolean {
  if (row < 0 || row > 6) return false;
  const cols = ARENA_COLS[row];
  return cols !== undefined && cols.includes(col);
}

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

export function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

// ============================================================================
// HERD VALIDATION — connected components of sizes [1, 2, 3, 4]
// ============================================================================

export const HERD_SIZES = [1, 2, 3, 4]; // total = 10

export function validateSheepPositions(
  positions: { row: number; col: number }[]
): { valid: boolean; error?: string } {
  if (positions.length !== MAX_SHEEP) {
    return { valid: false, error: `Need ${MAX_SHEEP} sheep, got ${positions.length}` };
  }

  for (const p of positions) {
    if (!isValidCell(p.row, p.col)) {
      return { valid: false, error: `Invalid cell: ${p.row}-${p.col}` };
    }
  }

  const keys = new Set(positions.map(p => cellKey(p.row, p.col)));
  if (keys.size !== positions.length) {
    return { valid: false, error: 'Duplicate positions' };
  }

  return { valid: true };
}