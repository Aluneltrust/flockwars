// ============================================================================
// LOBBY MANAGER — Online player tracking + direct challenges
// ============================================================================

export type PlayerStatus = 'idle' | 'matchmaking' | 'in_game';

export interface LobbyPlayer {
  socketId: string;
  address: string;
  username: string;
  status: PlayerStatus;
  joinedAt: number;
  gamesWon?: number;
  gamesPlayed?: number;
}

export interface Challenge {
  id: string;
  fromSocketId: string;
  fromAddress: string;
  fromUsername: string;
  toSocketId: string;
  toAddress: string;
  toUsername: string;
  stakeTier: number;
  createdAt: number;
  expiresAt: number;
}

const CHALLENGE_TIMEOUT_MS = 30_000; // 30s to accept

export class LobbyManager {
  private players = new Map<string, LobbyPlayer>();   // socketId → player
  private addressToSocket = new Map<string, string>(); // address → socketId
  private challenges = new Map<string, Challenge>();   // challengeId → challenge
  private challengeTimers = new Map<string, NodeJS.Timeout>();

  // Callbacks for socket layer
  onChallengeExpired: ((challenge: Challenge) => void) | null = null;

  // ==========================================================================
  // JOIN / LEAVE
  // ==========================================================================

  join(socketId: string, address: string, username: string, stats?: { gamesWon?: number; gamesPlayed?: number }): void {
    // Remove any existing entry for this address (stale socket)
    const existing = this.addressToSocket.get(address);
    if (existing && existing !== socketId) {
      this.leave(existing);
    }

    this.players.set(socketId, {
      socketId,
      address,
      username,
      status: 'idle',
      joinedAt: Date.now(),
      gamesWon: stats?.gamesWon || 0,
      gamesPlayed: stats?.gamesPlayed || 0,
    });
    this.addressToSocket.set(address, socketId);
  }

  leave(socketId: string): void {
    const player = this.players.get(socketId);
    if (player) {
      this.addressToSocket.delete(player.address);
    }
    this.players.delete(socketId);

    // Cancel any challenges involving this player
    for (const [id, challenge] of this.challenges) {
      if (challenge.fromSocketId === socketId || challenge.toSocketId === socketId) {
        this.cancelChallenge(id);
      }
    }
  }

  // ==========================================================================
  // STATUS UPDATES
  // ==========================================================================

  setStatus(socketId: string, status: PlayerStatus): void {
    const player = this.players.get(socketId);
    if (player) {
      player.status = status;
    }
  }

  setStatusByAddress(address: string, status: PlayerStatus): void {
    const socketId = this.addressToSocket.get(address);
    if (socketId) {
      this.setStatus(socketId, status);
    }
  }

  // ==========================================================================
  // PLAYER LIST
  // ==========================================================================

  getOnlinePlayers(): { address: string; username: string; status: PlayerStatus; gamesWon: number; gamesPlayed: number }[] {
    const result: { address: string; username: string; status: PlayerStatus; gamesWon: number; gamesPlayed: number }[] = [];
    for (const player of this.players.values()) {
      result.push({
        address: player.address,
        username: player.username,
        status: player.status,
        gamesWon: player.gamesWon || 0,
        gamesPlayed: player.gamesPlayed || 0,
      });
    }
    // Sort: idle first, then by games won
    result.sort((a, b) => {
      if (a.status === 'idle' && b.status !== 'idle') return -1;
      if (a.status !== 'idle' && b.status === 'idle') return 1;
      return (b.gamesWon || 0) - (a.gamesWon || 0);
    });
    return result;
  }

  getPlayer(socketId: string): LobbyPlayer | undefined {
    return this.players.get(socketId);
  }

  getPlayerByAddress(address: string): LobbyPlayer | undefined {
    const socketId = this.addressToSocket.get(address);
    return socketId ? this.players.get(socketId) : undefined;
  }

