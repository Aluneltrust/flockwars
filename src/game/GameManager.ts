// ============================================================================
// GAME MANAGER — Server-authoritative, client-pays model
// ============================================================================
// Server validates all game logic.
// Players keep their funds — only send TXs on miss (→ escrow) or hit (→ shooter).
// Server verifies raw TX hex locally before broadcasting and applying results.
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
  MAX_SHEEP,
  StakeTierDef,
  getTierByValue,
  getMinBalanceSats,
  centsToSats,
  validateSheepPositions,
  isValidCell,
  cellKey,
} from './constants';
import { fetchBalance, priceService } from '../wallet/bsvService';

// ============================================================================
// TYPES
// ============================================================================

export type GamePhase = 'setup' | 'playing' | 'paused' | 'gameover';
export type PlayerSlot = 'player1' | 'player2';
export type GameEndReason = 'all_sheep_sunk' | 'disconnect' | 'forfeit' | 'timeout' | 'insufficient_funds';

export interface PlayerState {
  socketId: string;
  address: string;
  username: string;
  sheepPositions: Set<string>;
  sheepReady: boolean;
  shotsReceived: Map<string, 'hit' | 'miss'>;
  sheepRemaining: number;
  shotsFired: number;
  hits: number;
  misses: number;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  tier: StakeTierDef;
  missSats: number;          // locked at game start
  hitSats: number;           // locked at game start
  bsvPriceAtStart: number;
  currentTurn: PlayerSlot;
  player1: PlayerState;
  player2: PlayerState;
  pot: number;               // accumulated miss sats (held in escrow)
  // Pause state (when player needs to add funds)
  pausedFor: PlayerSlot | null;
  pausedAt: number | null;
  pauseTimeoutMs: number;    // 60s to add funds
  pauseReason: string | null;
  // Pending TX verification
  pendingShot: {
    shooter: PlayerSlot;
    row: number;
    col: number;
    isHit: boolean;
    requiredTxType: 'miss' | 'hit';
    requiredAmount: number;
    requiredTo: string;       // escrow address (miss) or shooter address (hit)
    requiredFrom: PlayerSlot; // who must send the TX
  } | null;
  // Timing
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  endReason: GameEndReason | null;
  winner: PlayerSlot | null;
  turnStartedAt: number;
  turnTimeoutMs: number;
}

export interface ShotResolution {
  position: { row: number; col: number };
  result: 'hit' | 'miss';
  // Who must pay, how much, to whom
  payer: PlayerSlot;         // who sends the TX
  payerAddress: string;
  payeeAddress: string;      // escrow (miss) or shooter (hit)
  amountSats: number;
  // Game info
  defenderSheepRemaining: number;
  pot: number;
}

export interface GameOverResult {
  winner: PlayerSlot;
  loser: PlayerSlot;
  reason: GameEndReason;
  pot: number;
  winnerPayout: number;
  platformCut: number;
  winnerAddress: string;
  loserAddress: string;
}

// ============================================================================
// GAME MANAGER
// ============================================================================

export class GameManager {
  private games = new Map<string, GameState>();
  private playerToGame = new Map<string, string>();
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private pauseTimers = new Map<string, NodeJS.Timeout>();

  private readonly TURN_TIMEOUT_MS = 90_000;     // 90s per turn
  private readonly PAUSE_TIMEOUT_MS = 60_000;     // 60s to add funds
  private readonly RECONNECT_GRACE_MS = 30_000;   // 30s to reconnect

  // Callbacks for socket layer
  onTurnTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;
  onPauseTimeout: ((gameId: string, winner: PlayerSlot, loser: PlayerSlot) => void) | null = null;
  onFundsNeeded: ((gameId: string, slot: PlayerSlot, amountNeeded: number) => void) | null = null;

  // ==========================================================================
  // CREATE GAME
  // ==========================================================================

