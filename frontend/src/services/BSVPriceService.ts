// ============================================================================
// HERDSWACKER - BSV Price Service
// ============================================================================
// Fetches real-time BSV/USD price and converts cents to satoshis
// Updates price every 60 seconds to keep game costs accurate
// ============================================================================

import { BSV_NETWORK } from '../constants/gameConstants';

export interface PriceData {
  bsvUsd: number;
  updatedAt: Date;
  source: string;
}

export interface StakeTierSats {
  tier: number;          // Cents
  missCost: number;      // Satoshis (flat 200 sats to pot)
  hitReward: number;     // Satoshis (no cost for hits)
  potContribution: number; // What goes to pot on miss
}

// Stake tiers in cents (for display purposes, actual cost is flat 200 sats)
export const STAKE_TIERS_CENTS = [1, 2, 4, 10, 20, 40, 100] as const;
export type StakeTierCents = typeof STAKE_TIERS_CENTS[number];

// Flat miss fee (goes to platform pot)
export const MISS_FEE_SATS = 200;

class BSVPriceService {
  private currentPrice: number = 0;
  private lastUpdate: Date = new Date(0);
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CACHE_DURATION_MS = 60000; // 1 minute

  // Price sources (fallback chain) - WhatsOnChain first (no CORS issues)
  private readonly PRICE_SOURCES = [
    {
      name: 'WhatsOnChain',
      url: 'https://api.whatsonchain.com/v1/bsv/main/exchangerate',
      parse: (data: any) => data.rate,
    },
    {
      name: 'CoinGecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash-sv&vs_currencies=usd',
      parse: (data: any) => data['bitcoin-cash-sv']?.usd,
    },
  ];

