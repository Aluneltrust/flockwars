// ============================================================================
// HERDSWACKER SERVER
// ============================================================================

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { initDatabase } from './db/database';
import { setupSocketHandlers } from './socket/socketHandler';
import apiRoutes from './routes/api';
import { escrowManager, priceService } from './wallet/bsvService';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim());

async function main() {
  const app = express();
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
  app.use(express.json());
  app.use(apiRoutes);

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'], credentials: true },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 15000,
  });

  // Escrow manager (per-game HD derivation)
  const escrowOk = escrowManager.init();
  if (!escrowOk) console.warn('⚠️  No escrow master seed — payments will fail');

  // BSV price
  const bsvPrice = await priceService.getPrice();

  // Database
  try { await initDatabase(); }
  catch (err) { console.error('❌ DB init failed:', err); }

  // Socket handlers
  setupSocketHandlers(io);

  // Start
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('============================================');
    console.log('  🐑 HERDSWACKER SERVER');
    console.log('============================================');
    console.log(`  Port:     ${PORT}`);
    console.log(`  CORS:     ${CORS_ORIGINS.join(', ')}`);
    console.log(`  Network:  ${process.env.BSV_NETWORK || 'main'}`);
    console.log(`  Escrow:   ${escrowOk ? '✅ HD per-game' : '❌ NOT SET'}`);
    console.log(`  Final:    ${process.env.FINAL_WALLET_ADDRESS || 'NOT SET'}`);
    console.log(`  BSV:      $${bsvPrice.toFixed(2)}`);
    console.log(`  DB:       ${process.env.DATABASE_URL ? '✅' : '❌'}`);
    console.log('============================================');
  });
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });