// ============================================================================
// HERDSWACKER - On-Chain Multiplayer Edition
// Main Game Orchestrator
// ============================================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { PrivateKey } from '@bsv/sdk';
import {
  Wallet, Trophy, Crosshair, Clock,
  Swords, Wind, Flame, Lock, Coins,
  ShieldCheck, BookOpen, RefreshCw,
  Eraser, Shuffle, Check, Eye, ArrowRight,
  CircleDollarSign, Sparkles,
} from 'lucide-react';

import BattleBackground from './BattleBackground';


// Constants
import {
  MAX_SHEEP,
  CELL_EMPTY,
  CELL_SHEEP,
  CELL_HIT,
  CELL_MISS,
  STAKE_TIERS,
  createEmptyArena,
  BSV_NETWORK,
  HERD_SHAPES,
  BACKEND_URL,
} from '../constants';

// Services
import { bsvPriceService, bsvWalletService, fetchBalance, isEmbedded, bridgeGetAddress, bridgeGetBalance, bridgeGetUsername, bridgeSignTransaction } from '../services';

// Hooks
import { useMultiplayer, MultiplayerCallbacks, PaymentRequest } from '../hooks';
import { useGameSounds, soundManager } from '../hooks/useSounds';
import { useGameState } from '../hooks/useGameState';
import { useLobbyState } from '../hooks/useLobbyState';

// Components
import WalletPage from './WalletPage';
import { SackPinUnlock } from './SackPinUnlock';
import {
  PinUnlockScreen,
  PinSetupScreen,
  ConnectScreen,
  LobbyScreen,
  MatchmakingScreen,
  PausedModal,
  GameOverModal,
  RulesModal,
  LeaderboardModal,
  IntroPage,
} from './GameScreens';

import ThreeArena from './ThreeArena';

// PIN encryption
import {
  encryptAndStoreWif,
  decryptStoredWif,
  hasStoredWallet,
  hasLegacyWallet,
  getLegacyWif,
  removeLegacyWallet,
  getAddressHint,
  deleteStoredWallet,
} from '../utils/pinCrypto';

// Styles
import '../styles/index.css';
import '../styles/IntroPage.css';

