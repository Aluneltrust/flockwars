// ============================================================================
// REST API ROUTES — Security-hardened
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { gameManager } from '../game/GameManager';
import { matchmakingQueue } from '../game/Matchmaking';
import { STAKE_TIERS } from '../game/constants';
import { escrowManager, priceService, fetchBalance } from '../wallet/bsvService';
import * as db from '../db/database';
import { sessionManager } from '../socket/sessionManager';
import { lobbyManager } from '../game/LobbyManager';

const router = Router();

// ============================================================================
// AUTH MIDDLEWARE — validates session token for proxy endpoints
// Token sent as x-session-token header ONLY (removed query param to avoid leaks)
// ============================================================================

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-session-token'] as string || '';
  if (!sessionManager.isValid(token)) {
    res.status(401).json({ error: 'Unauthorized — valid session token required' });
    return;
  }
  next();
}

// ============================================================================
// BOUNDED CACHE — prevents unbounded memory growth
// ============================================================================

class LRUCache<V> {
  private cache = new Map<string, V>();
  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  set(key: string, val: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, val);
    if (this.cache.size > this.maxSize) {
      // Delete oldest (first entry)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}

// ============================================================================
// PUBLIC ENDPOINTS (no auth required)
// ============================================================================

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeGames: gameManager.getActiveCount(),
    playersWaiting: matchmakingQueue.getTotalWaiting(),
    playersOnline: lobbyManager.getOnlineCount(),
  });
});

router.get('/api/tiers', (_req: Request, res: Response) => {
  res.json(STAKE_TIERS);
});

router.get('/api/queue', (_req: Request, res: Response) => {
  res.json({
    queues: matchmakingQueue.getQueueSizes(),
    activeGames: gameManager.getActiveCount(),
  });
});

router.get('/api/price', async (_req: Request, res: Response) => {
  const price = await priceService.getPrice();
  res.json({ bsvUsd: price });
});

router.get('/api/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    res.json(await db.getLeaderboard(limit));
  } catch (err) {
    res.status(500).json({ error: 'Leaderboard failed' });
  }
});

