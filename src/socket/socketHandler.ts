// ============================================================================
// SOCKET HANDLER
// ============================================================================

import { Server, Socket } from 'socket.io';
import { gameManager, PlayerSlot, GameOverResult } from '../game/GameManager';
import { matchmakingQueue } from '../game/Matchmaking';
import { getTierByValue, getMinBalanceSats } from '../game/constants';
import { escrowManager, priceService, fetchBalance, verifyAndBroadcastTx } from '../wallet/bsvService';
import * as db from '../db/database';
import { socketRateLimiter } from './socketRateLimiter';
import { sessionManager } from './sessionManager';
import { lobbyManager } from '../game/LobbyManager';

// Rate-limited event wrapper — returns false (and emits error) if blocked
function rateCheck(socket: Socket, event: string): boolean {
  if (!socketRateLimiter.check(socket.id, event)) {
    socket.emit('error', { message: 'Too many requests. Slow down.' });
    return false;
  }
  return true;
}

// Track pending session revocations so we can cancel them on reconnect
const pendingRevocations = new Map<string, NodeJS.Timeout>(); // gameId:slot → timer
const REVOCATION_DELAY_MS = 35_000; // slightly longer than reconnect grace (30s)

export function setupSocketHandlers(io: Server): void {

  // ==========================================================================
  // LOBBY BROADCAST — sends updated player list to all connected sockets
  // Throttled to max once per second to avoid flooding
  // ==========================================================================
  let lobbyBroadcastTimer: NodeJS.Timeout | null = null;
  function broadcastLobby(): void {
    if (lobbyBroadcastTimer) return; // already scheduled
    lobbyBroadcastTimer = setTimeout(() => {
      lobbyBroadcastTimer = null;
      const players = lobbyManager.getOnlinePlayers();
      const count = lobbyManager.getOnlineCount();
      console.log(`📡 Broadcasting lobby_update: ${count} players, sockets: ${io.engine.clientsCount}`);
      io.emit('lobby_update', { players, onlineCount: count });
    }, 500);
  }

  // Challenge expiry callback
  lobbyManager.onChallengeExpired = (challenge) => {
    io.to(challenge.fromSocketId).emit('challenge_expired', {
      challengeId: challenge.id,
      toUsername: challenge.toUsername,
      message: `Challenge to ${challenge.toUsername} expired`,
    });
    io.to(challenge.toSocketId).emit('challenge_expired', {
      challengeId: challenge.id,
      fromUsername: challenge.fromUsername,
      message: `Challenge from ${challenge.fromUsername} expired`,
    });
  };

  // ==========================================================================
  // TIMEOUT CALLBACKS
  // ==========================================================================

  gameManager.onTurnTimeout = async (gameId, winnerSlot, loserSlot) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    await handleGameEnd(game, gameManager.endGame(game, winnerSlot, 'timeout'));
  };

  gameManager.onPauseTimeout = async (gameId, winnerSlot, loserSlot) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    const result = gameManager.endGame(game, winnerSlot, 'insufficient_funds');
    await handleGameEnd(game, result);
  };

  gameManager.onFundsNeeded = (gameId, slot, amountNeeded) => {
    const game = gameManager.getGame(gameId);
    if (!game) return;
    io.to(game[slot].socketId).emit('funds_needed', {
      amountNeeded,
      address: game[slot].address,
      timeoutMs: game.pauseTimeoutMs,
      message: `Add ${amountNeeded} sats to continue. You have 60 seconds.`,
    });
    const oppSlot = gameManager.opponentSlot(slot);
    io.to(game[oppSlot].socketId).emit('game_paused', {
      reason: `${game[slot].username} needs to add funds (60s)`,
      timeoutMs: game.pauseTimeoutMs,
    });
  };

  // ==========================================================================
  // CONNECTION
  // ==========================================================================

  io.on('connection', (socket: Socket) => {
      console.log(`🔌 ${socket.id} connected`);
      
      // TEMP DEBUG: confirm events are being received
      socket.onAny((event, ...args) => {
        console.log(`📨 [${socket.id}] ${event}`, JSON.stringify(args).slice(0, 200));
      });
    // ========================================================================
    // FIND MATCH
    // ========================================================================
    socket.on('find_match', async (data: {
      address: string; username: string; stakeTier: number;
    }) => {
      if (!rateCheck(socket, 'find_match')) return;
      const { address, username, stakeTier } = data;

      // Validate
      const tier = getTierByValue(stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }
      if (!username || username.length > 20) { socket.emit('error', { message: 'Bad username' }); return; }
      if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
        socket.emit('error', { message: 'Invalid BSV address' }); return;
      }

      const clean = username.replace(/[<>&"']/g, '').trim();

      // Issue a session token for authenticating REST proxy requests
      const sessionToken = sessionManager.create(socket.id, address);
      socket.emit('session_token', { token: sessionToken });

      const bsvPrice = await priceService.getPrice();

      await db.ensurePlayer(address, clean);

      const result = matchmakingQueue.enqueue({
        socketId: socket.id, address, username: clean, stakeTier, queuedAt: Date.now(),
      });

      if (result.matched && result.opponent) {
        const game = await gameManager.createGame(
          result.opponent.socketId, result.opponent.address, result.opponent.username,
          socket.id, address, clean, stakeTier,
        );
        if (!game) { socket.emit('error', { message: 'Game creation failed' }); return; }

        await db.recordGameStart(game.id, stakeTier, result.opponent.address, address);

        // Update lobby status for both players
        lobbyManager.setStatus(result.opponent.socketId, 'in_game');
        lobbyManager.setStatus(socket.id, 'in_game');
        broadcastLobby();

        const payload = (oppName: string, oppAddr: string, role: PlayerSlot) => ({
          gameId: game.id,
          opponent: { username: oppName, address: oppAddr },
          role,
          tier: { name: tier.name, missCents: tier.missCents, hitCents: tier.hitCents },
          missSats: game.missSats,
          hitSats: game.hitSats,
          escrowAddress: escrowManager.getGameAddress(game.id),
          bsvPrice: game.bsvPriceAtStart,
        });

        io.to(result.opponent.socketId).emit('match_found',
          payload(clean, address, 'player1'));
        io.to(socket.id).emit('match_found',
          payload(result.opponent.username, result.opponent.address, 'player2'));

        console.log(`🎮 ${result.opponent.username} vs ${clean} @ ${tier.name}`);
      } else {
        lobbyManager.setStatus(socket.id, 'matchmaking');
        broadcastLobby();
        socket.emit('matchmaking_started', { tier: tier.name });
      }
    });

    socket.on('cancel_matchmaking', () => {
      if (!rateCheck(socket, 'cancel_matchmaking')) return;
      matchmakingQueue.remove(socket.id);
      lobbyManager.setStatus(socket.id, 'idle');
      socket.emit('matchmaking_cancelled');
      broadcastLobby();
    });

    // ========================================================================
    // LOBBY — Online player list + direct challenges
    // ========================================================================

    socket.on('join_lobby', async (data: { address: string; username: string }) => {
      if (!rateCheck(socket, 'join_lobby')) return;
      const { address, username } = data;

      console.log(`📋 join_lobby: ${username} (${address?.slice(0, 8)}...)`);

      if (!username || username.length > 20) {
        console.log(`📋 join_lobby rejected: invalid username "${username}"`);
        return;
      }
      if (!address || !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
        console.log(`📋 join_lobby rejected: invalid address "${address}"`);
        return;
      }

      const clean = username.replace(/[<>&"']/g, '').trim();

      // Fetch player stats from DB for display
      let stats = { gamesWon: 0, gamesPlayed: 0 };
      try {
        const playerStats = await db.getPlayerStats(address);
        if (playerStats) {
          stats = { gamesWon: playerStats.games_won || 0, gamesPlayed: playerStats.games_played || 0 };
        }
      } catch { /* ignore */ }

      lobbyManager.join(socket.id, address, clean, stats);
      console.log(`📋 Lobby now has ${lobbyManager.getOnlineCount()} players:`, lobbyManager.getOnlinePlayers().map(p => p.username));
      broadcastLobby();
    });

    socket.on('get_lobby', () => {
      if (!rateCheck(socket, 'get_lobby')) return;
      const players = lobbyManager.getOnlinePlayers();
      const count = lobbyManager.getOnlineCount();
      console.log(`📋 get_lobby requested by ${socket.id}: ${count} players`);
      socket.emit('lobby_update', { players, onlineCount: count });
    });

    socket.on('challenge_player', (data: { toAddress: string; stakeTier: number }) => {
      if (!rateCheck(socket, 'challenge_player')) return;
      const { toAddress, stakeTier } = data;

      const tier = getTierByValue(stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }

      const result = lobbyManager.createChallenge(socket.id, toAddress, stakeTier);
      if (!result.success) {
        socket.emit('challenge_error', { error: result.error });
        return;
      }

      const challenge = result.challenge!;

      // Notify challenger
      socket.emit('challenge_sent', {
        challengeId: challenge.id,
        toUsername: challenge.toUsername,
        toAddress: challenge.toAddress,
        stakeTier,
        tierName: tier.name,
        expiresAt: challenge.expiresAt,
      });

      // Notify challenged player
      io.to(challenge.toSocketId).emit('challenge_received', {
        challengeId: challenge.id,
        fromUsername: challenge.fromUsername,
        fromAddress: challenge.fromAddress,
        stakeTier,
        tierName: tier.name,
        expiresAt: challenge.expiresAt,
      });
    });

    socket.on('accept_challenge', async (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'accept_challenge')) return;

      const result = lobbyManager.acceptChallenge(data.challengeId, socket.id);
      if (!result.success) {
        socket.emit('challenge_error', { error: result.error });
        return;
      }

      const challenge = result.challenge!;
      const tier = getTierByValue(challenge.stakeTier);
      if (!tier) { socket.emit('error', { message: 'Invalid tier' }); return; }

      // Issue session tokens for both players
      const fromPlayer = lobbyManager.getPlayer(challenge.fromSocketId);
      const toPlayer = lobbyManager.getPlayer(challenge.toSocketId);
      if (!fromPlayer || !toPlayer) {
        socket.emit('challenge_error', { error: 'Player left lobby' });
        return;
      }

      const fromToken = sessionManager.create(challenge.fromSocketId, challenge.fromAddress);
      const toToken = sessionManager.create(challenge.toSocketId, challenge.toAddress);
      io.to(challenge.fromSocketId).emit('session_token', { token: fromToken });
      io.to(challenge.toSocketId).emit('session_token', { token: toToken });

      await db.ensurePlayer(challenge.fromAddress, challenge.fromUsername);
      await db.ensurePlayer(challenge.toAddress, challenge.toUsername);

      // Create the game
      const game = await gameManager.createGame(
        challenge.fromSocketId, challenge.fromAddress, challenge.fromUsername,
        challenge.toSocketId, challenge.toAddress, challenge.toUsername,
        challenge.stakeTier,
      );
      if (!game) {
        socket.emit('error', { message: 'Game creation failed' });
        return;
      }

      await db.recordGameStart(game.id, challenge.stakeTier, challenge.fromAddress, challenge.toAddress);

      // Update lobby status
      lobbyManager.setStatus(challenge.fromSocketId, 'in_game');
      lobbyManager.setStatus(challenge.toSocketId, 'in_game');
      broadcastLobby();

      const payload = (oppName: string, oppAddr: string, role: PlayerSlot) => ({
        gameId: game.id,
        opponent: { username: oppName, address: oppAddr },
        role,
        tier: { name: tier.name, missCents: tier.missCents, hitCents: tier.hitCents },
        missSats: game.missSats,
        hitSats: game.hitSats,
        escrowAddress: escrowManager.getGameAddress(game.id),
        bsvPrice: game.bsvPriceAtStart,
      });

      io.to(challenge.fromSocketId).emit('match_found',
        payload(challenge.toUsername, challenge.toAddress, 'player1'));
      io.to(challenge.toSocketId).emit('match_found',
        payload(challenge.fromUsername, challenge.fromAddress, 'player2'));

      console.log(`🎮 Challenge: ${challenge.fromUsername} vs ${challenge.toUsername} @ ${tier.name}`);
    });

    socket.on('decline_challenge', (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'decline_challenge')) return;

      const result = lobbyManager.declineChallenge(data.challengeId, socket.id);
      if (!result.success) return;

      const challenge = result.challenge!;
      io.to(challenge.fromSocketId).emit('challenge_declined', {
        challengeId: challenge.id,
        byUsername: challenge.toUsername,
        message: `${challenge.toUsername} declined your challenge`,
      });
      socket.emit('challenge_declined_ack', { challengeId: challenge.id });
    });

    socket.on('cancel_challenge', (data: { challengeId: string }) => {
      if (!rateCheck(socket, 'cancel_challenge')) return;
      lobbyManager.cancelChallengesFrom(socket.id);
      socket.emit('challenge_cancelled_ack', { challengeId: data.challengeId });
    });

    // ========================================================================
    // PLAYER READY
    // ========================================================================
    socket.on('player_ready', (data: { positions: { row: number; col: number }[] }) => {
      if (!rateCheck(socket, 'player_ready')) return;
      const result = gameManager.submitSheepPositions(socket.id, data.positions);
      if (!result.success) { socket.emit('error', { message: result.error }); return; }

      const game = gameManager.getGameBySocket(socket.id)!;
      const slot = gameManager.getSlot(game, socket.id)!;
      const opp = gameManager.opponentSlot(slot);

      io.to(game[opp].socketId).emit('opponent_ready');

      if (result.bothReady) {
        const startData = {
          currentTurn: game.currentTurn,
          missSats: game.missSats,
          hitSats: game.hitSats,
        };
        io.to(game.player1.socketId).emit('game_start', startData);
        io.to(game.player2.socketId).emit('game_start', startData);
        console.log(`⚔️ Game ${game.id} started`);
      }
    });

    // ========================================================================
    // FIRE SHOT — server resolves, tells client to pay
    // ========================================================================
    socket.on('fire_shot', async (data: { position: { row: number; col: number } }) => {
      if (!rateCheck(socket, 'fire_shot')) return;
      const game = gameManager.getGameBySocket(socket.id);
      if (!game) { socket.emit('error', { message: 'No active game' }); return; }
      const escrowAddr = escrowManager.getGameAddress(game.id);
      const result = await gameManager.fireShot(
        socket.id, data.position.row, data.position.col, escrowAddr,
      );

      if (!result.success) { socket.emit('error', { message: result.error }); return; }

      const res = result.resolution!;
      const slot = gameManager.getSlot(game, socket.id)!;
      const oppSlot = gameManager.opponentSlot(slot);

      // Notify shooter of result
      socket.emit('shot_result', {
        position: res.position,
        result: res.result,
        amountSats: res.amountSats,
        pot: res.pot,
        opponentSheepRemaining: res.defenderSheepRemaining,
      });

      // Notify defender
      io.to(game[oppSlot].socketId).emit('opponent_shot', {
        position: res.position,
        result: res.result,
        pot: res.pot,
        sheepRemaining: res.defenderSheepRemaining,
      });

      // Tell the payer to send TX
      io.to(game[res.payer].socketId).emit('payment_required', {
        type: res.result,
        amount: res.amountSats,
        toAddress: res.payeeAddress,
        fromAddress: res.payerAddress,
        message: res.result === 'miss'
          ? `Miss! Send ${res.amountSats} sats to escrow`
          : `Your sheep was hit! Send ${res.amountSats} sats to ${game[slot].username}`,
      });
    });

    // ========================================================================
    // SUBMIT PAYMENT — client sends signed raw TX hex for verification + broadcast
    // ========================================================================
    const handlePaymentSubmit = async (data: { rawTxHex?: string; txid?: string }) => {
      if (!rateCheck(socket, 'verify_payment')) return;
      
      const rawTxHex = data.rawTxHex || data.txid || '';
      const result = await gameManager.verifyShot(socket.id, rawTxHex, verifyAndBroadcastTx);

      if (!result.success) {
        socket.emit('payment_verification', { success: false, error: result.error });
        return;
      }

      const txid = result.txid || '';
      socket.emit('payment_verification', { success: true, txid });

      const game = gameManager.getGameBySocket(socket.id);
      if (!game) return;

      // Notify both players payment confirmed
      io.to(game.player1.socketId).emit('payment_confirmed', { txid });
      io.to(game.player2.socketId).emit('payment_confirmed', { txid });

      if (result.gameOver && result.winner) {
        const loser = gameManager.opponentSlot(result.winner);
        const cutPct = parseInt(process.env.PLATFORM_CUT_PERCENT || '50');
        const winnerPayout = Math.floor(game.pot * (1 - cutPct / 100));
        const platformCut = game.pot - winnerPayout;
        
        console.log(`🏁 Game over: pot=${game.pot}, winner=${winnerPayout}, platform=${platformCut}`);
        
        const endResult: GameOverResult = {
          winner: result.winner,
          loser,
          reason: 'all_sheep_sunk',
          pot: game.pot,
          winnerPayout,
          platformCut,
          winnerAddress: game[result.winner].address,
          loserAddress: game[loser].address,
        };
        await handleGameEnd(game, endResult);
      } else {
        // Turn change
        io.to(game.player1.socketId).emit('turn_change', {
          currentTurn: game.currentTurn, pot: game.pot,
        });
        io.to(game.player2.socketId).emit('turn_change', {
          currentTurn: game.currentTurn, pot: game.pot,
        });
      }
    };

    socket.on('verify_payment', handlePaymentSubmit);
    socket.on('submit_payment', handlePaymentSubmit);

    // ========================================================================
    // FUNDS ADDED (player refunded their wallet during pause)
    // ========================================================================
    socket.on('funds_added', async () => {
      if (!rateCheck(socket, 'funds_added')) return;
      const game = gameManager.getGameBySocket(socket.id);
      if (!game || game.phase !== 'paused') return;

      const slot = gameManager.getSlot(game, socket.id);
      if (!slot || game.pausedFor !== slot) return;

      const ps = game.pendingShot;
      if (!ps) return;

      const balance = await fetchBalance(game[slot].address);
      if (balance < ps.requiredAmount) {
        socket.emit('error', { message: `Still insufficient. Need ${ps.requiredAmount} sats, have ${balance}.` });
        return;
      }

      // Resume
      io.to(game[slot].socketId).emit('payment_required', {
        type: ps.requiredTxType,
        amount: ps.requiredAmount,
        toAddress: ps.requiredTo,
        fromAddress: game[ps.requiredFrom].address,
        message: 'Funds confirmed! Send payment now.',
      });

      const oppSlot = gameManager.opponentSlot(slot);
      io.to(game[oppSlot].socketId).emit('game_resumed', {
        message: `${game[slot].username} added funds. Game continuing...`,
      });
    });

    // ========================================================================
    // FORFEIT
    // ========================================================================
    socket.on('forfeit', async () => {
      if (!rateCheck(socket, 'forfeit')) return;
      const result = gameManager.forfeit(socket.id);
      if (!result) return;
      const game = gameManager.getGame(result.gameId);
      if (!game) return;
      await handleGameEnd(game, result.result);
    });

    socket.on('leave_game', () => { socket.emit('forfeit'); });

    // ========================================================================
    // RECONNECT
    // ========================================================================
    socket.on('reconnect_game', (data: { gameId: string; address: string }) => {
      if (!rateCheck(socket, 'reconnect_game')) return;
      const result = gameManager.handleReconnect(socket.id, data.gameId, data.address);
      if (!result.success) {
        socket.emit('reconnect_result', { success: false, error: result.error });
        return;
      }
      const game = result.game!;
      const slot = result.slot!;
      const opp = gameManager.opponentSlot(slot);

      // Cancel any pending session revocation for this player
      const revocationKey = `${game.id}:${slot}`;
      const pendingTimer = pendingRevocations.get(revocationKey);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingRevocations.delete(revocationKey);
        console.log(`🔄 Cancelled session revocation for ${slot} in game ${game.id.slice(0, 8)}`);
      }

      // Issue a fresh session token for the new socket
      const sessionToken = sessionManager.create(socket.id, data.address);
      socket.emit('session_token', { token: sessionToken });

      socket.emit('reconnect_result', {
        success: true,
        gameState: {
          gameId: game.id, phase: game.phase,
          currentTurn: game.currentTurn, role: slot,
          opponent: { username: game[opp].username, address: game[opp].address },
          pot: game.pot, missSats: game.missSats, hitSats: game.hitSats,
          sheepRemaining: game[slot].sheepRemaining,
          opponentSheepRemaining: game[opp].sheepRemaining,
          shotsReceived: Object.fromEntries(game[slot].shotsReceived),
          // Include shots fired at opponent (for restoring the attack board)
          shotsFiredResults: Object.fromEntries(game[opp].shotsReceived),
          pendingPayment: game.pendingShot && game.pendingShot.requiredFrom === slot
            ? { amount: game.pendingShot.requiredAmount, toAddress: game.pendingShot.requiredTo }
            : null,
        },
      });
      io.to(game[opp].socketId).emit('opponent_reconnected');
      console.log(`🔄 ${game[slot].username} reconnected to game ${game.id.slice(0, 8)}`);
    });

    // ========================================================================
    // DISCONNECT
    // ========================================================================
    socket.on('disconnect', async () => {
      console.log(`🔌 ${socket.id} disconnected`);
      socketRateLimiter.cleanup(socket.id);
      matchmakingQueue.remove(socket.id);
      lobbyManager.leave(socket.id);
      broadcastLobby();

      // DON'T revoke session immediately — delay it to allow reconnection
      // The session will be revoked after the reconnect grace period expires,
      // or cancelled if the player reconnects in time
      const gameResult = gameManager.handleDisconnect(socket.id);
      
      if (gameResult) {
        const game = gameManager.getGame(gameResult.gameId);
        
        if (gameResult.graceStarted && game) {
          // Delay session revocation — give player time to reconnect
          const revocationKey = `${gameResult.gameId}:${gameResult.slot}`;
          const timer = setTimeout(() => {
            sessionManager.revokeBySocket(socket.id);
            pendingRevocations.delete(revocationKey);
          }, REVOCATION_DELAY_MS);
          pendingRevocations.set(revocationKey, timer);

          const opp = gameManager.opponentSlot(gameResult.slot);
          io.to(game[opp].socketId).emit('opponent_disconnected', {
            gameOver: false,
            message: `${game[gameResult.slot].username} disconnected. 30s to reconnect...`,
            graceMs: 30000,
          });
        } else if (gameResult.immediateResult && game) {
          // Immediate end (e.g., during setup) — revoke session now
          sessionManager.revokeBySocket(socket.id);
          const opp = gameManager.opponentSlot(gameResult.slot);
          io.to(game[opp].socketId).emit('opponent_disconnected', {
            gameOver: true,
            message: `${game[gameResult.slot].username} disconnected. You win!`,
          });
          await handleGameEnd(game, gameResult.immediateResult);
        } else {
          // No game impact — revoke immediately
          sessionManager.revokeBySocket(socket.id);
        }
      } else {
        // Not in a game — revoke immediately
        sessionManager.revokeBySocket(socket.id);
      }
    });

    // ========================================================================
    // INFO
    // ========================================================================
    socket.on('get_queue_info', () => {
      if (!rateCheck(socket, 'get_queue_info')) return;
      socket.emit('queue_info', {
        queues: matchmakingQueue.getQueueSizes(),
        activeGames: gameManager.getActiveCount(),
      });
    });

    socket.on('get_leaderboard', async () => {
      if (!rateCheck(socket, 'get_leaderboard')) return;
      try { socket.emit('leaderboard', await db.getLeaderboard()); }
      catch { socket.emit('error', { message: 'Leaderboard failed' }); }
    });
  });

  // ==========================================================================
  // GAME END HANDLER — settle escrow, record to DB
  // ==========================================================================

  async function handleGameEnd(game: any, result: GameOverResult) {
    const winner = game[result.winner];
    const loser = game[result.loser];

    // Notify both players that settlement is in progress
    io.to(winner.socketId).emit('settling', { message: '💰 Settling accounts...' });
    io.to(loser.socketId).emit('settling', { message: '💰 Settling accounts...' });

    // Settle escrow → winner + final wallet
    let settleTxid = '';
    if (result.pot > 0 && (result.winnerPayout > 546 || result.platformCut > 546)) {
      const tx = await escrowManager.settle(
        game.id, result.winnerAddress, result.winnerPayout, result.platformCut,
      );
      if (tx.success) {
        settleTxid = tx.txid || '';
        console.log(`💸 Settled game ${game.id}: ${result.winnerPayout}→winner, ${result.platformCut}→platform`);
      } else {
        console.error(`❌ Settlement failed: ${tx.error}`);
      }
    }

    // Emit to both players
    const base = {
      winner: result.winner,
      reason: result.reason,
      pot: result.pot,
      settleTxid,
    };

    io.to(winner.socketId).emit('game_over', {
      ...base,
      winnerPayout: result.winnerPayout,
      message: winMsg(result.reason, loser.username),
    });
    io.to(loser.socketId).emit('game_over', {
      ...base,
      winnerPayout: 0,
      message: loseMsg(result.reason, winner.username),
    });

    // Record to DB
    try {
      await db.recordGameEnd(
        game.id, result.winnerAddress, result.reason,
        result.pot, result.winnerPayout, result.platformCut, settleTxid,
        { hits: game.player1.hits, misses: game.player1.misses, sheepLeft: game.player1.sheepRemaining },
        { hits: game.player2.hits, misses: game.player2.misses, sheepLeft: game.player2.sheepRemaining },
      );
    } catch (err) { console.error('DB record failed:', err); }

    // Clean up any pending revocations for this game
    pendingRevocations.delete(`${game.id}:player1`);
    pendingRevocations.delete(`${game.id}:player2`);

    // Reset lobby status for both players
    lobbyManager.setStatus(winner.socketId, 'idle');
    lobbyManager.setStatus(loser.socketId, 'idle');
    broadcastLobby();

    setTimeout(() => gameManager.removeGame(game.id), 60_000);
  }

  function winMsg(reason: string, opp: string): string {
    const m: Record<string, string> = {
      all_sheep_sunk: `You destroyed all of ${opp}'s sheep!`,
      disconnect: `${opp} disconnected. You win!`,
      forfeit: `${opp} forfeited!`,
      timeout: `${opp} ran out of time!`,
      insufficient_funds: `${opp} ran out of funds!`,
    };
    return m[reason] || 'You won!';
  }

  function loseMsg(reason: string, opp: string): string {
    const m: Record<string, string> = {
      all_sheep_sunk: `${opp} destroyed all your sheep!`,
      disconnect: 'You disconnected and lost.',
      forfeit: 'You forfeited.',
      timeout: 'You ran out of time!',
      insufficient_funds: 'You ran out of funds!',
    };
    return m[reason] || 'You lost.';
  }
}