export default function HerdswackerGame() {
  // ============================================================================
  // SOUND HOOK
  // ============================================================================
  const {
    isMuted,
    initSound,
    playMiss,
    playHit,
    playEnemyHit,
    playEnemyMiss,
    playWhoosh,
    playClick,
    playSheepPlace,
    playStartGame,
    playVictory,
    playDefeat,
    playMenuMusic,
    playBattleMusic,
    stopMusic,
    playLowHealth,
    playLobbyMusic,
    toggleMute,
  } = useGameSounds();

  // ============================================================================
  // WALLET STATE
  // ============================================================================
  const [privateKey, setPrivateKey] = useState<PrivateKey | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [username, setUsername] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [embeddedMode] = useState(() => isEmbedded());

  // ============================================================================
  // UI STATE
  // ============================================================================
  const [selectedTier, setSelectedTier] = useState(1);
  const [bsvPrice, setBsvPrice] = useState(50);
  const [showWallet, setShowWallet] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<any[]>([]);
  const [screenShake, setScreenShake] = useState(false);

  // Pause/funds
  const [fundsCountdown, setFundsCountdown] = useState(0);
  const fundsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PIN state
  const [needsPin, setNeedsPin] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [addressHint, setAddressHint] = useState<string | null>(null);
  const pendingImportWif = useRef<string | null>(null);


  const [musicVolume, setMusicVolume] = useState(0.15);
  
  // ============================================================================
  // MULTIPLAYER CALLBACKS
  // ============================================================================
  const multiplayerCallbacks: MultiplayerCallbacks = {
    onMatchFound: (data) => {
      gameState.resetBoards();
      lobby.clearChallenges();

      if (!embeddedMode && privateKey) {
        bsvWalletService.connect(privateKey.toWif()).catch(console.error);
      }
      playMenuMusic();
    },

    onOpponentReady: () => {},
    onGameStart: () => {},

    onReconnected: (gs: any) => {
      gameState.restoreFromReconnect(gs);
      if (!embeddedMode && privateKey) {
        bsvWalletService.connect(privateKey.toWif()).catch(console.error);
      }
      playBattleMusic();
    },

    onShotResult: ({ position, result, amountSats, pot, opponentSheepRemaining }) => {
      const key = `${position.row}-${position.col}`;
      if (result === 'hit') {
        gameState.setOpponentArena(prev => ({ ...prev, [key]: CELL_HIT }));
        gameState.setPlayerShots(prev => ({ ...prev, [key]: CELL_HIT }));
        playHit();
      } else {
        gameState.setPlayerShots(prev => ({ ...prev, [key]: CELL_MISS }));
        playMiss();
      }
    },

    onOpponentShot: ({ position, result, pot, sheepRemaining }) => {
      const key = `${position.row}-${position.col}`;
      if (result === 'hit') {
        gameState.setOpponentShots(prev => ({ ...prev, [key]: CELL_HIT }));
        playEnemyHit();
      } else {
        gameState.setOpponentShots(prev => ({ ...prev, [key]: CELL_MISS }));
        playEnemyMiss();
      }
    },

    onPaymentRequired: async (payment: PaymentRequest) => {
      setIsProcessing(true);
      try {
        let result: { success: boolean; rawTxHex?: string; error?: string };

        if (embeddedMode) {
          const label = payment.type === 'miss' ? 'MISS_FEE' : 'HIT_REWARD';
          result = await bridgeSignTransaction(
            payment.toAddress, payment.amount,
            JSON.stringify({ app: 'FLOCKWARS', action: label, game: multiplayer.gameId.substring(0, 8) }),
          );
        } else {
          if (!bsvWalletService.isConnected() && privateKey) {
            await bsvWalletService.connect(privateKey.toWif());
          }
          result = await bsvWalletService.sendGamePayment(
            payment.toAddress,
            payment.amount,
            multiplayer.gameId,
            payment.type,
          );
        }

        if (result.success && result.rawTxHex) {
          multiplayer.submitPayment(result.rawTxHex);
          const label = payment.type === 'miss' ? `Miss fee → Escrow` : `Hit reward → Shooter`;
          gameState.addTransaction(-payment.amount, `${label} (${payment.amount} sats)`, 'pending');
        } else {
          multiplayer.clearPendingPayment();
          multiplayer.setMessage(`Payment failed: ${result.error}`);
        }
      } catch (error: any) {
        multiplayer.clearPendingPayment();
        multiplayer.setMessage(`Payment error: ${error.message}`);
      }
      setIsProcessing(false);
      refreshBalance();
    },

    onPaymentConfirmed: (data) => {
      gameState.setTransactions(prev => prev.map(tx =>
        tx.txid === 'pending' ? { ...tx, txid: data.txid } : tx
      ));
      refreshBalance();
    },

    onFundsNeeded: (data) => {
      setFundsCountdown(Math.ceil(data.timeoutMs / 1000));
      if (fundsTimerRef.current) clearInterval(fundsTimerRef.current);
      fundsTimerRef.current = setInterval(() => {
        setFundsCountdown(prev => {
          if (prev <= 1) {
            if (fundsTimerRef.current) clearInterval(fundsTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },

    onTurnChange: () => {},

    onGameOver: ({ winner: winnerRole, pot, winnerPayout, settleTxid, message }) => {
      if (fundsTimerRef.current) clearInterval(fundsTimerRef.current);
      setFundsCountdown(0);
      stopMusic();

      const playerWon = winnerRole === multiplayer.myRoleRef.current;
      if (playerWon && winnerPayout > 0) {
        gameState.addTransaction(winnerPayout, `Winner reward! (${winnerPayout} sats)`, settleTxid);
        playVictory();
      } else if (playerWon) {
        playVictory();
      } else {
        gameState.addTransaction(0, `Defeat`);
        playDefeat();
      }
      refreshBalance();
    },

    onOpponentDisconnected: () => {},
    onError: () => setIsProcessing(false),
  };

  const multiplayer = useMultiplayer(multiplayerCallbacks);

  // ============================================================================
  // GAME STATE HOOK
  // ============================================================================
  const gameState = useGameState(multiplayer.gamePhase, multiplayer.setMessage);

  // ============================================================================
  // LOBBY STATE HOOK
  // ============================================================================
  const lobby = useLobbyState(
    multiplayer.socketRef,
    multiplayer.isConnected,
    multiplayer.setMessage,
    playClick,
  );

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  useEffect(() => {
    loadWallet();
    loadUsername();
    bsvPriceService.updatePrice().then(price => setBsvPrice(price));

    const priceInterval = setInterval(async () => {
      const price = await bsvPriceService.updatePrice();
      setBsvPrice(price);
    }, 60000);

    return () => {
      clearInterval(priceInterval);
      if (fundsTimerRef.current) clearInterval(fundsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (multiplayer.gamePhase === 'lobby') {
      if (!multiplayer.isConnected) {
        multiplayer.connect();
      }
      // Join lobby once socket is connected and we have credentials
      if (multiplayer.isConnected && walletAddress && username) {
        multiplayer.setAddress(walletAddress);
        lobby.joinLobby(walletAddress, username);
      }
      const timer = setTimeout(() => playLobbyMusic(), 2000);
      return () => clearTimeout(timer);
    }
  }, [multiplayer.gamePhase, multiplayer.isConnected, walletAddress, username]);

  // Periodic lobby refresh as fallback (every 5s while in lobby)
  useEffect(() => {
    if (multiplayer.gamePhase !== 'lobby' || !multiplayer.isConnected) return;
    const interval = setInterval(() => {
      lobby.getLobby();
    }, 5000);
    return () => clearInterval(interval);
  }, [multiplayer.gamePhase, multiplayer.isConnected]);

  // ============================================================================
  // WALLET FUNCTIONS
  // ============================================================================
  const loadWallet = async () => {
    // When embedded in AlunelGames, get wallet from parent via postMessage
    if (embeddedMode) {
      try {
        const address = await bridgeGetAddress();
        setWalletAddress(address);
        // Set a dummy key so game screens proceed
        setPrivateKey(PrivateKey.fromRandom());
        const [bal, parentName] = await Promise.all([
          bridgeGetBalance().catch(() => 0),
          bridgeGetUsername().catch(() => ''),
        ]);
        setBalance(bal);
        const savedName = parentName || localStorage.getItem('herdswacker_username') || 'Player';
        setUsername(savedName);
        multiplayer.goToLobby();
        initSound();
      } catch (e) {
        console.error('Bridge wallet init failed:', e);
        setShowIntro(true);
      }
      return;
    }

    if (hasLegacyWallet() && !hasStoredWallet()) {
      setNeedsPinSetup(true);
      const wif = getLegacyWif();
      if (wif) {
        try {
          const pk = PrivateKey.fromWif(wif);
          const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
          setAddressHint(address);
        } catch { /* ignore */ }
      }
      return;
    }

    if (hasStoredWallet()) {
      setNeedsPin(true);
      setAddressHint(getAddressHint());
      return;
    }

    // No wallet at all — show intro landing page for first-time users
    setShowIntro(true);
  };

  const unlockWithPin = async (pin: string) => {
    setPinError('');
    try {
      const wif = await decryptStoredWif(pin);
      const pk = PrivateKey.fromWif(wif);
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      setPrivateKey(pk);
      setWalletAddress(address);
      setNeedsPin(false);
      setPinInput('');
      await refreshBalance(address);
      multiplayer.goToLobby();
      initSound();
    } catch (e: any) {
      setPinError(e.message === 'Wrong PIN' ? 'Wrong PIN. Try again.' : e.message);
      setPinInput('');
    }
  };

  const migrateWithPin = async (pin: string) => {
    setPinError('');
    if (pin !== pinConfirm) {
      setPinError('PINs do not match');
      return;
    }
    try {
      const wif = pendingImportWif.current || getLegacyWif();
      if (!wif) throw new Error('No wallet found to encrypt');

      const pk = PrivateKey.fromWif(wif);
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');

      await encryptAndStoreWif(wif, pin, address);
      removeLegacyWallet();
      pendingImportWif.current = null;

      setPrivateKey(pk);
      setWalletAddress(address);
      setNeedsPinSetup(false);
      setPinInput('');
      setPinConfirm('');
      await refreshBalance(address);
      multiplayer.goToLobby();
      initSound();
    } catch (e: any) {
      setPinError(e.message);
    }
  };

  const loadUsername = () => {
    const saved = localStorage.getItem('herdswacker_username');
    if (saved) setUsername(saved);
  };

  const refreshBalance = async (address?: string) => {
    if (embeddedMode) {
      try { setBalance(await bridgeGetBalance()); } catch { /* ignore */ }
      return;
    }
    const addr = address || walletAddress;
    if (!addr) return;
    const bal = await fetchBalance(addr);
    setBalance(bal);
  };

  const connectWallet = async (pin: string) => {
    setIsProcessing(true);
    setPinError('');
    try {
      const pk = PrivateKey.fromRandom();
      const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      await encryptAndStoreWif(pk.toWif(), pin, address);
      setPrivateKey(pk);
      setWalletAddress(address);
      setNeedsPinSetup(false);
      setPinInput('');
      setPinConfirm('');
      await refreshBalance(address);
      multiplayer.goToLobby();
      initSound();
    } catch (error: any) {
      setPinError(error.message);
      multiplayer.setMessage('Failed: ' + error.message);
    }
    setIsProcessing(false);
  };

  const saveUsername = (name: string) => {
    setUsername(name);
    localStorage.setItem('herdswacker_username', name);
  };

  // ============================================================================
  // GAME ACTIONS
  // ============================================================================
  const handleOpponentCellClick = async (row: number, col: number, event: React.MouseEvent) => {
    if (multiplayer.gamePhase !== 'playing' || multiplayer.currentTurn !== 'player' || isProcessing) return;
    if (multiplayer.pendingPayment) {
      multiplayer.setMessage('Complete pending payment first!');
      return;
    }

    const key = `${row}-${col}`;
    if (gameState.playerShots[key]) {
      multiplayer.setMessage('Already shot there!');
      return;
    }

    multiplayer.fireShot({ row, col });
    playWhoosh();
  };

  const confirmReady = () => {
    const positions = Object.entries(gameState.playerArena)
      .filter(([_, v]) => v === CELL_SHEEP)
      .map(([key]) => {
        const [row, col] = key.split('-').map(Number);
        return { row, col };
      });

    multiplayer.submitSheepPositions(positions);
    multiplayer.setMessage('Waiting for opponent...');
    playStartGame();
    stopMusic();
    playBattleMusic();
  };

  const handleResetGame = () => {
    multiplayer.resetGame();
    gameState.resetBoards();
    lobby.clearChallenges();
    setFundsCountdown(0);
    if (fundsTimerRef.current) clearInterval(fundsTimerRef.current);
    stopMusic();
  };

  const handleFundsAdded = async () => {
    await refreshBalance();
    multiplayer.notifyFundsAdded();
    multiplayer.setMessage('Checking balance...');
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leaderboard`);
      const data = await response.json();
      setLeaderboard(data);
    } catch (err) {
      console.warn('Leaderboard fetch failed');
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  const currentTierDef = STAKE_TIERS.find(t => t.tier === selectedTier);

  const renderArena = (isPlayerArena: boolean) => {
    const isPlaying = multiplayer.gamePhase === 'playing';
    const isMyTurn = multiplayer.currentTurn === 'player';

    let overlayText = '';
    let overlaySubtext = '';
    let showOverlay = false;

    if (isPlaying) {
      if (isPlayerArena && !isMyTurn) {
        showOverlay = true;
        overlayText = `${multiplayer.opponentName} is aiming...`;
        overlaySubtext = 'Defend your herd!';
      } else if (isPlayerArena && isMyTurn && isProcessing) {
        showOverlay = true;
        overlayText = 'Processing transaction...';
        overlaySubtext = 'Verifying on-chain';
      } else if (!isPlayerArena && !isMyTurn && !isProcessing) {
        showOverlay = true;
        overlayText = `${multiplayer.opponentName}'s Turn`;
        overlaySubtext = 'Waiting for opponent...';
      } else if (!isPlayerArena && isProcessing) {
        showOverlay = true;
        overlayText = 'Transaction pending...';
        overlaySubtext = 'Settling on BSV blockchain';
      }
    }

    const handleCellClick = isPlayerArena
      ? (row: number, col: number) => {
          if (multiplayer.gamePhase === 'setup') {
            const key = `${row}-${col}`;
            const cell = gameState.playerArena[key] ?? CELL_EMPTY;
            if (gameState.validCells.has(key) || cell === CELL_SHEEP) {
              playSheepPlace();
            }
          }
          gameState.handlePlayerCellClick(row, col);
        }
      : (row: number, col: number, event?: MouseEvent) => {
          handleOpponentCellClick(row, col, event as any);
        };

    return (
      <ThreeArena
        isPlayerArena={isPlayerArena}
        arenaData={isPlayerArena ? gameState.playerArena : gameState.opponentArena}
        shots={isPlayerArena ? gameState.opponentShots : gameState.playerShots}
        validCells={gameState.validCells}
        gamePhase={multiplayer.gamePhase}
        currentHerdCells={gameState.currentHerdCells || []}
        onCellClick={handleCellClick}
        overlayText={overlayText}
        overlaySubtext={overlaySubtext}
        showOverlay={showOverlay}
        opponentName={multiplayer.opponentName}
      />
    );
  };

  const renderStakeTierSelector = () => (
    <div className="tier-selector">
      <div className="tier-label">Select Stakes:</div>
      <div className="tier-grid">
        {STAKE_TIERS.map(tier => (
          <button
            key={tier.tier}
            className={`tier-btn ${selectedTier === tier.tier ? 'selected' : ''}`}
            onClick={() => setSelectedTier(tier.tier)}
          >
            <span className="tier-name">{tier.name}</span>
            <span className="tier-amount">{tier.tier}¢</span>
          </button>
        ))}
      </div>
      {currentTierDef && (
        <div className="fee-notice">
          <span><Wind size={14} className="icon-inline" /> Miss: {currentTierDef.missCents}¢ → Escrow Pot</span>
          <span><Flame size={14} className="icon-inline" /> Hit: {currentTierDef.hitCents}¢ from defender</span>
          <span><Trophy size={14} className="icon-inline" /> Winner: 80% pot</span>
        </div>
      )}
    </div>
  );

  // ============================================================================
  // RENDER - WALLET PAGE
  // ============================================================================
  if (showWallet) {
    return (
      <WalletPage
        onBack={() => { setShowWallet(false); refreshBalance(); }}
        walletPrivateKey={privateKey}
        walletAddress={walletAddress}
      />
    );
  }

  // ============================================================================
  // RENDER - MAIN GAME
  // ============================================================================
  return (
    <div className={`game-container ${isProcessing ? 'processing' : ''} ${screenShake ? 'screen-shake' : ''} ${multiplayer.currentTurn !== 'player' ? 'opponent-turn' : ''} ${(multiplayer.gamePhase === 'connect' || multiplayer.gamePhase === 'lobby' || multiplayer.gamePhase === 'setup' || multiplayer.gamePhase === 'playing' || multiplayer.gamePhase === 'gameover') ? 'has-bg-image' : ''}`}>




      {floatingTexts.map(({ id, text, type, x, y }) => (
        <div key={id} className={`floating-text ${type}`} style={{ left: x, top: y }}>{text}</div>
      ))}

      <div className={`sound-controls ${isMuted ? 'muted' : ''}`}>
        <button className={`sound-mute-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
          {isMuted ? '🔇' : '🔊'}
        </button>
        <input
          type="range"
          className="sound-volume-slider"
          min="0"
          max="0.4"
          step="0.01"
          value={musicVolume}
          onChange={(e) => {
            const vol = parseFloat(e.target.value);
            setMusicVolume(vol);
            soundManager.setMusicVolume(vol);
          }}
        />
      </div>

      {/* PIN Unlock */}
      {needsPin && (
        <SackPinUnlock
          addressHint={addressHint}
          pinInput={pinInput}
          setPinInput={(v) => { setPinInput(v); setPinError(''); }}
          pinError={pinError}
          onUnlock={unlockWithPin}
          onDelete={() => { deleteStoredWallet(); setNeedsPin(false); setAddressHint(null); }}
        />
      )}

      {/* PIN Setup */}
      {needsPinSetup && (
        <PinSetupScreen
          addressHint={addressHint}
          pinInput={pinInput}
          setPinInput={(v) => { setPinInput(v); setPinError(''); }}
          pinConfirm={pinConfirm}
          setPinConfirm={(v) => { setPinConfirm(v); setPinError(''); }}
          pinError={pinError}
          isProcessing={isProcessing}
          onSubmit={connectWallet}
          onMigrate={migrateWithPin}
        />
      )}

      {/* Intro Landing Page — first-time visitors */}
      {showIntro && !needsPin && !needsPinSetup && multiplayer.gamePhase === 'connect' && (
        <IntroPage onGetStarted={() => {
          setShowIntro(false);
          setNeedsPinSetup(true);
        }} />
      )}

      {/* Intro video - PIN/Connect/Intro screens */}
      {(multiplayer.gamePhase === 'connect' || showIntro || needsPin || needsPinSetup) && (
        <video
          className="intro-bg-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          ref={(el) => { if (el) el.playbackRate = 1; }}
        >
          <source src="/videos/intro-bg.mp4" type="video/mp4" />
        </video>
      )}

      {/* Lobby video */}
      {multiplayer.gamePhase === 'lobby' && (
        <video
          className="intro-bg-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          ref={(el) => {
            if (el) {
              el.playbackRate = 1;
              el.muted = false;
              el.volume = 0.1;
            }
          }}
        >
          <source src="/videos/lobby-bg.mp4" type="video/mp4" />
        </video>
      )}

      {/* Lobby */}
      {multiplayer.gamePhase === 'lobby' && (
        <LobbyScreen
          walletAddress={walletAddress}
          balance={balance}
          username={username}
          selectedTier={selectedTier}
          onRefreshBalance={() => refreshBalance()}
          onSaveUsername={saveUsername}
          onSelectTier={setSelectedTier}
          onFindMatch={() => multiplayer.findMatch(walletAddress, username, selectedTier)}
          onShowWallet={() => setShowWallet(true)}
          onShowLeaderboard={() => { fetchLeaderboard(); setShowLeaderboard(true); }}
          lobbyPlayers={lobby.lobbyPlayers}
          lobbyOnlineCount={lobby.lobbyOnlineCount}
          myAddress={walletAddress}
          onChallenge={lobby.challengePlayer}
          onAcceptChallenge={lobby.acceptChallenge}
          onDeclineChallenge={lobby.declineChallenge}
          onCancelChallenge={lobby.cancelChallenge}
          onRefreshLobby={lobby.getLobby}
          incomingChallenges={lobby.incomingChallenges}
          pendingChallengeId={lobby.pendingChallengeId}
          pendingChallengeTo={lobby.pendingChallengeTo}
          renderStakeTierSelector={renderStakeTierSelector}
        />
      )}

      {/* Matchmaking */}
      {multiplayer.gamePhase === 'matchmaking' && (
        <MatchmakingScreen selectedTier={selectedTier} onCancel={multiplayer.cancelMatchmaking} />
      )}

      {/* Paused */}
      {multiplayer.gamePhase === 'paused' && (
        <PausedModal
          pauseMessage={multiplayer.pauseMessage}
          fundsCountdown={fundsCountdown}
          walletAddress={walletAddress}
          onFundsAdded={handleFundsAdded}
          onForfeit={() => multiplayer.forfeit()}
        />
      )}

      {/* Setup & Playing */}
      {(multiplayer.gamePhase === 'setup' || multiplayer.gamePhase === 'playing' || multiplayer.gamePhase === 'gameover') && (
        <>
          <BattleBackground mood={multiplayer.currentTurn === 'player' ? 'player' : multiplayer.gamePhase === 'playing' ? 'opponent' : 'idle'} />
          
          <div className="game-layout" style={{ position: 'relative', zIndex: 1 }}>
            <div className="wallet-bar">
              <div></div>
              <div className="wallet-info-center">
                <div className="wallet-address">{username} • {walletAddress.slice(0, 8)}...</div>
                <div className="balance">{balance.toLocaleString()} sats</div>
              </div>
              <div className="wallet-actions">
                {multiplayer.gamePhase === 'playing' && (
                  <div className={`turn-indicator ${multiplayer.currentTurn === 'player' ? 'your-turn' : 'opponent-turn'}`}>
                    {multiplayer.currentTurn === 'player'
                      ? (isProcessing ? <><Clock size={14} /> Processing...</> : <><Crosshair size={14} /> Your Turn</>)
                      : <><Clock size={14} /> {multiplayer.opponentName}'s Turn</>}
                  </div>
                )}
                <button className="btn btn-small" onClick={() => setShowWallet(true)}><Wallet size={16} /></button>
                <button className="btn btn-secondary" onClick={() => setShowRules(true)}><BookOpen size={16} /> Rules</button>
              </div>
            </div>

            <div className="message-bar">{multiplayer.message}</div>

            <div className="game-area">
              {renderArena(true)}
              {multiplayer.gamePhase !== 'setup' && renderArena(false)}

              <div className="side-panel">
                {multiplayer.gamePhase === 'setup' && (
                  <div className="panel-section">
                    <h4><ShieldCheck size={18} /> Place Your Herds</h4>
                    <div className="placement-info">
                      <div className="sheep-count">{gameState.sheepPlaced}/{MAX_SHEEP}</div>
                      <div className="herd-progress">
                        {HERD_SHAPES.map((herd, index) => {
                          const cellsPlaced = gameState.placedHerds[index]
                            ? herd.size
                            : (index === gameState.currentHerdIndex ? gameState.currentHerdCells.length : 0);

                          return (
                            <div
                              key={herd.name}
                              className={`herd-item ${gameState.placedHerds[index] ? 'placed' : ''} ${
                                index === gameState.currentHerdIndex && !gameState.placedHerds[index] ? 'current' : ''
                              }`}
                            >
                              <span className="herd-icon">{herd.icon}</span>
                              <span className="herd-name">{herd.name}</span>
                              <span className="herd-size">({cellsPlaced}/{herd.size})</span>
                              {gameState.placedHerds[index] && <span className="herd-check"><Check size={14} /></span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="controls">
                      <button className="btn btn-secondary" onClick={gameState.clearSheep}><Eraser size={14} /> Clear</button>
                      <button className="btn btn-secondary" onClick={gameState.autoPlaceSheep}><Shuffle size={14} /> Auto-Place</button>
                      <button
                        className="btn btn-primary"
                        onClick={confirmReady}
                        disabled={gameState.sheepPlaced < MAX_SHEEP}
                      >
                        {multiplayer.opponentReady ? <><Sparkles size={14} /> Start!</> : <><Check size={14} /> Ready</>}
                      </button>
                    </div>
                    {multiplayer.opponentReady && (
                      <div className="opponent-ready"><Check size={14} /> {multiplayer.opponentName} is ready!</div>
                    )}
                  </div>
                )}

                <div className="panel-section">
                  <h4><CircleDollarSign size={18} /> Game Economics</h4>
                  <div className="economics">
                    {multiplayer.missSats > 0 ? (
                      <>
                        <div><Wind size={14} className="icon-inline" /> Miss: <span className="cost">-{multiplayer.missSats} sats <ArrowRight size={12} /> Escrow</span></div>
                        <div><Flame size={14} className="icon-inline" /> Hit: <span className="cost">-{multiplayer.hitSats} sats from defender</span></div>
                      </>
                    ) : (
                      <>
                        <div><Wind size={14} className="icon-inline" /> Miss: <span className="cost">{currentTierDef?.missCents}¢ <ArrowRight size={12} /> Escrow</span></div>
                        <div><Flame size={14} className="icon-inline" /> Hit: <span className="cost">{currentTierDef?.hitCents}¢ from defender</span></div>
                      </>
                    )}
                    <div><Trophy size={14} className="icon-inline" /> Win: <span className="reward">80% of pot</span></div>
                  </div>
                  {multiplayer.gamePot > 0 && (
                    <div className="current-pot">
                      <Coins size={16} /> Current Pot: {multiplayer.gamePot.toLocaleString()} sats
                    </div>
                  )}
                  {multiplayer.escrowAddress && (
                    <div className="escrow-address" onClick={() => navigator.clipboard.writeText(multiplayer.escrowAddress)} title="Click to copy">
                      <span><Lock size={12} /> Escrow: {multiplayer.escrowAddress.slice(0, 8)}...{multiplayer.escrowAddress.slice(-6)}</span>
                      {' '}
                      <a href={'https://whatsonchain.com/address/' + multiplayer.escrowAddress} target="_blank" rel="noopener noreferrer"><Eye size={14} /></a>
                    </div>
                  )}
                </div>

                {gameState.transactions.length > 0 && (
                  <div className="panel-section">
                    <h4><RefreshCw size={16} /> Transactions</h4>
                    <div className="transactions">
                      {gameState.transactions.map((tx, i) => (
                        <div key={i} className="tx-item">
                          <span className={tx.amount >= 0 ? 'reward' : 'cost'}>
                            {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
                          </span>
                          <span className="tx-desc">{tx.description}</span>
                          {tx.txid && tx.txid !== 'dust_skip' && (
                            <a className="tx-link" href={`https://whatsonchain.com/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer">↗</a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Game Over */}
      {multiplayer.gamePhase === 'gameover' && (
        <GameOverModal
          winner={multiplayer.winner}
          message={multiplayer.message}
          gamePot={multiplayer.gamePot}
          myMisses={multiplayer.myMisses}
          opponentMisses={multiplayer.opponentMisses}
          missSats={multiplayer.missSats}
          opponentName={multiplayer.opponentName}
          balance={balance}
          onPlayAgain={handleResetGame}
        />
      )}

      {/* Modals */}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showLeaderboard && <LeaderboardModal leaderboard={leaderboard} onClose={() => setShowLeaderboard(false)} />}
    </div>
  );
}