router.get('/api/player/:address', async (req: Request, res: Response) => {
  try {
    // Validate address format before querying DB
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(req.params.address)) {
      res.status(400).json({ error: 'Invalid address format' });
      return;
    }
    const stats = await db.getPlayerStats(req.params.address);
    if (!stats) { res.status(404).json({ error: 'Player not found' }); return; }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ============================================================================
// AUTHENTICATED ENDPOINTS — require valid session token
// ============================================================================

// Escrow info (authenticated — reveals game financial state)
router.get('/api/escrow/:gameId', requireSession, async (req: Request, res: Response) => {
  try {
    const addr = escrowManager.getGameAddress(req.params.gameId);
    const balance = await fetchBalance(addr);
    res.json({ gameId: req.params.gameId, address: addr, balance });
  } catch {
    res.json({ error: 'Escrow not available' });
  }
});

// Balance check (public — reads public blockchain data)
router.get('/api/balance/:address', async (req: Request, res: Response) => {
  if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(req.params.address)) {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }
  const balance = await fetchBalance(req.params.address);
  res.json({ address: req.params.address, balance });
});

// ============================================================================
// WOC PROXY — AUTHENTICATED — avoids CORS issues for browser clients
// ============================================================================

const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/main';

// Bounded caches — prevent unbounded memory growth
const txHexCache = new LRUCache<string>(10_000);        // TX hex never changes
const txDetailCache = new LRUCache<any>(5_000);          // TX details never change
const utxoCache = new Map<string, { data: any; ts: number }>();
const UTXO_CACHE_MS = 5000;
const MAX_UTXO_CACHE_SIZE = 1000;

// Rate limit: queue WoC requests with delay
let lastWocRequest = 0;
const WOC_MIN_INTERVAL = 350; // ms between requests

async function wocFetch(url: string, options?: RequestInit): Promise<globalThis.Response> {
  const now = Date.now();
  const wait = WOC_MIN_INTERVAL - (now - lastWocRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastWocRequest = Date.now();
  return fetch(url, options);
}

// Input validation helpers
function isValidTxid(txid: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(txid);
}

function isValidBsvAddress(address: string): boolean {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
}

// Proxy: get raw TX hex (cached permanently — TX hex never changes)
// SECURED: requires session token
router.get('/api/woc/tx/:txid/hex', requireSession, async (req: Request, res: Response) => {
  const txid = req.params.txid;

  // Validate TXID format (64 hex chars)
  if (!isValidTxid(txid)) {
    res.status(400).send('Invalid TXID format');
    return;
  }

  const cached = txHexCache.get(txid);
  if (cached) { res.send(cached); return; }

  try {
    const r = await wocFetch(`${WOC_BASE}/tx/${txid}/hex`);
    if (!r.ok) { res.status(r.status).send('TX not found'); return; }
    const hex = await r.text();
    txHexCache.set(txid, hex);
    res.send(hex);
  } catch (err) {
    res.status(500).send('Proxy error');
  }
});

// Proxy: get address UTXOs (cached 5s)
// SECURED: requires session token
router.get('/api/woc/address/:address/unspent', requireSession, async (req: Request, res: Response) => {
  const address = req.params.address;

  if (!isValidBsvAddress(address)) {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  const cached = utxoCache.get(address);
  if (cached && Date.now() - cached.ts < UTXO_CACHE_MS) {
    res.json(cached.data);
    return;
  }

  try {
    const r = await wocFetch(`${WOC_BASE}/address/${address}/unspent`);
    if (!r.ok) { res.status(r.status).json([]); return; }
    const data = await r.json();

    // Evict oldest if cache is full
    if (utxoCache.size >= MAX_UTXO_CACHE_SIZE) {
      const oldest = utxoCache.keys().next().value;
      if (oldest !== undefined) utxoCache.delete(oldest);
    }
    utxoCache.set(address, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Proxy: broadcast TX
// SECURED: requires session token + body validation
router.post('/api/woc/tx/raw', requireSession, async (req: Request, res: Response) => {
  try {
    const body = req.body;
    // Validate body has txhex and it looks like hex
    if (!body || !body.txhex || typeof body.txhex !== 'string') {
      res.status(400).send('Missing or invalid txhex');
      return;
    }
    if (!/^[0-9a-fA-F]+$/.test(body.txhex) || body.txhex.length > 200_000) {
      res.status(400).send('Invalid TX hex format or too large');
      return;
    }

    const r = await wocFetch(`${WOC_BASE}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: body.txhex }),
    });
    const text = await r.text();
    if (!r.ok) { res.status(r.status).send(text); return; }
    utxoCache.clear();
    res.send(text);
  } catch (err) {
    res.status(500).send('Broadcast proxy error');
  }
});

// Clear UTXO cache (called by frontend after TAAL broadcast)
// SECURED: requires session token
router.post('/api/woc/cache/clear', requireSession, (_req: Request, res: Response) => {
  utxoCache.clear();
  res.json({ ok: true });
});

// Proxy: TAAL ARC broadcast (avoids CORS double-header issue)
// SECURED: requires session token + body validation
router.post('/api/taal/tx', requireSession, async (req: Request, res: Response) => {
  const apiKey = process.env.TAAL_API_KEY || '';
  if (!apiKey) {
    // Don't leak internal config — generic error
    res.status(503).json({ error: 'Broadcast service unavailable' });
    return;
  }

  // Validate body
  if (!req.body || !req.body.txhex || typeof req.body.txhex !== 'string') {
    res.status(400).json({ error: 'Missing or invalid txhex' });
    return;
  }
  if (!/^[0-9a-fA-F]+$/.test(req.body.txhex) || req.body.txhex.length > 200_000) {
    res.status(400).json({ error: 'Invalid TX hex format or too large' });
    return;
  }

  try {
    const r = await fetch('https://arc.taal.com/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: Buffer.from(req.body.txhex, 'hex'),
    });
    const result = await r.json() as any;
    console.log('TAAL proxy:', r.status, result.txid || '(no txid)');

    if (result.txid) {
      utxoCache.clear();
    }
    res.status(r.status).json(result);
  } catch (err: any) {
    // Don't leak internal error details
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

// ============================================================================
// TRANSACTION HISTORY PROXY — AUTHENTICATED
// ============================================================================

router.get('/api/woc/address/:address/history', requireSession, async (req: Request, res: Response) => {
  const { address } = req.params;

  if (!isValidBsvAddress(address)) {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

  try {
    const historyRes = await wocFetch(`${WOC_BASE}/address/${address}/history`);
    if (!historyRes.ok) { res.status(historyRes.status).json([]); return; }
    const history = await historyRes.json() as any[];
    const recentTxs = history.slice(0, limit);

    const results: any[] = [];
    for (const tx of recentTxs) {
      // Validate tx_hash format before using
      if (!tx.tx_hash || !isValidTxid(tx.tx_hash)) continue;

      const cached = txDetailCache.get(tx.tx_hash);
      if (cached) {
        results.push(cached);
        continue;
      }

      try {
        const txRes = await wocFetch(`${WOC_BASE}/tx/hash/${tx.tx_hash}`);
        if (txRes.ok) {
          const txData = await txRes.json() as any;
          const detail = {
            txid: tx.tx_hash,
            height: tx.height,
            time: txData.time,
            vout: txData.vout,
            vin: txData.vin,
          };
          // Only cache confirmed TXs (height > 0)
          if (tx.height > 0) {
            txDetailCache.set(tx.tx_hash, detail);
          }
          results.push(detail);
        }
      } catch {
        // Skip failed individual tx lookups
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json([]);
  }
});

export default router;