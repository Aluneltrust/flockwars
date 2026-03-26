// ============================================================================
// HERDSWACKER - BSV Wallet Service
// ============================================================================
// Real BSV blockchain integration using @bsv/sdk 2.0.0
// Updated for 4-wallet model:
//   - Player wallets send miss fees → escrow
//   - Defender wallets send hit rewards → shooter
//   - Escrow settles pot at game end (server-side)
// ============================================================================

import {
  Transaction,
  PrivateKey,
  P2PKH,
  Script,
} from '@bsv/sdk';

import { BSV_NETWORK, BACKEND_URL } from '../constants/gameConstants';



// ============================================================================
// TYPES
// ============================================================================

export interface UTXO {
  txid: string;
  vout: number;
  satoshis: number;
  rawTx: string;
  script: string;
}

export interface PaymentResult {
  success: boolean;
  txid?: string;
  rawTxHex?: string;
  amount?: number;
  memo?: string;
  newBalance?: number;
  error?: string;
}

export interface WalletState {
  connected: boolean;
  address: string;
  balance: number;
  publicKey: string;
}

export interface GameTransaction {
  type: 'miss_fee' | 'hit_reward' | 'winner_reward' | 'deposit' | 'withdraw';
  txid: string;
  amount: number;
  description: string;
  timestamp: number;
  confirmed: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const NETWORK_FEE_SATS = 100;
const DUST_LIMIT = 546;

// Use backend proxy to avoid CORS issues with WhatOnChain
const PROXY_BASE = `${BACKEND_URL}/api/woc`;

// Session token for authenticated proxy requests
let _sessionToken = '';

/** Called by the game component when a session_token event arrives from the server */
export function setSessionToken(token: string): void {
  _sessionToken = token;
}

export function getSessionToken(): string {
  return _sessionToken;
}

/** Fetch wrapper that injects the session token header */
function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  if (_sessionToken) {
    headers.set('x-session-token', _sessionToken);
  }
  return fetch(url, { ...options, headers });
}

function stringToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getApiBase(): string {
  return PROXY_BASE;
}

// Clear the server-side UTXO cache after broadcasting
async function clearProxyCache(): Promise<void> {
  try {
    await proxyFetch(`${PROXY_BASE}/cache/clear`, { method: 'POST' });
  } catch { /* ignore */ }
}

// ============================================================================
// BSV WALLET SERVICE CLASS
// ============================================================================

export class BSVWalletService {
  private privateKey: PrivateKey | null = null;
  private cachedUtxos: UTXO[] = [];
  private lastUtxoFetch: number = 0;
  private utxoCacheDuration: number = 10000;

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  async connect(wif?: string): Promise<WalletState> {
    try {
      this.privateKey = wif
        ? PrivateKey.fromWif(wif)
        : PrivateKey.fromRandom();

      const balance = await this.getBalance();

      return {
        connected: true,
        address: this.getAddress(),
        balance,
        publicKey: this.getPublicKeyHex(),
      };
    } catch (error) {
      throw new Error(`Failed to connect wallet: ${error}`);
    }
  }

  disconnect(): void {
    this.privateKey = null;
    this.cachedUtxos = [];
  }

  isConnected(): boolean {
    return this.privateKey !== null;
  }

  getAddress(): string {
    if (!this.privateKey) throw new Error('Wallet not connected');
    return this.privateKey.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
  }

  getPublicKeyHex(): string {
    if (!this.privateKey) throw new Error('Wallet not connected');
    return this.privateKey.toPublicKey().toString();
  }

  getPrivateKey(): PrivateKey | null {
    return this.privateKey;
  }

  exportWif(): string {
    if (!this.privateKey) throw new Error('Wallet not connected');
    return this.privateKey.toWif();
  }

  // ==========================================================================
  // BALANCE & UTXO MANAGEMENT
  // ==========================================================================

  async getBalance(): Promise<number> {
    const utxos = await this.getUtxos();
    return utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
  }