  async createGame(
    p1Sid: string, p1Addr: string, p1Name: string,
    p2Sid: string, p2Addr: string, p2Name: string,
    tierValue: number,
  ): Promise<GameState | null> {
    const tier = getTierByValue(tierValue);
    if (!tier) return null;

    const bsvPrice = await priceService.getPrice();
    const missSats = centsToSats(tier.missCents, bsvPrice);
    const hitSats = centsToSats(tier.hitCents, bsvPrice);
    const gameId = uuidv4();

    const mkPlayer = (sid: string, addr: string, name: string): PlayerState => ({
      socketId: sid, address: addr, username: name,
      sheepPositions: new Set(), sheepReady: false,
      shotsReceived: new Map(), sheepRemaining: MAX_SHEEP,
      shotsFired: 0, hits: 0, misses: 0,
      connected: true, disconnectedAt: null,
    });

    const game: GameState = {
      id: gameId, phase: 'setup', tier,
      missSats, hitSats, bsvPriceAtStart: bsvPrice,
      currentTurn: Math.random() < 0.5 ? 'player1' : 'player2',
      player1: mkPlayer(p1Sid, p1Addr, p1Name),
      player2: mkPlayer(p2Sid, p2Addr, p2Name),
      pot: 0,
      pausedFor: null, pausedAt: null, pauseTimeoutMs: this.PAUSE_TIMEOUT_MS, pauseReason: null,
      pendingShot: null,
      createdAt: Date.now(), startedAt: null, endedAt: null,
      endReason: null, winner: null,
      turnStartedAt: 0, turnTimeoutMs: this.TURN_TIMEOUT_MS,
    };

    this.games.set(gameId, game);
    this.playerToGame.set(p1Sid, gameId);
    this.playerToGame.set(p2Sid, gameId);
    return game;
  }

  // ==========================================================================
  // BALANCE CHECK (pre-game and before each turn)
  // ==========================================================================

  async checkPlayerBalance(address: string, requiredSats: number): Promise<{
    sufficient: boolean;
    balance: number;
    needed: number;
  }> {
    const balance = await fetchBalance(address);
    return {
      sufficient: balance >= requiredSats,
      balance,
      needed: Math.max(0, requiredSats - balance),
    };
  }

  // ==========================================================================
  // SHEEP PLACEMENT
  // ==========================================================================

  submitSheepPositions(
    socketId: string,
    positions: { row: number; col: number }[]
  ): { success: boolean; error?: string; bothReady?: boolean } {
    const game = this.getGameBySocket(socketId);
    if (!game) return { success: false, error: 'Not in a game' };
    if (game.phase !== 'setup') return { success: false, error: 'Not in setup' };

    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };

    const player = game[slot];
    if (player.sheepReady) return { success: false, error: 'Already submitted' };

    const v = validateSheepPositions(positions);
    if (!v.valid) return { success: false, error: v.error };

    player.sheepPositions = new Set(positions.map(p => cellKey(p.row, p.col)));
    player.sheepReady = true;
    player.sheepRemaining = MAX_SHEEP;

