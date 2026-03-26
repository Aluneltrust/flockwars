// ============================================================================
// USE MULTIPLAYER HOOK — Updated for escrow/payment server protocol
// With automatic game reconnection on disconnect/reconnect
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { BACKEND_URL } from '../constants/gameConstants';
import { soundManager } from '../services/SoundManager';
import { setSessionToken } from '../services/BSVWalletService';

export type GamePhase = 'connect' | 'lobby' | 'matchmaking' | 'setup' | 'playing' | 'paused' | 'gameover';
export type PlayerRole = 'player1' | 'player2';
export type TurnState = 'player' | 'opponent';

export interface PaymentRequest {
  type: 'miss' | 'hit';
  amount: number;
  toAddress: string;
  fromAddress: string;
  message: string;
}

export interface GameState {
  gamePhase: GamePhase;
  gameId: string;
  opponentName: string;
  opponentAddress: string;
  myRole: PlayerRole;
  currentTurn: TurnState;
  opponentReady: boolean;
  winner: 'player' | 'opponent' | null;
  gamePot: number;
  myMisses: number;
  opponentMisses: number;
  escrowAddress: string;
  missSats: number;
  hitSats: number;
  pendingPayment: PaymentRequest | null;
  isPaused: boolean;
  pauseMessage: string;
}

export interface MultiplayerCallbacks {
  onMatchFound: (data: {
    gameId: string;
    opponent: { username: string; address: string };
    role: PlayerRole;
    escrowAddress: string;
    missSats: number;
    hitSats: number;
  }) => void;
  onOpponentReady: () => void;
  onGameStart: (data: { currentTurn: string; missSats: number; hitSats: number }) => void;
  onShotResult: (data: {
    position: { row: number; col: number };
    result: 'hit' | 'miss';
    amountSats: number;
    pot: number;
    opponentSheepRemaining: number;
  }) => void;
  onOpponentShot: (data: {
    position: { row: number; col: number };
    result: 'hit' | 'miss';
    pot: number;
    sheepRemaining: number;
  }) => void;
  onPaymentRequired: (payment: PaymentRequest) => void;
  onPaymentConfirmed: (data: { txid: string }) => void;
  onTurnChange: (data: { currentTurn: string; pot: number }) => void;
  onGameOver: (data: {
    winner: string;
    reason: string;
    pot: number;
    winnerPayout: number;
    settleTxid: string;
    message: string;
  }) => void;
  onFundsNeeded: (data: { amountNeeded: number; address: string; timeoutMs: number; message: string }) => void;
  onOpponentDisconnected: (data: { gameOver: boolean; message: string }) => void;
  onError: (data: { message: string; needSats?: number; haveSats?: number }) => void;
  // NEW: called when reconnection restores game state
  onReconnected?: (gameState: any) => void;
}

// ============================================================================
// SESSION STORAGE HELPERS — persist active game across disconnects/refreshes
// ============================================================================

const ACTIVE_GAME_KEY = 'herdswacker_active_game';

interface ActiveGameInfo {
  gameId: string;
  address: string;
  role: PlayerRole;
  opponentName: string;
  opponentAddress: string;
  escrowAddress: string;
  missSats: number;
  hitSats: number;
  stakeTier: number;
  savedAt: number;
}

function saveActiveGame(info: ActiveGameInfo): void {
  try {
    localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(info));
  } catch { /* storage not available */ }
}