  async getUtxos(forceRefresh: boolean = false): Promise<UTXO[]> {
    if (!this.privateKey) throw new Error('Wallet not connected');

    const now = Date.now();
    if (!forceRefresh && this.cachedUtxos.length > 0 &&
        (now - this.lastUtxoFetch) < this.utxoCacheDuration) {
      return this.cachedUtxos;
    }

    const address = this.getAddress();
    const baseUrl = getApiBase();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));

        const response = await proxyFetch(`${baseUrl}/address/${address}/unspent`);
        if (response.status === 429) {
          console.warn(`Rate limited (UTXOs), retry ${attempt + 1}/3...`);
          continue;
        }
        if (!response.ok) throw new Error(`WOC API error: ${response.status}`);

        const utxoList = await response.json();
        utxoList.sort((a: any, b: any) => b.value - a.value);
        const limitedList = utxoList.slice(0, 3);

        // Fetch raw TXs sequentially to avoid rate limits
        const enrichedUtxos: UTXO[] = [];
        for (const utxo of limitedList) {
          try {
            const txResponse = await proxyFetch(`${baseUrl}/tx/${utxo.tx_hash}/hex`);
            if (txResponse.status === 429) {
              await new Promise(r => setTimeout(r, 1500));
              const retry = await proxyFetch(`${baseUrl}/tx/${utxo.tx_hash}/hex`);
              if (!retry.ok) continue;
              const rawTx = await retry.text();
              const tx = Transaction.fromHex(rawTx);
              const script = tx.outputs[utxo.tx_pos].lockingScript?.toHex() || '';
              enrichedUtxos.push({ txid: utxo.tx_hash, vout: utxo.tx_pos, satoshis: utxo.value, rawTx, script });
            } else if (txResponse.ok) {
              const rawTx = await txResponse.text();
              const tx = Transaction.fromHex(rawTx);
              const script = tx.outputs[utxo.tx_pos].lockingScript?.toHex() || '';
              enrichedUtxos.push({ txid: utxo.tx_hash, vout: utxo.tx_pos, satoshis: utxo.value, rawTx, script });
            }
          } catch { /* skip this utxo */ }
        }

        this.cachedUtxos = enrichedUtxos;
        this.lastUtxoFetch = now;
        return this.cachedUtxos;
      } catch (error) {
        if (attempt === 2) {
          console.error('Failed to fetch UTXOs:', error);
          throw error;
        }
      }
    }

    // Return cached if all retries failed
    if (this.cachedUtxos.length > 0) return this.cachedUtxos;
    throw new Error('Failed to fetch UTXOs after retries');
  }

  private selectUtxos(amount: number, utxos: UTXO[]): UTXO[] {
    const sorted = [...utxos].sort((a, b) => b.satoshis - a.satoshis);
    const selected: UTXO[] = [];
    let total = 0;

    for (const utxo of sorted) {
      selected.push(utxo);
      total += utxo.satoshis;
      if (total >= amount + NETWORK_FEE_SATS) break;
    }

    if (total < amount) {
      throw new Error(`Insufficient funds: need ${amount}, have ${total}`);
    }

    return selected;
  }

  // ==========================================================================
  // BROADCAST
  // ==========================================================================

  private async broadcastTransaction(rawTx: string): Promise<PaymentResult> {
    // Try TAAL ARC via backend proxy (avoids CORS issues)
    try {
      const response = await proxyFetch(`${PROXY_BASE.replace('/api/woc', '')}/api/taal/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: rawTx }),
      });
      const result = await response.json();
      console.log('TAAL proxy response:', response.status, result);

      if (result.txid) {
        this.cachedUtxos = [];
        return { success: true, txid: result.txid };
      }
      console.warn('TAAL broadcast failed:', result);
    } catch (e) {
      console.warn('TAAL proxy error:', e);
    }

    // Fallback: WhatsOnChain via proxy
    try {
      const response = await proxyFetch(`${getApiBase()}/tx/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: rawTx }),
      });
      const text = await response.text();
      console.log('WoC broadcast response:', response.status, text);

      if (response.ok) {
        this.cachedUtxos = [];
        const txid = text.replace(/"/g, '');
        return { success: true, txid };
      }
      return { success: false, error: text || 'Broadcast failed' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // ==========================================================================
  // GAME PAYMENTS — called by the game when server says "payment_required"
  // ==========================================================================

  async sendGamePayment(
    toAddress: string,
    amountSats: number,
    gameId: string,
    type: 'miss' | 'hit',
    row?: number,
    col?: number,
  ): Promise<PaymentResult> {
    if (!this.privateKey) {
      return { success: false, error: 'Wallet not connected' };
    }

    if (amountSats < DUST_LIMIT) {
      return { success: false, error: `Amount ${amountSats} below dust limit` };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Always clear cache and refresh UTXOs
        this.cachedUtxos = [];
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        const utxos = await this.getUtxos(true);
        const totalNeeded = amountSats + NETWORK_FEE_SATS;
        const selectedUtxos = this.selectUtxos(totalNeeded, utxos);
        const totalInput = selectedUtxos.reduce((sum, u) => sum + u.satoshis, 0);

        const tx = new Transaction();

        for (const utxo of selectedUtxos) {
          tx.addInput({
            sourceTransaction: Transaction.fromHex(utxo.rawTx),
            sourceOutputIndex: utxo.vout,
            unlockingScriptTemplate: new P2PKH().unlock(this.privateKey),
          });
        }

        // Output 1: Payment to target address
        tx.addOutput({
          lockingScript: new P2PKH().lock(toAddress),
          satoshis: amountSats,
        });

        // Output 2: OP_RETURN with game data
        const opData = {
          app: 'HERDSWACKER',
          v: '3.0',
          action: type === 'miss' ? 'MISS_FEE' : 'HIT_REWARD',
          game: gameId.substring(0, 8),
          to: toAddress.substring(0, 8),
          sats: amountSats,
          ...(row !== undefined && col !== undefined ? { r: row, c: col } : {}),
          ts: Date.now(),
        };
        const dataHex = stringToHex(JSON.stringify(opData));
        tx.addOutput({
          lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${dataHex}`),
          satoshis: 0,
        });

        // Output 3: Change back to self
        const change = totalInput - amountSats - NETWORK_FEE_SATS;
        if (change > DUST_LIMIT) {
          tx.addOutput({
            lockingScript: new P2PKH().lock(this.getAddress()),
            satoshis: change,
          });
        }

        await tx.sign();
        const rawTxHex = tx.toHex();
        const result = await this.broadcastTransaction(rawTxHex);

        if (result.success) {
          return {
            ...result,
            rawTxHex,
            amount: amountSats,
            memo: type === 'miss' ? 'Miss fee → escrow' : 'Hit reward → shooter',
          };
        }

        // If mempool conflict, retry
        if (result.error?.includes('mempool-conflict') && attempt === 0) {
          console.warn('Mempool conflict, retrying in 2s...');
          continue;
        }

        return result;
      } catch (error: any) {
        if (attempt === 0 && error.message?.includes('mempool-conflict')) {
          console.warn('Mempool conflict, retrying in 2s...');
          continue;
        }
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Payment failed after retry' };
  }

  /**
   * Generic send payment (for wallet page transfers, etc.)
   */
  async sendPayment(toAddress: string, amount: number, memo?: string): Promise<PaymentResult> {
    if (!this.privateKey) return { success: false, error: 'Wallet not connected' };
    if (amount < DUST_LIMIT) return { success: false, error: `Amount below dust limit (${DUST_LIMIT})` };

    try {
      const utxos = await this.getUtxos(true);
      const selectedUtxos = this.selectUtxos(amount + NETWORK_FEE_SATS, utxos);
      const totalInput = selectedUtxos.reduce((sum, u) => sum + u.satoshis, 0);

      const tx = new Transaction();

      for (const utxo of selectedUtxos) {
        tx.addInput({
          sourceTransaction: Transaction.fromHex(utxo.rawTx),
          sourceOutputIndex: utxo.vout,
          unlockingScriptTemplate: new P2PKH().unlock(this.privateKey),
        });
      }

      tx.addOutput({ lockingScript: new P2PKH().lock(toAddress), satoshis: amount });

      if (memo) {
        tx.addOutput({
          lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${stringToHex(memo)}`),
          satoshis: 0,
        });
      }

      const change = totalInput - amount - NETWORK_FEE_SATS;
      if (change > DUST_LIMIT) {
        tx.addOutput({ lockingScript: new P2PKH().lock(this.getAddress()), satoshis: change });
      }

      await tx.sign();
      const result = await this.broadcastTransaction(tx.toHex());

      if (result.success) {
        return { ...result, amount, memo };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  async verifyTransaction(txid: string): Promise<boolean> {
    try {
      const response = await proxyFetch(`${getApiBase()}/tx/${txid}`);
      return response.ok;
    } catch { return false; }
  }

  getExplorerLink(txid: string): string {
    const base = BSV_NETWORK === 'main'
      ? 'https://whatsonchain.com/tx'
      : 'https://test.whatsonchain.com/tx';
    return `${base}/${txid}`;
  }

  static isValidAddress(address: string): boolean {
    return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
  }

  static async fetchBalance(address: string): Promise<number> {
    try {
      // Use the unauthenticated /api/balance endpoint (no session token needed)
      const response = await fetch(`${BACKEND_URL}/api/balance/${address}`);
      if (!response.ok) return 0;
      const data = await response.json();
      return data.balance || 0;
    } catch { return 0; }
  }
}

// Singleton
export const bsvWalletService = new BSVWalletService();

// ============================================================================
// STANDALONE HELPERS (backward compatible)
// ============================================================================

export const fetchBalance = BSVWalletService.fetchBalance;

/**
 * @deprecated — Use bsvWalletService.sendGamePayment() instead.
 */
export async function sendMissPayment(
  privateKey: PrivateKey,
  walletAddress: string,
): Promise<PaymentResult> {
  const service = new BSVWalletService();
  await service.connect(privateKey.toWif());
  return service.sendGamePayment(walletAddress, 200, 'legacy', 'miss');
}

export async function sendBSV(
  privateKey: PrivateKey,
  fromAddress: string,
  toAddress: string,
  amountSats: number,
): Promise<PaymentResult> {
  const service = new BSVWalletService();
  await service.connect(privateKey.toWif());
  return service.sendPayment(toAddress, amountSats);
}