    const bothReady = game.player1.sheepReady && game.player2.sheepReady;
    if (bothReady) {
      game.phase = 'playing';
      game.startedAt = Date.now();
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, bothReady };
  }

  // ==========================================================================
  // FIRE SHOT — resolves hit/miss, tells client who must pay whom
  // ==========================================================================

  async fireShot(
    socketId: string,
    row: number,
    col: number,
    escrowAddress: string,
  ): Promise<{ success: boolean; error?: string; resolution?: ShotResolution }> {
    const game = this.getGameBySocket(socketId);
    if (!game) return { success: false, error: 'Not in a game' };
    if (game.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (game.pendingShot) return { success: false, error: 'Waiting for TX verification' };

    const slot = this.getSlot(game, socketId);
    if (!slot) return { success: false, error: 'Not a player' };
    if (game.currentTurn !== slot) return { success: false, error: 'Not your turn' };
    if (!isValidCell(row, col)) return { success: false, error: 'Invalid cell' };

    const key = cellKey(row, col);
    const shooter = game[slot];
    const defSlot = this.opponentSlot(slot);
    const defender = game[defSlot];

    if (defender.shotsReceived.has(key)) {
      return { success: false, error: 'Already shot there' };
    }

    const isHit = defender.sheepPositions.has(key);

    // Set pending shot, wait for TX verification
    const resolution: ShotResolution = isHit
      ? {
          position: { row, col }, result: 'hit',
          payer: defSlot, payerAddress: defender.address,
          payeeAddress: shooter.address, amountSats: game.hitSats,
          defenderSheepRemaining: defender.sheepRemaining - 1,
          pot: game.pot,
        }
      : {
          position: { row, col }, result: 'miss',
          payer: slot, payerAddress: shooter.address,
          payeeAddress: escrowAddress, amountSats: game.missSats,
          defenderSheepRemaining: defender.sheepRemaining,
          pot: game.pot + game.missSats,
        };

    game.pendingShot = {
      shooter: slot, row, col, isHit,
      requiredTxType: isHit ? 'hit' : 'miss',
      requiredAmount: resolution.amountSats,
      requiredTo: resolution.payeeAddress,
      requiredFrom: resolution.payer,
    };

    // Pause turn timer while waiting for TX
    this.clearTurnTimer(game.id);

    return { success: true, resolution };
  }

  // ==========================================================================
  // VERIFY TX — client sends signed raw TX hex, server verifies & broadcasts
  // ==========================================================================
  // verifyFn is now: (rawHex, toAddr, minAmt, gameId, payerAddr) => result
  // This replaces the old TXID-based trust model.

  async verifyShot(
    socketId: string,
    rawTxHex: string,
    verifyFn: (
      rawTxHex: string,
      toAddr: string,
      minAmt: number,
      gameId: string,
      payerAddr: string,
    ) => Promise<{ verified: boolean; txid: string; amount: number; error?: string }>,
  ): Promise<{
    success: boolean;
    txid?: string;
    error?: string;
    applied?: boolean;
    gameOver?: boolean;
    winner?: PlayerSlot | null;
  }> {
    const game = this.getGameBySocket(socketId);
    if (!game || !game.pendingShot) return { success: false, error: 'No pending shot' };

    const ps = game.pendingShot;
    const payerSlot = ps.requiredFrom;

    // Verify the payer is the one submitting
    const slot = this.getSlot(game, socketId);
    if (slot !== payerSlot) return { success: false, error: 'Wrong player verifying' };

    // ---- REAL VERIFICATION: parse TX, validate outputs, broadcast ----
    const result = await verifyFn(
      rawTxHex,
      ps.requiredTo,
      ps.requiredAmount,
      game.id,
      game[payerSlot].address,
    );

    if (!result.verified) {
      console.warn(`❌ TX verification failed for game ${game.id.slice(0, 8)}: ${result.error}`);
      return { success: false, error: result.error || 'TX verification failed' };
    }

    console.log(`✅ TX verified & broadcast: ${result.txid.slice(0, 16)}... | ${result.amount} sats → ${ps.requiredTo.slice(0, 12)}...`);

    // Apply the shot
    const shooter = game[ps.shooter];
    const defSlot = this.opponentSlot(ps.shooter);
    const defender = game[defSlot];
    const key = cellKey(ps.row, ps.col);

    if (ps.isHit) {
      defender.shotsReceived.set(key, 'hit');
      defender.sheepRemaining--;
      shooter.hits++;
    } else {
      defender.shotsReceived.set(key, 'miss');
      shooter.misses++;
      game.pot += ps.requiredAmount;
    }
    shooter.shotsFired++;
    game.pendingShot = null;

    // Unpause if was paused
    if (game.phase === 'paused') {
      game.phase = 'playing';
      game.pausedFor = null;
      game.pausedAt = null;
      game.pauseReason = null;
      this.clearPauseTimer(game.id);
    }

    // Check game over
    let gameOver = false;
    let winner: PlayerSlot | null = null;

    if (defender.sheepRemaining <= 0) {
      gameOver = true;
      winner = ps.shooter;
      this.endGame(game, winner, 'all_sheep_sunk');
    } else {
      // Switch turns
      game.currentTurn = defSlot;
      game.turnStartedAt = Date.now();
      this.startTurnTimer(game);
    }

    return { success: true, txid: result.txid, applied: true, gameOver, winner };
  }

  // ==========================================================================
  // PAUSE / RESUME (player needs to add funds)
  // ==========================================================================

  private pauseGame(game: GameState, forSlot: PlayerSlot, amountNeeded: number, reason: string): void {
    game.phase = 'paused';
    game.pausedFor = forSlot;
    game.pausedAt = Date.now();
    game.pauseReason = reason;
    this.clearTurnTimer(game.id);

    // Start pause timer — forfeit if funds not added in time
    const timer = setTimeout(() => {
      if (game.phase !== 'paused') return;
      const winnerSlot = this.opponentSlot(forSlot);
      this.endGame(game, winnerSlot, 'insufficient_funds');
      this.onPauseTimeout?.(game.id, winnerSlot, forSlot);
    }, game.pauseTimeoutMs);

    this.pauseTimers.set(game.id, timer);
    this.onFundsNeeded?.(game.id, forSlot, amountNeeded);
  }

  private clearPauseTimer(gameId: string): void {
    const t = this.pauseTimers.get(gameId);
    if (t) { clearTimeout(t); this.pauseTimers.delete(gameId); }
  }

  // ==========================================================================
  // GAME END
  // ==========================================================================

  endGame(game: GameState, winner: PlayerSlot, reason: GameEndReason): GameOverResult {
    game.phase = 'gameover';
    game.endedAt = Date.now();
    game.endReason = reason;
    game.winner = winner;
    game.pendingShot = null;
    this.clearTurnTimer(game.id);
    this.clearPauseTimer(game.id);

    const loser = this.opponentSlot(winner);
    const cutPct = Math.min(100, Math.max(0, parseInt(process.env.PLATFORM_CUT_PERCENT || '50') || 50));
    const winnerPayout = Math.floor(game.pot * (1 - cutPct / 100));
    const platformCut = game.pot - winnerPayout;

    return {
      winner, loser, reason,
      pot: game.pot, winnerPayout, platformCut,
      winnerAddress: game[winner].address,
      loserAddress: game[loser].address,
    };
  }

  forfeit(socketId: string): { gameId: string; result: GameOverResult } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;
    const winner = this.opponentSlot(slot);
    const result = this.endGame(game, winner, 'forfeit');
    return { gameId: game.id, result };
  }

  handleDisconnect(socketId: string): {
    gameId: string; slot: PlayerSlot;
    graceStarted: boolean; immediateResult: GameOverResult | null;
  } | null {
    const game = this.getGameBySocket(socketId);
    if (!game || game.phase === 'gameover') return null;
    const slot = this.getSlot(game, socketId);
    if (!slot) return null;

    game[slot].connected = false;
    game[slot].disconnectedAt = Date.now();
    const winner = this.opponentSlot(slot);

    if (game.phase === 'setup') {
      const result = this.endGame(game, winner, 'disconnect');
      return { gameId: game.id, slot, graceStarted: false, immediateResult: result };
    }

    if (game.phase === 'playing' || game.phase === 'paused') {
      setTimeout(() => {
        const g = this.games.get(game.id);
        if (!g || g.phase === 'gameover') return;
        if (!g[slot].connected) {
          const result = this.endGame(g, winner, 'disconnect');
          this.onTurnTimeout?.(game.id, winner, slot);
        }
      }, this.RECONNECT_GRACE_MS);
      return { gameId: game.id, slot, graceStarted: true, immediateResult: null };
    }

    return null;
  }

  handleReconnect(socketId: string, gameId: string, address: string): {
    success: boolean; game?: GameState; slot?: PlayerSlot; error?: string;
  } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };

    let slot: PlayerSlot | null = null;
    if (game.player1.address === address) slot = 'player1';
    else if (game.player2.address === address) slot = 'player2';
    if (!slot) return { success: false, error: 'Not in this game' };

    game[slot].connected = true;
    game[slot].disconnectedAt = null;
    game[slot].socketId = socketId;
    this.playerToGame.set(socketId, gameId);
    return { success: true, game, slot };
  }

  // ==========================================================================
  // TURN TIMER
  // ==========================================================================

  private startTurnTimer(game: GameState): void {
    this.clearTurnTimer(game.id);
    const timer = setTimeout(() => {
      if (game.phase !== 'playing') return;
      const loser = game.currentTurn;
      const winner = this.opponentSlot(loser);
      this.endGame(game, winner, 'timeout');
      this.onTurnTimeout?.(game.id, winner, loser);
    }, game.turnTimeoutMs);
    this.turnTimers.set(game.id, timer);
  }

  private clearTurnTimer(gameId: string): void {
    const t = this.turnTimers.get(gameId);
    if (t) { clearTimeout(t); this.turnTimers.delete(gameId); }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  getGame(id: string) { return this.games.get(id); }
  getGameBySocket(sid: string) { const id = this.playerToGame.get(sid); return id ? this.games.get(id) : undefined; }
  getSlot(g: GameState, sid: string): PlayerSlot | null {
    if (g.player1.socketId === sid) return 'player1';
    if (g.player2.socketId === sid) return 'player2';
    return null;
  }
  opponentSlot(s: PlayerSlot): PlayerSlot { return s === 'player1' ? 'player2' : 'player1'; }
  removeGame(id: string) {
    const g = this.games.get(id);
    if (!g) return;
    if (this.playerToGame.get(g.player1.socketId) === id) this.playerToGame.delete(g.player1.socketId);
    if (this.playerToGame.get(g.player2.socketId) === id) this.playerToGame.delete(g.player2.socketId);
    this.clearTurnTimer(id); this.clearPauseTimer(id); this.games.delete(id);
  }
  getActiveCount() { return this.games.size; }
}

export const gameManager = new GameManager();