// ============================================================================
// REST API ROUTES
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { gameManager } from '../game/GameManager';
import { matchmakingQueue } from '../game/Matchmaking';
import { STAKE_TIERS } from '../game/constants';
import { escrowManager, priceService, fetchBalance } from '../wallet/bsvService';
import * as db from '../db/database';
import { sessionManager } from '../socket/sessionManager';

const router = Router();

// ============================================================================
// AUTH MIDDLEWARE — validates session token for proxy endpoints
// Token sent as x-session-token header or ?token= query param
// ============================================================================

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = (req.headers['x-session-token'] as string) || (req.query.token as string) || '';
  if (!sessionManager.isValid(token)) {
    res.status(401).json({ error: 'Unauthorized — valid session token required' });
    return;
  }
  next();
}

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeGames: gameManager.getActiveCount(),
    playersWaiting: matchmakingQueue.getTotalWaiting(),
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

router.get('/api/escrow/:gameId', async (req: Request, res: Response) => {
  try {
    const addr = escrowManager.getGameAddress(req.params.gameId);
    const balance = await fetchBalance(addr);
    res.json({ gameId: req.params.gameId, address: addr, balance });
  } catch {
    res.json({ error: 'Escrow manager not initialized' });
  }
});

router.get('/api/balance/:address', async (req: Request, res: Response) => {
  const balance = await fetchBalance(req.params.address);
  res.json({ address: req.params.address, balance });
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
    const stats = await db.getPlayerStats(req.params.address);
    if (!stats) { res.status(404).json({ error: 'Player not found' }); return; }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ============================================================================
// WOC PROXY — avoids CORS issues for browser clients
// ============================================================================

const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/main';

// Cache raw TX hex — these never change once confirmed
const txHexCache = new Map<string, string>();
// Cache UTXOs briefly (5 seconds)
const utxoCache = new Map<string, { data: any; ts: number }>();
const UTXO_CACHE_MS = 5000;

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

// Proxy: get raw TX hex (cached permanently — TX hex never changes)
router.get('/api/woc/tx/:txid/hex', requireSession, async (req: Request, res: Response) => {
  const txid = req.params.txid;
  
  // Check cache first
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
router.get('/api/woc/address/:address/unspent', requireSession, async (req: Request, res: Response) => {
  const address = req.params.address;
  
  const cached = utxoCache.get(address);
  if (cached && Date.now() - cached.ts < UTXO_CACHE_MS) {
    res.json(cached.data);
    return;
  }

  try {
    const r = await wocFetch(`${WOC_BASE}/address/${address}/unspent`);
    if (!r.ok) { res.status(r.status).json([]); return; }
    const data = await r.json();
    utxoCache.set(address, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Proxy: broadcast TX
router.post('/api/woc/tx/raw', requireSession, async (req: Request, res: Response) => {
  try {
    const r = await wocFetch(`${WOC_BASE}/tx/raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const text = await r.text();
    if (!r.ok) { res.status(r.status).send(text); return; }
    // Clear UTXO cache on successful broadcast
    utxoCache.clear();
    res.send(text);
  } catch (err) {
    res.status(500).send('Broadcast proxy error');
  }
});

// Clear UTXO cache (called by frontend after TAAL broadcast)
router.post('/api/woc/cache/clear', requireSession, (_req: Request, res: Response) => {
  utxoCache.clear();
  res.json({ ok: true });
});

// Proxy: TAAL ARC broadcast (avoids CORS double-header issue)
router.post('/api/taal/tx', requireSession, async (req: Request, res: Response) => {
  const apiKey = process.env.TAAL_API_KEY || '';
  if (!apiKey) { res.status(500).json({ error: 'TAAL_API_KEY not set on server' }); return; }
  
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
    console.log('TAAL proxy:', r.status, result.txid || result);
    
    if (result.txid) {
      utxoCache.clear(); // Clear UTXO cache on successful broadcast
    }
    res.status(r.status).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// TRANSACTION HISTORY PROXY — fetches sequentially to avoid WoC rate limits
// ============================================================================

// Cache tx details — confirmed TXs never change
const txDetailCache = new Map<string, any>();

router.get('/api/woc/address/:address/history', requireSession, async (req: Request, res: Response) => {
  const { address } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

  try {
    // 1. Get tx history list
    const historyRes = await wocFetch(`${WOC_BASE}/address/${address}/history`);
    if (!historyRes.ok) { res.status(historyRes.status).json([]); return; }
    const history = await historyRes.json() as any[];
    const recentTxs = history.slice(0, limit);

    // 2. Fetch details sequentially (respects wocFetch throttle)
    const results: any[] = [];
    for (const tx of recentTxs) {
      // Check cache first
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