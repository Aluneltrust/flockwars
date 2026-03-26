// ============================================================================
// PLAYER LOBBY — Online players list with direct challenge support
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Swords, Trophy, Clock, Shield, X, Check,
  Loader2, Circle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { STAKE_TIERS } from '../constants';

export interface LobbyPlayer {
  address: string;
  username: string;
  status: 'idle' | 'matchmaking' | 'in_game';
  gamesWon: number;
  gamesPlayed: number;
}

export interface IncomingChallenge {
  challengeId: string;
  fromUsername: string;
  fromAddress: string;
  stakeTier: number;
  tierName: string;
  expiresAt: number;
}

interface PlayerLobbyProps {
  players: LobbyPlayer[];
  onlineCount: number;
  myAddress: string;
  onChallenge: (toAddress: string, stakeTier: number) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
  onCancelChallenge: (challengeId: string) => void;
  onRefresh: () => void;
  incomingChallenges: IncomingChallenge[];
  pendingChallengeId: string | null;
  pendingChallengeTo: string | null;
  selectedTier: number;        // tier already selected in parent lobby
  compact?: boolean;
}

export default function PlayerLobby({
  players,
  onlineCount,
  myAddress,
  onChallenge,
  onAcceptChallenge,
  onDeclineChallenge,
  onCancelChallenge,
  onRefresh,
  incomingChallenges,
  pendingChallengeId,
  pendingChallengeTo,
  selectedTier,
  compact = false,
}: PlayerLobbyProps) {
  const [expanded, setExpanded] = useState(!compact);

  // Countdown timer for incoming challenges
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Update countdowns for incoming challenges
    if (incomingChallenges.length === 0) {
      setCountdowns({});
      return;
    }

    const update = () => {
      const now = Date.now();
      const newCountdowns: Record<string, number> = {};
      for (const ch of incomingChallenges) {
        const remaining = Math.max(0, Math.ceil((ch.expiresAt - now) / 1000));
        newCountdowns[ch.challengeId] = remaining;
      }
      setCountdowns(newCountdowns);
    };

    update();
    timerRef.current = setInterval(update, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [incomingChallenges]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'idle': return <Circle size={10} className="status-idle" />;
      case 'matchmaking': return <Loader2 size={10} className="status-matchmaking spin" />;
      case 'in_game': return <Swords size={10} className="status-ingame" />;
      default: return <Circle size={10} />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'idle': return 'Available';
      case 'matchmaking': return 'Searching...';
      case 'in_game': return 'In Game';
      default: return status;
    }
  };

  const getWinRate = (player: LobbyPlayer): string => {
    if (player.gamesPlayed === 0) return 'New';
    const rate = Math.round((player.gamesWon / player.gamesPlayed) * 100);
    return `${rate}%`;
  };

  const handleChallengeClick = (address: string) => {
    onChallenge(address, selectedTier);
  };

  const otherPlayers = players.filter(p => p.address !== myAddress);

  return (
    <div className="player-lobby">
      {/* Incoming Challenges */}
      {incomingChallenges.length > 0 && (
        <div className="challenge-incoming-list">
          {incomingChallenges.map(ch => (
            <div key={ch.challengeId} className="challenge-incoming">
              <div className="challenge-incoming-header">
                <Swords size={16} className="icon-amber" />
                <span className="challenge-from">{ch.fromUsername}</span>
                <span className="challenge-tier">{ch.tierName}</span>
                <span className="challenge-countdown">
                  <Clock size={12} /> {countdowns[ch.challengeId] || 0}s
                </span>
              </div>
              <div className="challenge-incoming-actions">
                <button
                  className="btn btn-small btn-accept"
                  onClick={() => onAcceptChallenge(ch.challengeId)}
                >
                  <Check size={14} /> Accept
                </button>
                <button
                  className="btn btn-small btn-decline"
                  onClick={() => onDeclineChallenge(ch.challengeId)}
                >
                  <X size={14} /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending outgoing challenge */}
      {pendingChallengeId && pendingChallengeTo && (
        <div className="challenge-pending">
          <Loader2 size={14} className="spin" />
          <span>Waiting for {pendingChallengeTo}...</span>
          <button
            className="btn btn-small btn-text"
            onClick={() => onCancelChallenge(pendingChallengeId)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Header */}
      <div className="lobby-header" onClick={() => compact && setExpanded(!expanded)}>
        <div className="lobby-title">
          <Users size={16} />
          <span>Online Players</span>
          <span className="online-count">{onlineCount}</span>
        </div>
        {compact && (expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
      </div>

      {/* Player list */}
      {expanded && (
        <div className="lobby-list">
          {otherPlayers.length === 0 ? (
            <div className="lobby-empty">
              <Users size={24} className="icon-dim" />
              <span>No other players online</span>
              <button
                className="lobby-share-btn"
                onClick={() => {
                  navigator.clipboard.writeText('https://sheeponchain.com');
                  const btn = document.querySelector('.lobby-share-btn');
                  if (btn) {
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = 'sheeponchain.com — tap to copy invite link'; }, 2000);
                  }
                }}
              >
                sheeponchain.com — tap to copy invite link
              </button>
            </div>
          ) : (
            otherPlayers.map(player => (
              <div key={player.address} className="lobby-player">
                <div className="player-info">
                  <div className="player-name-row">
                    {getStatusIcon(player.status)}
                    <span className="player-name">{player.username}</span>
                  </div>
                  <div className="player-stats">
                    <span className="stat">
                      <Trophy size={12} /> {player.gamesWon}W
                    </span>
                    <span className="stat">
                      <Shield size={12} /> {getWinRate(player)}
                    </span>
                    <span className={`status-label status-${player.status}`}>
                      {getStatusLabel(player.status)}
                    </span>
                  </div>
                </div>

                <div className="player-actions">
                  {player.status === 'idle' && !pendingChallengeId && (
                    <button
                      className="btn btn-small btn-challenge"
                      onClick={() => handleChallengeClick(player.address)}
                      title={`Send ${selectedTier}¢ challenge`}
                    >
                      <Swords size={14} /> {selectedTier}¢ Go!
                    </button>
                  )}
                  {player.status !== 'idle' && (
                    <span className="busy-label">{getStatusLabel(player.status)}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}