  /**
   * Start auto-updating price
   */
  startAutoUpdate(intervalMs: number = 60000): void {
    this.updatePrice(); // Initial fetch
    this.updateInterval = setInterval(() => this.updatePrice(), intervalMs);
    console.log(`[Price] Auto-update started (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop auto-updating
   */
  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('[Price] Auto-update stopped');
    }
  }

  /**
   * Fetch current BSV/USD price
   */
  async updatePrice(): Promise<number> {
    for (const source of this.PRICE_SOURCES) {
      try {
        const response = await fetch(source.url);
        if (!response.ok) continue;

        const data = await response.json();
        const price = source.parse(data);

        if (price && price > 0) {
          this.currentPrice = price;
          this.lastUpdate = new Date();
          console.log(`[Price] BSV/USD: $${price.toFixed(2)} (${source.name})`);
          return price;
        }
      } catch (error) {
        console.warn(`[Price] ${source.name} failed:`, error);
      }
    }

    // If all sources fail, use last known price or fallback
    if (this.currentPrice === 0) {
      this.currentPrice = 50; // Fallback price
      console.warn('[Price] Using fallback price: $50');
    }

    return this.currentPrice;
  }

  /**
   * Get current price (from cache or fetch)
   */
  async getPrice(): Promise<PriceData> {
    const now = new Date();
    const cacheAge = now.getTime() - this.lastUpdate.getTime();

    if (cacheAge > this.CACHE_DURATION_MS || this.currentPrice === 0) {
      await this.updatePrice();
    }

    return {
      bsvUsd: this.currentPrice,
      updatedAt: this.lastUpdate,
      source: 'cached',
    };
  }

  /**
   * Get current price synchronously (returns cached or fallback)
   */
  getPriceSync(): number {
    return this.currentPrice > 0 ? this.currentPrice : 50;
  }

  /**
   * Convert USD cents to satoshis
   */
  centsToSats(cents: number): number {
    const price = this.getPriceSync();

    // 1 BSV = 100,000,000 satoshis
    // cents / 100 = dollars
    // dollars / bsvPrice = BSV amount
    // BSV amount * 100,000,000 = satoshis
    const dollars = cents / 100;
    const bsvAmount = dollars / price;
    const satoshis = Math.ceil(bsvAmount * 100_000_000);

    return satoshis;
  }

  /**
   * Convert satoshis to USD cents
   */
  satsToCents(sats: number): number {
    const price = this.getPriceSync();

    const bsvAmount = sats / 100_000_000;
    const dollars = bsvAmount * price;
    const cents = dollars * 100;

    return Math.round(cents * 100) / 100; // Round to 2 decimals
  }

  /**
   * Get all stake tiers with current satoshi values
   * Note: With pot system, miss cost is flat 200 sats, hits are free
   */
  getStakeTiers(): StakeTierSats[] {
    return STAKE_TIERS_CENTS.map((tierCents) => ({
      tier: tierCents,
      missCost: MISS_FEE_SATS,      // Flat 200 sats
      hitReward: 0,                  // Hits are free now
      potContribution: MISS_FEE_SATS, // Goes to pot
    }));
  }

  /**
   * Get specific stake tier
   */
  getStakeTier(tierCents: StakeTierCents): StakeTierSats {
    return {
      tier: tierCents,
      missCost: MISS_FEE_SATS,
      hitReward: 0,
      potContribution: MISS_FEE_SATS,
    };
  }

  /**
   * Format tier for display
   */
  formatTier(tierCents: number): string {
    if (tierCents >= 100) {
      return `$${(tierCents / 100).toFixed(2)}`;
    }
    return `${tierCents}¢`;
  }

  /**
   * Format satoshis for display
   */
  formatSats(sats: number): string {
    return sats.toLocaleString() + ' sats';
  }

  /**
   * Get tier display info
   */
  getTierDisplay(tierCents: StakeTierCents): {
    name: string;
    missDisplay: string;
    hitDisplay: string;
    missSats: number;
    hitSats: number;
    potInfo: string;
  } {
    const names: Record<number, string> = {
      1: '🐣 Rookie',
      2: '🐑 Shepherd',
      4: '🐏 Rancher',
      10: '🤠 Cowboy',
      20: '💰 High Roller',
      40: '🎰 Big Spender',
      100: '🐋 Whale',
    };

    return {
      name: names[tierCents] || `${tierCents}¢ Game`,
      missDisplay: '200 sats → Pot',
      hitDisplay: 'Free!',
      missSats: MISS_FEE_SATS,
      hitSats: 0,
      potInfo: 'Winner gets 50% of pot',
    };
  }

  /**
   * Get current price for display
   */
  getPriceDisplay(): string {
    return `$${this.getPriceSync().toFixed(2)}`;
  }

  /**
   * Calculate winner reward from pot
   */
  calculateWinnerReward(totalPot: number): { winner: number; platform: number } {
    const winnerShare = Math.floor(totalPot / 2);
    const platformShare = totalPot - winnerShare;
    return {
      winner: winnerShare,
      platform: platformShare,
    };
  }
}

// Singleton instance
export const bsvPriceService = new BSVPriceService();

// ============================================================================
// USAGE EXAMPLE
// ============================================================================
/*
import { priceService, MISS_FEE_SATS } from './PriceService';

// Start auto-updating price
priceService.startAutoUpdate(60000); // Every minute

// Get all tiers (for display)
const tiers = priceService.getStakeTiers();
console.log(tiers);
// [
//   { tier: 1, missCost: 200, hitReward: 0, potContribution: 200 },
//   { tier: 2, missCost: 200, hitReward: 0, potContribution: 200 },
//   ...
// ]

// Display info
const display = priceService.getTierDisplay(100);
console.log(display);
// { name: '🐋 Whale', missDisplay: '200 sats → Pot', hitDisplay: 'Free!', ... }

// Calculate winner reward
const pot = 2000; // 10 misses total
const { winner, platform } = priceService.calculateWinnerReward(pot);
console.log(`Winner: ${winner} sats, Platform: ${platform} sats`);
// Winner: 1000 sats, Platform: 1000 sats
*/