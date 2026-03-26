// ============================================================================
// USE LOBBY STATE — Online players, direct challenges, socket listeners
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';

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

export function useLobbyState(
  socketRef: React.MutableRefObject<Socket | null>,
  isConnected: boolean,
  setMessage: (msg: string) => void,
  onPlayClick?: () => void,
) {
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyOnlineCount, setLobbyOnlineCount] = useState(0);
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingChallenge[]>([]);
  const [pendingChallengeId, setPendingChallengeId] = useState<string | null>(null);
  const [pendingChallengeTo, setPendingChallengeTo] = useState<string | null>(null);

  // Store credentials so we can auto re-emit join_lobby on reconnect
  const lobbyCredentialsRef = useRef<{ address: string; username: string } | null>(null);

  // Socket event listeners
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !isConnected) return;

    const handleLobbyUpdate = (data: { players: LobbyPlayer[]; onlineCount: number }) => {
      console.log('📋 lobby_update received:', data.onlineCount, 'players', data.players.map(p => p.username));
      setLobbyPlayers(data.players);
      setLobbyOnlineCount(data.onlineCount);
    };

    const handleChallengeSent = (data: { challengeId: string; toUsername: string }) => {
      setPendingChallengeId(data.challengeId);
      setPendingChallengeTo(data.toUsername);
      setMessage(`Challenge sent to ${data.toUsername}!`);
    };

    const handleChallengeReceived = (data: IncomingChallenge) => {
      setIncomingChallenges(prev => [...prev, data]);
      onPlayClick?.();
    };

    const handleChallengeDeclined = (data: { challengeId: string; message: string }) => {
      setPendingChallengeId(null);
      setPendingChallengeTo(null);
      setMessage(data.message);
    };

    const handleChallengeExpired = (data: { challengeId: string }) => {
      setPendingChallengeId(prev => prev === data.challengeId ? null : prev);
      setPendingChallengeTo(prev => {
        // Clear if this was our outgoing challenge
        if (pendingChallengeId === data.challengeId) return null;
        return prev;
      });
      setIncomingChallenges(prev => prev.filter(c => c.challengeId !== data.challengeId));
    };

    const handleChallengeDeclinedAck = (data: { challengeId: string }) => {
      setIncomingChallenges(prev => prev.filter(c => c.challengeId !== data.challengeId));
    };

    const handleChallengeError = (data: { error: string }) => {
      setPendingChallengeId(null);
      setPendingChallengeTo(null);
      setMessage(data.error);
    };

    socket.on('lobby_update', handleLobbyUpdate);
    socket.on('challenge_sent', handleChallengeSent);
    socket.on('challenge_received', handleChallengeReceived);
    socket.on('challenge_declined', handleChallengeDeclined);
    socket.on('challenge_expired', handleChallengeExpired);
    socket.on('challenge_cancelled_ack', handleChallengeExpired);
    socket.on('challenge_declined_ack', handleChallengeDeclinedAck);
    socket.on('challenge_error', handleChallengeError);

    // Request current lobby state now that listeners are registered
    socket.emit('get_lobby');

    // FIX: Auto re-join lobby on socket connect/reconnect.
    // In production builds, the parent's joinLobby() call may fire before
    // the socket is connected, so the emit gets lost. This ensures
    // join_lobby is always emitted when the socket is ready.
    const handleConnect = () => {
      const creds = lobbyCredentialsRef.current;
      if (creds) {
        console.log('📋 Socket (re)connected — auto re-joining lobby:', creds.username);
        socket.emit('join_lobby', creds);
        socket.emit('get_lobby');
      }
    };

    // If already connected and we have credentials, join now
    if (socket.connected && lobbyCredentialsRef.current) {
      handleConnect();
    }

    socket.on('connect', handleConnect);

    return () => {
      socket.off('lobby_update', handleLobbyUpdate);
      socket.off('challenge_sent', handleChallengeSent);
      socket.off('challenge_received', handleChallengeReceived);
      socket.off('challenge_declined', handleChallengeDeclined);
      socket.off('challenge_expired', handleChallengeExpired);
      socket.off('challenge_cancelled_ack', handleChallengeExpired);
      socket.off('challenge_declined_ack', handleChallengeDeclinedAck);
      socket.off('challenge_error', handleChallengeError);
      socket.off('connect', handleConnect);
    };
  }, [socketRef, isConnected, setMessage, onPlayClick, pendingChallengeId]);

  // Actions
  const joinLobby = useCallback((address: string, username: string) => {
    // Store credentials for auto-rejoin on reconnect
    lobbyCredentialsRef.current = { address, username };
    console.log('📋 Emitting join_lobby:', { address: address?.slice(0, 8), username, socketConnected: socketRef.current?.connected });
    socketRef.current?.emit('join_lobby', { address, username });
    socketRef.current?.emit('get_lobby');
  }, [socketRef]);

  const getLobby = useCallback(() => {
    socketRef.current?.emit('get_lobby');
  }, [socketRef]);

  const challengePlayer = useCallback((toAddress: string, stakeTier: number) => {
    socketRef.current?.emit('challenge_player', { toAddress, stakeTier });
  }, [socketRef]);

  const acceptChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('accept_challenge', { challengeId });
    setIncomingChallenges(prev => prev.filter(c => c.challengeId !== challengeId));
  }, [socketRef]);

  const declineChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('decline_challenge', { challengeId });
    setIncomingChallenges(prev => prev.filter(c => c.challengeId !== challengeId));
  }, [socketRef]);

  const cancelChallenge = useCallback((challengeId: string) => {
    socketRef.current?.emit('cancel_challenge', { challengeId });
    setPendingChallengeId(null);
    setPendingChallengeTo(null);
  }, [socketRef]);

  const clearChallenges = useCallback(() => {
    setPendingChallengeId(null);
    setPendingChallengeTo(null);
    setIncomingChallenges([]);
  }, []);

  return {
    lobbyPlayers,
    lobbyOnlineCount,
    incomingChallenges,
    pendingChallengeId,
    pendingChallengeTo,

    joinLobby,
    getLobby,
    challengePlayer,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
    clearChallenges,
  };
}