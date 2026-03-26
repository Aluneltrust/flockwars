// ============================================================================
// GAME SCREENS — PIN, Connect, Lobby, Matchmaking, Paused, GameOver, Modals
// ============================================================================

import React from 'react';
import {
  Wallet, Trophy, Crosshair, Clock,
  Swords, Wind, Flame, Lock, Hexagon,
  Skull, Target, Coins, Landmark,
  Check, Pause, RefreshCw, Eye,
} from 'lucide-react';
import { GameLogo, AlertIcon, InfoIcon } from './GameIcons';
import { MAX_SHEEP, STAKE_TIERS, BACKEND_URL } from '../constants';
import PlayerLobby from './PlayerLobby';
import IntroPage from './IntroPage';
import type { LobbyPlayer, IncomingChallenge } from '../hooks/useLobbyState';

// Re-export IntroPage for convenience
export { default as IntroPage } from './IntroPage';

// ============================================================================
// PIN UNLOCK SCREEN
// ============================================================================

interface PinUnlockProps {
  addressHint: string | null;
  pinInput: string;
  setPinInput: (v: string) => void;
  pinError: string;
  onUnlock: (pin: string) => void;
  onDelete: () => void;
}

export function PinUnlockScreen({ addressHint, pinInput, setPinInput, pinError, onUnlock, onDelete }: PinUnlockProps) {
  return (
    <div className="connect-screen">
      <div className="connect-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="game-logo"><GameLogo size={56} className="icon-amber" /></div>
        <h1 className="game-title">FLOCK WARS</h1>
        <p className="game-subtitle">Enter PIN to unlock your wallet</p>

        {addressHint && (
          <div className="address-hint">
            {addressHint.slice(0, 8)}...{addressHint.slice(-6)}
          </div>
        )}

        <div className="pin-input-group">
          <div className="pin-field">
            <span className="pin-label">Enter PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="• • • •"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pinInput.length === 4) onUnlock(pinInput);
              }}
              autoFocus
              className="pin-input"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => onUnlock(pinInput)}
            disabled={pinInput.length !== 4}
          >
            Unlock
          </button>
        </div>

        {pinError && <div className="pin-error">{pinError}</div>}

        <div className="pin-footer">
          <button
            className="btn btn-small btn-text"
            onClick={() => {
              if (confirm('This will delete your encrypted wallet. Make sure you have your WIF backed up!')) {
                onDelete();
              }
            }}
          >
            Forgot PIN? Reset wallet
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PIN SETUP SCREEN
// ============================================================================

interface PinSetupProps {
  addressHint: string | null;
  pinInput: string;
  setPinInput: (v: string) => void;
  pinConfirm: string;
  setPinConfirm: (v: string) => void;
  pinError: string;
  isProcessing: boolean;
  onSubmit: (pin: string) => void;
  onMigrate: (pin: string) => void;
}

export function PinSetupScreen({ addressHint, pinInput, setPinInput, pinConfirm, setPinConfirm, pinError, isProcessing, onSubmit, onMigrate }: PinSetupProps) {
  const handleConfirm = () => {
    if (pinInput !== pinConfirm) return;
    if (addressHint) {
      onMigrate(pinInput);
    } else {
      onSubmit(pinInput);
    }
  };

  return (
    <div className="connect-screen">
      <div className="connect-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="game-logo"><GameLogo size={56} className="icon-amber" /></div>
        <h1 className="game-title">FLOCK WARS</h1>
        <p className="game-subtitle">
          {addressHint ? 'Set a PIN to protect your wallet' : 'Create a PIN for your new wallet'}
        </p>

        {addressHint && (
          <div className="address-hint">
            {addressHint.slice(0, 8)}...{addressHint.slice(-6)}
          </div>
        )}

        <div className="pin-input-group">
          <div className="pin-field">
            <span className="pin-label">Choose PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="• • • •"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              autoFocus
              className="pin-input"
            />
          </div>
          <div className="pin-field">
            <span className="pin-label">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="• • • •"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pinInput.length === 4 && pinConfirm.length === 4) handleConfirm();
              }}
              className="pin-input"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={pinInput.length !== 4 || pinConfirm.length !== 4 || pinInput !== pinConfirm || isProcessing}
          >
            {isProcessing ? 'Encrypting...' : 'Set PIN'}
          </button>
        </div>

        {pinError && <div className="pin-error">{pinError}</div>}

        <p className="pin-hint">
          <AlertIcon size={14} className="icon-inline icon-amber" /> Remember this PIN! You'll need it every time you open the game.
        </p>

        <div style={{
          marginTop: '0.75rem',
          padding: '0.6rem 0.8rem',
          background: 'rgba(74, 222, 128, 0.08)',
          border: '1px solid rgba(74, 222, 128, 0.2)',
          borderRadius: '8px',
          fontSize: '0.75rem',
          color: 'rgba(255, 255, 255, 0.7)',
          lineHeight: '1.4',
        }}>
          <strong style={{ color: 'rgba(74, 222, 128, 0.9)' }}>You own this wallet.</strong> Your private key is generated in your browser, encrypted with your PIN, and never leaves your device. We cannot access or recover it. Back up your WIF key from the wallet page after setup.
        </div>
        
      </div>
    </div>
  );
}