function loadActiveGame(): ActiveGameInfo | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!raw) return null;
    const info: ActiveGameInfo = JSON.parse(raw);
    // Expire after 30 minutes (covers long games + pause time)
    if (Date.now() - info.savedAt > 30 * 60 * 1000) {
      clearActiveGame();
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

function clearActiveGame(): void {
  try {
    localStorage.removeItem(ACTIVE_GAME_KEY);
  } catch { /* ignore */ }
}

// ============================================================================
// HOOK
// ============================================================================

export const useMultiplayer = (callbacks: MultiplayerCallbacks) => {
  const socketRef = useRef<Socket | null>(null);
  const myRoleRef = useRef<PlayerRole>('player1');
  const addressRef = useRef<string>('');
  const reconnectAttemptedRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [gamePhase, setGamePhase] = useState<GamePhase>('connect');
  const [gameId, setGameId] = useState('');
  const [opponentName, setOpponentName] = useState('');
  const [opponentAddress, setOpponentAddress] = useState('');
  const [myRole, setMyRole] = useState<PlayerRole>('player1');
  const [currentTurn, setCurrentTurn] = useState<TurnState>('player');
  const [opponentReady, setOpponentReady] = useState(false);
  const [winner, setWinner] = useState<'player' | 'opponent' | null>(null);
  const [gamePot, setGamePot] = useState(0);
  const [myMisses, setMyMisses] = useState(0);
  const [opponentMisses, setOpponentMisses] = useState(0);
  const [message, setMessage] = useState('');

  // Payment flow state
  const [escrowAddress, setEscrowAddress] = useState('');
  const [missSats, setMissSats] = useState(0);
  const [hitSats, setHitSats] = useState(0);
  const [pendingPayment, setPendingPayment] = useState<PaymentRequest | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [pauseMessage, setPauseMessage] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);

  // ========================================================================
  // ATTEMPT RECONNECT — called on socket (re)connect if we have a saved game
  // ========================================================================
  const attemptReconnect = useCallback((socket: Socket) => {
    const saved = loadActiveGame();
    if (!saved) return;

    // Use saved address or current address
    const addr = addressRef.current || saved.address;
    if (!addr || !saved.gameId) return;

    console.log(`🔄 Attempting reconnect to game ${saved.gameId.slice(0, 8)}...`);
    setIsReconnecting(true);
    setMessage('Reconnecting to game...');
    socket.emit('reconnect_game', { gameId: saved.gameId, address: addr });
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,          // Enable auto-reconnect
      reconnectionAttempts: 10,    // Try up to 10 times
      reconnectionDelay: 1000,     // Start with 1s delay
      reconnectionDelayMax: 5000,  // Cap at 5s delay
    });

    socket.on('connect', () => {
      console.log('🔌 Connected to server');
      setIsConnected(true);

      // Always check for an active game to reconnect to — whether this is
      // the first connect or a re-connect. This handles the case where the
      // user closed the tab and opened a fresh one.
      const saved = loadActiveGame();
      if (saved && addressRef.current) {
        attemptReconnect(socket);
      }
    });

    socket.on('session_token', ({ token }: { token: string }) => {
      setSessionToken(token);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Disconnected: ${reason}`);
      setIsConnected(false);

      // Don't reset game state on disconnect — we want to reconnect
      if (reason === 'io server disconnect') {
        // Server kicked us — force reconnect
        socket.connect();
      }
      // For other reasons (transport close, ping timeout), socket.io
      // will auto-reconnect since we enabled reconnection: true
    });

    // ======================================================================
    // MATCHMAKING
    // ======================================================================

    socket.on('matchmaking_started', ({ tier }) => {
      setMessage(`Searching for ${tier} opponent...`);
      setGamePhase('matchmaking');
    });

    socket.on('matchmaking_cancelled', () => {
      setMessage('');
      setGamePhase('lobby');
    });

    // ======================================================================
    // MATCH FOUND — includes escrow address and sat values
    // ======================================================================

    socket.on('match_found', (data) => {
      const { gameId: gid, opponent, role, escrowAddress: escrow, missSats: ms, hitSats: hs } = data;
      setGameId(gid);
      setOpponentName(opponent.username);
      setOpponentAddress(opponent.address);
      setMyRole(role);
      myRoleRef.current = role;
      setEscrowAddress(escrow);
      setMissSats(ms);
      setHitSats(hs);
      setGamePhase('setup');
      setMessage(`Matched with ${opponent.username}! Place your sheep.`);

      // Persist active game for reconnection
      saveActiveGame({
        gameId: gid,
        address: addressRef.current,
        role,
        opponentName: opponent.username,
        opponentAddress: opponent.address,
        escrowAddress: escrow,
        missSats: ms,
        hitSats: hs,
        stakeTier: 0,
        savedAt: Date.now(),
      });

      callbacks.onMatchFound(data);
    });

    // ======================================================================
    // SETUP
    // ======================================================================

    socket.on('opponent_ready', () => {
      setOpponentReady(true);
      setMessage('Opponent is ready! Waiting for you...');
      callbacks.onOpponentReady();
    });

    socket.on('game_start', (data) => {
      const { currentTurn: turn, missSats: ms, hitSats: hs } = data;
      setGamePhase('playing');
      setMissSats(ms);
      setHitSats(hs);
      const isMyTurn = turn === myRoleRef.current;
      setCurrentTurn(isMyTurn ? 'player' : 'opponent');
      setMessage(isMyTurn ? 'Your turn! Fire at will!' : "Opponent's turn...");
      soundManager.speakRandom('startGame');
      callbacks.onGameStart(data);
    });

    // ======================================================================
    // SHOT RESULT — server resolved hit/miss
    // ======================================================================

    socket.on('shot_result', (data) => {
      if (data.result === 'miss') {
        setMyMisses(prev => prev + 1);
      }
      setGamePot(data.pot);
      callbacks.onShotResult(data);
    });

    socket.on('opponent_shot', (data) => {
      if (data.result === 'miss') {
        setOpponentMisses(prev => prev + 1);
      }
      setGamePot(data.pot);
      callbacks.onOpponentShot(data);
    });

    // ======================================================================
    // PAYMENT FLOW — server tells client to send TX
    // ======================================================================

    socket.on('payment_required', (data: PaymentRequest) => {
      console.log('Payment required:', data);
      setPendingPayment(data);
      setMessage(data.message);

      // Safety: clear pending after 30s if not resolved
      setTimeout(() => {
        setPendingPayment(prev => {
          if (prev === data) {
            console.warn('Payment timed out, clearing pending state');
            return null;
          }
          return prev;
        });
      }, 30000);

      callbacks.onPaymentRequired(data);
    });

    socket.on('payment_verification', (data) => {
      if (data.success) {
        setPendingPayment(null);
        console.log('Payment verified:', data.txid);
      } else {
        setPendingPayment(null);
        setMessage(`Payment failed: ${data.error}. Try again.`);
      }
    });

    socket.on('payment_confirmed', (data) => {
      setPendingPayment(null);
      callbacks.onPaymentConfirmed(data);
    });

    // ======================================================================
    // PAUSE / RESUME — player needs funds
    // ======================================================================

    socket.on('funds_needed', (data) => {
      setIsPaused(true);
      setGamePhase('paused');
      setPauseMessage(data.message);
      setMessage(data.message);
      callbacks.onFundsNeeded(data);
    });

    socket.on('game_paused', (data) => {
      setIsPaused(true);
      setGamePhase('paused');
      setPauseMessage(data.reason);
      setMessage(data.reason);
    });

    socket.on('game_resumed', (data) => {
      setIsPaused(false);
      setGamePhase('playing');
      setPauseMessage('');
      setMessage(data.message || 'Game resumed!');
    });

    // ======================================================================
    // TURN CHANGE
    // ======================================================================

    socket.on('turn_change', (data) => {
      const { currentTurn: turn, pot } = data;
      const isMyTurn = turn === myRoleRef.current;
      setCurrentTurn(isMyTurn ? 'player' : 'opponent');
      setGamePot(pot);
      setMessage(isMyTurn ? 'Your turn!' : "Opponent's turn...");
      callbacks.onTurnChange(data);
    });

    // ======================================================================
    // SETTLING — server is processing escrow settlement
    // ======================================================================

    socket.on('settling', (data) => {
      setMessage(data.message || '💰 Settling accounts...');
    });

    // ======================================================================
    // GAME OVER — includes settlement TX
    // ======================================================================

    socket.on('game_over', (data) => {
      const playerWon = data.winner === myRoleRef.current;
      setWinner(playerWon ? 'player' : 'opponent');
      setGamePhase('gameover');
      setGamePot(data.pot);
      setPendingPayment(null);
      setIsPaused(false);
      setMessage(data.message || (playerWon ? 'You won!' : 'You lost!'));
      soundManager.speakPlatform('platformGameEnd');

      // Game is over — clear saved game
      clearActiveGame();

      if (playerWon) {
        soundManager.createCoinGain();
        soundManager.speakRandom('victory');
      } else {
        soundManager.createCoinLose();
        soundManager.speakRandom('defeat');
      }

      callbacks.onGameOver(data);
    });

    // ======================================================================
    // DISCONNECT / RECONNECT
    // ======================================================================

    socket.on('opponent_disconnected', (data) => {
      if (data.gameOver) {
        setWinner('player');
        setGamePhase('gameover');
        clearActiveGame();
        soundManager.speakPlatform('platformGameEnd');
      }
      setMessage(data.message);
      callbacks.onOpponentDisconnected(data);
    });

    socket.on('opponent_reconnected', () => {
      setMessage('Opponent reconnected!');
    });

    socket.on('reconnect_result', (data) => {
      setIsReconnecting(false);

      if (data.success) {
        const gs = data.gameState;
        setGameId(gs.gameId);
        setMyRole(gs.role);
        myRoleRef.current = gs.role;
        setOpponentName(gs.opponent.username);
        setOpponentAddress(gs.opponent.address);
        setGamePot(gs.pot);
        setMissSats(gs.missSats);
        setHitSats(gs.hitSats);
        setGamePhase(gs.phase === 'paused' ? 'paused' : 'playing');
        const isMyTurn = gs.currentTurn === gs.role;
        setCurrentTurn(isMyTurn ? 'player' : 'opponent');
        setMessage('Reconnected!');

        // Re-save with fresh timestamp
        saveActiveGame({
          gameId: gs.gameId,
          address: addressRef.current,
          role: gs.role,
          opponentName: gs.opponent.username,
          opponentAddress: gs.opponent.address,
          escrowAddress: escrowAddress || '',
          missSats: gs.missSats,
          hitSats: gs.hitSats,
          stakeTier: 0,
          savedAt: Date.now(),
        });

        if (gs.pendingPayment) {
          setPendingPayment({
            type: 'miss',
            amount: gs.pendingPayment.amount,
            toAddress: gs.pendingPayment.toAddress,
            fromAddress: '',
            message: 'You have a pending payment — send it now.',
          });
        }

        // Notify parent component to restore board state
        callbacks.onReconnected?.(gs);
      } else {
        console.log(`Reconnect failed: ${data.error}`);
        // Game is gone — clear saved state and go to lobby
        clearActiveGame();
        setMessage(data.error === 'Game not found' ? '' : `Reconnect failed: ${data.error}`);
        setGamePhase('lobby');
      }
    });

    // ======================================================================
    // ERRORS
    // ======================================================================

    socket.on('error', (data) => {
      setMessage(`Error: ${data.message}`);
      callbacks.onError(data);
    });

    socketRef.current = socket;
  }, [callbacks]);

  // ========================================================================
  // ACTIONS
  // ========================================================================

  const setAddress = useCallback((address: string) => {
    addressRef.current = address;
  }, []);

  const findMatch = useCallback((address: string, username: string, stakeTier: number) => {
    if (!username) {
      setMessage('Please enter a username first!');
      return;
    }
    addressRef.current = address;
    socketRef.current?.emit('find_match', { address, username, stakeTier });
  }, []);

  const cancelMatchmaking = useCallback(() => {
    socketRef.current?.emit('cancel_matchmaking');
    setGamePhase('lobby');
    setMessage('');
  }, []);

  const submitSheepPositions = useCallback((positions: { row: number; col: number }[]) => {
    socketRef.current?.emit('player_ready', { positions });
  }, []);

  const fireShot = useCallback((position: { row: number; col: number }) => {
    socketRef.current?.emit('fire_shot', { position });
  }, []);

  const verifyPayment = useCallback((txid: string) => {
    socketRef.current?.emit('verify_payment', { txid });
  }, []);

  const submitPayment = useCallback((rawTxHex: string) => {
    socketRef.current?.emit('submit_payment', { rawTxHex });
  }, []);

  const notifyFundsAdded = useCallback(() => {
    socketRef.current?.emit('funds_added');
  }, []);

  const forfeit = useCallback(() => {
    socketRef.current?.emit('forfeit');
  }, []);

  const leaveGame = useCallback(() => {
    socketRef.current?.emit('leave_game');
    clearActiveGame();
  }, []);

  const reconnectGame = useCallback((gameId: string, address: string) => {
    socketRef.current?.emit('reconnect_game', { gameId, address });
  }, []);

  const clearPendingPayment = useCallback(() => {
    setPendingPayment(null);
  }, []);

  // Check if there's an active game to reconnect to (called from parent on mount)
  const checkPendingReconnect = useCallback((): boolean => {
    const saved = loadActiveGame();
    return saved !== null;
  }, []);

  // Trigger reconnect manually (e.g., after wallet unlock)
  // Must handle case where socket isn't connected yet (first load after tab close)
  const triggerReconnect = useCallback((address: string) => {
    addressRef.current = address;

    if (socketRef.current?.connected) {
      // Socket already connected — reconnect immediately
      attemptReconnect(socketRef.current);
    } else {
      // Socket not connected yet — connect first, then reconnect on connect
      // The socket.on('connect') handler will check for saved game and
      // call attemptReconnect since addressRef is now set
      setGamePhase('lobby'); // This triggers the useEffect that calls connect()
    }
  }, [attemptReconnect]);

  const resetGame = useCallback(() => {
    leaveGame();
    clearActiveGame();
    setGamePhase('lobby');
    setGameId('');
    setOpponentName('');
    setOpponentAddress('');
    setCurrentTurn('player');
    setWinner(null);
    setOpponentReady(false);
    setMessage('');
    setGamePot(0);
    setMyMisses(0);
    setOpponentMisses(0);
    setEscrowAddress('');
    setMissSats(0);
    setHitSats(0);
    setPendingPayment(null);
    setIsPaused(false);
    setPauseMessage('');
  }, [leaveGame]);

  const goToLobby = useCallback(() => {
    setGamePhase('lobby');
    setMessage('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return {
    // State
    isConnected,
    gamePhase,
    gameId,
    opponentName,
    opponentAddress,

    // Socket ref (for lobby event listeners)
    socketRef,
    myRole,
    myRoleRef,
    currentTurn,
    opponentReady,
    winner,
    gamePot,
    myMisses,
    opponentMisses,
    message,
    escrowAddress,
    missSats,
    hitSats,
    pendingPayment,
    isPaused,
    pauseMessage,
    isReconnecting,

    // Setters (for external use)
    setMessage,
    setGamePhase,
    setAddress,

    // Actions
    connect,
    findMatch,
    cancelMatchmaking,
    submitSheepPositions,
    fireShot,
    verifyPayment,
    submitPayment,
    notifyFundsAdded,
    forfeit,
    leaveGame,
    reconnectGame,
    resetGame,
    goToLobby,
    clearPendingPayment,
    checkPendingReconnect,
    triggerReconnect,
  };
};