  getOnlineCount(): number {
    return this.players.size;
  }

  isOnline(address: string): boolean {
    return this.addressToSocket.has(address);
  }

  // ==========================================================================
  // CHALLENGES
  // ==========================================================================

  createChallenge(
    fromSocketId: string,
    toAddress: string,
    stakeTier: number,
  ): { success: boolean; challenge?: Challenge; error?: string } {
    const from = this.players.get(fromSocketId);
    if (!from) return { success: false, error: 'You are not in the lobby' };
    if (from.status !== 'idle') return { success: false, error: 'You are not available' };

    const toSocketId = this.addressToSocket.get(toAddress);
    if (!toSocketId) return { success: false, error: 'Player is not online' };

    const to = this.players.get(toSocketId);
    if (!to) return { success: false, error: 'Player is not online' };
    if (to.status !== 'idle') return { success: false, error: `${to.username} is busy` };

    if (from.address === toAddress) return { success: false, error: 'Cannot challenge yourself' };

    // Check for existing challenge between these players
    for (const challenge of this.challenges.values()) {
      if (
        (challenge.fromSocketId === fromSocketId && challenge.toAddress === toAddress) ||
        (challenge.fromAddress === from.address && challenge.toSocketId === toSocketId)
      ) {
        return { success: false, error: 'Challenge already pending' };
      }
    }

    const id = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const challenge: Challenge = {
      id,
      fromSocketId,
      fromAddress: from.address,
      fromUsername: from.username,
      toSocketId,
      toAddress: to.address,
      toUsername: to.username,
      stakeTier,
      createdAt: Date.now(),
      expiresAt: Date.now() + CHALLENGE_TIMEOUT_MS,
    };

    this.challenges.set(id, challenge);

    // Auto-expire
    const timer = setTimeout(() => {
      const ch = this.challenges.get(id);
      if (ch) {
        this.challenges.delete(id);
        this.challengeTimers.delete(id);
        this.onChallengeExpired?.(ch);
      }
    }, CHALLENGE_TIMEOUT_MS);
    this.challengeTimers.set(id, timer);

    return { success: true, challenge };
  }

  acceptChallenge(challengeId: string, socketId: string): { success: boolean; challenge?: Challenge; error?: string } {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return { success: false, error: 'Challenge not found or expired' };
    if (challenge.toSocketId !== socketId) return { success: false, error: 'Not your challenge' };

    // Verify both players still available
    const from = this.players.get(challenge.fromSocketId);
    const to = this.players.get(challenge.toSocketId);
    if (!from || from.status !== 'idle') return { success: false, error: 'Challenger is no longer available' };
    if (!to || to.status !== 'idle') return { success: false, error: 'You are no longer available' };

    // Clean up
    this.cancelChallenge(challengeId);

    return { success: true, challenge };
  }

  declineChallenge(challengeId: string, socketId: string): { success: boolean; challenge?: Challenge; error?: string } {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return { success: false, error: 'Challenge not found' };
    if (challenge.toSocketId !== socketId) return { success: false, error: 'Not your challenge' };

    this.cancelChallenge(challengeId);
    return { success: true, challenge };
  }

  cancelChallenge(challengeId: string): void {
    this.challenges.delete(challengeId);
    const timer = this.challengeTimers.get(challengeId);
    if (timer) {
      clearTimeout(timer);
      this.challengeTimers.delete(challengeId);
    }
  }

  // Cancel all challenges from a specific socket
  cancelChallengesFrom(socketId: string): void {
    for (const [id, ch] of this.challenges) {
      if (ch.fromSocketId === socketId) {
        this.cancelChallenge(id);
      }
    }
  }

  getPendingChallengesFor(socketId: string): Challenge[] {
    const result: Challenge[] = [];
    for (const ch of this.challenges.values()) {
      if (ch.toSocketId === socketId) result.push(ch);
    }
    return result;
  }
}

export const lobbyManager = new LobbyManager();