// ============================================================================
// CONNECT SCREEN — No wallet exists
// ============================================================================

interface ConnectScreenProps {
  isProcessing: boolean;
  onCreateWallet: () => void;
  onImportWif: (wif: string) => void;
}

export function ConnectScreen({ isProcessing, onCreateWallet, onImportWif }: ConnectScreenProps) {
  return (
    <div className="connect-screen">
      <div className="connect-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="game-logo"><GameLogo size={56} className="icon-amber" /></div>
        <h1 className="game-title">FLOCK WARS</h1>
        <p className="game-subtitle">On-Chain Multiplayer Edition</p>

        <div className="rules-preview">
          <div className="rule-item">
            <span className="rule-icon"><Hexagon size={18} /></span>
            <span>Place {MAX_SHEEP} sheep, battle opponents!</span>
          </div>
          <div className="rule-item">
            <span className="rule-icon"><Coins size={18} /></span>
            <span>Real BSV payments on-chain</span>
          </div>
          <div className="rule-item">
            <span className="rule-icon"><Trophy size={18} /></span>
            <span>Win 80% of the pot!</span>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={onCreateWallet}
          disabled={isProcessing}
        >
          {isProcessing ? 'Creating...' : '🐑 Create Wallet & Play'}
        </button>

        <div className="import-section">
          <p className="import-label">Have a WIF key?</p>
          <input
            type="text"
            className="import-input"
            placeholder="Paste WIF private key"
            onPaste={(e) => {
              const text = e.clipboardData.getData('text').trim();
              if (text) onImportWif(text);
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LOBBY SCREEN
// ============================================================================

interface LobbyScreenProps {
  walletAddress: string;
  balance: number;
  username: string;
  selectedTier: number;
  onRefreshBalance: () => void;
  onSaveUsername: (name: string) => void;
  onSelectTier: (tier: number) => void;
  onFindMatch: () => void;
  onShowWallet: () => void;
  onShowLeaderboard: () => void;
  lobbyPlayers: LobbyPlayer[];
  lobbyOnlineCount: number;
  myAddress: string;
  onChallenge: (address: string, tier: number) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
  onCancelChallenge: (challengeId: string) => void;
  onRefreshLobby: () => void;
  incomingChallenges: IncomingChallenge[];
  pendingChallengeId: string | null;
  pendingChallengeTo: string | null;
  renderStakeTierSelector: () => React.ReactNode;
}

export function LobbyScreen(props: LobbyScreenProps) {
  const {
    walletAddress, balance, username, selectedTier,
    onRefreshBalance, onSaveUsername, onSelectTier, onFindMatch,
    onShowWallet, onShowLeaderboard,
    lobbyPlayers, lobbyOnlineCount, myAddress,
    onChallenge, onAcceptChallenge, onDeclineChallenge, onCancelChallenge,
    onRefreshLobby, incomingChallenges, pendingChallengeId, pendingChallengeTo,
    renderStakeTierSelector,
  } = props;

  return (
    <div className="lobby-screen">
      <div className="lobby-card">
        <div className="game-logo"><GameLogo size={48} className="icon-amber" /></div>
        <h1 className="game-title">FLOCK WARS</h1>

        <div className="lobby-username">
          <input
            className="username-input"
            value={username}
            onChange={(e) => onSaveUsername(e.target.value)}
            placeholder="Enter username"
            maxLength={16}
          />
        </div>

        <div className="lobby-balance" onClick={onRefreshBalance}>
          <Wallet size={16} /> {balance.toLocaleString()} sats
          <RefreshCw size={12} className="refresh-icon" />
        </div>

        {renderStakeTierSelector()}

        <PlayerLobby
          players={lobbyPlayers}
          onlineCount={lobbyOnlineCount}
          myAddress={myAddress}
          selectedTier={selectedTier}
          onChallenge={onChallenge}
          onAcceptChallenge={onAcceptChallenge}
          onDeclineChallenge={onDeclineChallenge}
          onCancelChallenge={onCancelChallenge}
          onRefresh={onRefreshLobby}
          incomingChallenges={incomingChallenges}
          pendingChallengeId={pendingChallengeId}
          pendingChallengeTo={pendingChallengeTo}
        />

        <button className="btn btn-primary" onClick={onFindMatch}>
          <Swords size={16} /> Find Random Match
        </button>

        <div className="lobby-actions">
          <button className="btn btn-secondary" onClick={onShowWallet}>
            <Wallet size={16} /> Wallet
          </button>
          <button className="btn btn-secondary" onClick={onShowLeaderboard}>
            <Trophy size={16} /> Leaderboard
          </button>
        </div>

        {balance < 250 && (
          <div className="balance-warning">
            <AlertIcon size={14} className="icon-inline icon-red" /> Need funds to play. Server checks your balance before matching.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MATCHMAKING SCREEN
// ============================================================================

interface MatchmakingScreenProps {
  selectedTier: number;
  onCancel: () => void;
}

export function MatchmakingScreen({ selectedTier, onCancel }: MatchmakingScreenProps) {
  return (
    <div className="matchmaking-screen">
      <div className="matchmaking-card">
        <div className="spinner">🔍</div>
        <h2>Finding Opponent...</h2>
        <p>Stake: {selectedTier}¢</p>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// PAUSED MODAL
// ============================================================================

interface PausedModalProps {
  pauseMessage: string;
  fundsCountdown: number;
  walletAddress: string;
  onFundsAdded: () => void;
  onForfeit: () => void;
}

export function PausedModal({ pauseMessage, fundsCountdown, walletAddress, onFundsAdded, onForfeit }: PausedModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-emoji"><Pause size={48} className="icon-amber" /></div>
        <h2>Game Paused</h2>
        <p>{pauseMessage}</p>
        {fundsCountdown > 0 && (
          <div className="countdown">
            <Clock size={14} /> {fundsCountdown}s remaining
          </div>
        )}
        <div className="wallet-address-full" onClick={() => navigator.clipboard.writeText(walletAddress)}>
          {walletAddress}
        </div>
        <p className="fund-instructions">Send BSV to your wallet address above, then click below.</p>
        <button className="btn btn-primary" onClick={onFundsAdded}>
          <Check size={14} /> I've Added Funds
        </button>
        <button className="btn btn-secondary" onClick={onForfeit}>
          Forfeit
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// GAME OVER MODAL
// ============================================================================

interface GameOverModalProps {
  winner: 'player' | 'opponent' | null;
  message: string;
  gamePot: number;
  myMisses: number;
  opponentMisses: number;
  missSats: number;
  opponentName: string;
  balance: number;
  onPlayAgain: () => void;
}

export function GameOverModal(props: GameOverModalProps) {
  const { winner, message, gamePot, myMisses, opponentMisses, missSats, opponentName, balance, onPlayAgain } = props;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-emoji">
          {winner === 'player' ? <Trophy size={56} className="icon-gold" /> : <Skull size={56} className="icon-red" />}
        </div>
        <h2 className="modal-title">{winner === 'player' ? 'VICTORY!' : 'DEFEAT!'}</h2>
        <p>{message}</p>

        <div className="pot-breakdown">
          <div className="pot-title"><Coins size={16} /> Game Pot: {gamePot.toLocaleString()} sats</div>
          <div className="pot-details">
            <div>Your misses: {myMisses} × {missSats || '?'} sats</div>
            <div>Opponent misses: {opponentMisses} × {missSats || '?'} sats</div>
          </div>
          <div className="pot-split">
            {winner === 'player' ? (
              <>
                <div className="winner-reward"><Trophy size={14} /> You get: {Math.floor(gamePot * 0.8).toLocaleString()} sats (80%)</div>
                <div className="platform-cut"><Landmark size={14} /> Platform keeps: {Math.ceil(gamePot * 0.2).toLocaleString()} sats (20%)</div>
              </>
            ) : (
              <>
                <div className="loser-result">You get: 0 sats</div>
                <div className="winner-info"><Trophy size={14} /> {opponentName} gets: {Math.floor(gamePot * 0.8).toLocaleString()} sats</div>
                <div className="platform-cut"><Landmark size={14} /> Platform keeps: {Math.ceil(gamePot * 0.2).toLocaleString()} sats</div>
              </>
            )}
          </div>
        </div>

        <div className="final-balance">Balance: {balance.toLocaleString()} sats</div>

        <div className="settlement-notice">
          <Clock size={14} className="icon-inline" />
          <span>Funds are being settled on-chain. Your balance may take a few minutes to update while transactions confirm.</span>
        </div>

        <button className="btn btn-primary" onClick={onPlayAgain}><RefreshCw size={14} /> Play Again</button>
      </div>
    </div>
  );
}

// ============================================================================
// RULES MODAL
// ============================================================================

interface RulesModalProps {
  onClose: () => void;
}

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card rules-modal" onClick={e => e.stopPropagation()}>
        <h2><Hexagon size={20} /> Flock Wars Rules</h2>
        <h3>Objective</h3>
        <p>Eliminate all enemy sheep before they eliminate yours!</p>
        <h3>On-Chain Payments</h3>
        <ul>
          <li><Wind size={14} className="icon-inline" /> Miss: Your wallet pays the escrow pot</li>
          <li><Flame size={14} className="icon-inline" /> Hit: Defender's wallet pays the shooter directly</li>
          <li><Trophy size={14} className="icon-inline" /> Winner: Gets 80% of the escrow pot</li>
          <li><Landmark size={14} className="icon-inline" /> Platform: Gets remaining 20%</li>
          <li><Pause size={14} className="icon-inline" /> Low funds: 60 seconds to add funds or forfeit</li>
        </ul>
        <h3>4 Wallets</h3>
        <ul>
          <li><Wallet size={14} className="icon-inline" /> Player A — your wallet (client-side)</li>
          <li><Wallet size={14} className="icon-inline" /> Player B — opponent's wallet (client-side)</li>
          <li><Lock size={14} className="icon-inline" /> Escrow — server collects miss fees, settles at game end</li>
          <li><Landmark size={14} className="icon-inline" /> Final Wallet — platform revenue</li>
        </ul>
        <button className="btn btn-primary" onClick={onClose}>Got it!</button>
      </div>
    </div>
  );
}

// ============================================================================
// LEADERBOARD MODAL
// ============================================================================

interface LeaderboardModalProps {
  leaderboard: any[];
  onClose: () => void;
}

export function LeaderboardModal({ leaderboard, onClose }: LeaderboardModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card leaderboard-modal" onClick={e => e.stopPropagation()}>
        <h2><Trophy size={20} /> Leaderboard</h2>
        <div className="leaderboard-list">
          {leaderboard.length === 0 ? (
            <div className="no-data">No games played yet!</div>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={i} className="leaderboard-entry">
                <span className="rank">#{i + 1}</span>
                <span className="name">{entry.username}</span>
                <span className="wins">{entry.games_won}W</span>
              </div>
            ))
          )}
        </div>
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}