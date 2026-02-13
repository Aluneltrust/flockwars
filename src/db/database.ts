// ============================================================================
// DATABASE — PostgreSQL (Railway)
// ============================================================================

import { Pool } from 'pg';

let pool: Pool;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return pool;
}

export async function initDatabase(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS players (
      address       TEXT PRIMARY KEY,
      username      TEXT NOT NULL DEFAULT 'Anonymous',
      games_played  INTEGER NOT NULL DEFAULT 0,
      games_won     INTEGER NOT NULL DEFAULT 0,
      games_lost    INTEGER NOT NULL DEFAULT 0,
      total_earned  BIGINT NOT NULL DEFAULT 0,
      total_spent   BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id              TEXT PRIMARY KEY,
      tier            INTEGER NOT NULL,
      player1_address TEXT NOT NULL,
      player2_address TEXT NOT NULL,
      winner_address  TEXT,
      end_reason      TEXT,
      pot             BIGINT NOT NULL DEFAULT 0,
      winner_payout   BIGINT NOT NULL DEFAULT 0,
      platform_cut    BIGINT NOT NULL DEFAULT 0,
      settle_txid     TEXT,
      p1_hits         INTEGER DEFAULT 0,
      p1_misses       INTEGER DEFAULT 0,
      p1_sheep_left   INTEGER DEFAULT 0,
      p2_hits         INTEGER DEFAULT 0,
      p2_misses       INTEGER DEFAULT 0,
      p2_sheep_left   INTEGER DEFAULT 0,
      started_at      TIMESTAMPTZ,
      ended_at        TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_games_p1 ON games(player1_address);
    CREATE INDEX IF NOT EXISTS idx_games_p2 ON games(player2_address);
    CREATE INDEX IF NOT EXISTS idx_games_winner ON games(winner_address);
  `);
  console.log('✅ Database initialized');
}

// ============================================================================
// PLAYERS
// ============================================================================

export async function ensurePlayer(address: string, username: string): Promise<void> {
  await getPool().query(
    `INSERT INTO players (address, username) VALUES ($1, $2)
     ON CONFLICT (address) DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()`,
    [address, username]
  );
}

// ============================================================================
// GAMES
// ============================================================================

export async function recordGameStart(
  gameId: string, tier: number, p1Addr: string, p2Addr: string
): Promise<void> {
  await getPool().query(
    `INSERT INTO games (id, tier, player1_address, player2_address, started_at) VALUES ($1,$2,$3,$4,NOW())`,
    [gameId, tier, p1Addr, p2Addr]
  );
}

export async function recordGameEnd(
  gameId: string, winnerAddr: string, reason: string,
  pot: number, winnerPayout: number, platformCut: number,
  settleTxid: string,
  p1: { hits: number; misses: number; sheepLeft: number },
  p2: { hits: number; misses: number; sheepLeft: number },
): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE games SET winner_address=$2, end_reason=$3, pot=$4, winner_payout=$5,
       platform_cut=$6, settle_txid=$7, p1_hits=$8, p1_misses=$9, p1_sheep_left=$10,
       p2_hits=$11, p2_misses=$12, p2_sheep_left=$13, ended_at=NOW() WHERE id=$1`,
      [gameId, winnerAddr, reason, pot, winnerPayout, platformCut, settleTxid,
       p1.hits, p1.misses, p1.sheepLeft, p2.hits, p2.misses, p2.sheepLeft]
    );

    // Get game to find loser
    const g = (await client.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
    if (g) {
      const loserAddr = winnerAddr === g.player1_address ? g.player2_address : g.player1_address;
      await client.query(
        `UPDATE players SET games_played=games_played+1, games_won=games_won+1,
         total_earned=total_earned+$2, updated_at=NOW() WHERE address=$1`,
        [winnerAddr, winnerPayout]
      );
      await client.query(
        `UPDATE players SET games_played=games_played+1, games_lost=games_lost+1,
         updated_at=NOW() WHERE address=$1`,
        [loserAddr]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// LEADERBOARD
// ============================================================================

export async function getLeaderboard(limit = 20) {
  const result = await getPool().query(
    `SELECT address, username, games_won, games_played, total_earned,
     CASE WHEN games_played>0 THEN ROUND(games_won::numeric/games_played*100,1) ELSE 0 END as win_rate
     FROM players WHERE games_played>=1
     ORDER BY games_won DESC, win_rate DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getPlayerStats(address: string) {
  const result = await getPool().query(
    `SELECT p.*, (SELECT json_agg(row_to_json(g) ORDER BY g.ended_at DESC)
     FROM (SELECT id,tier,winner_address,pot,winner_payout,end_reason,ended_at
           FROM games WHERE (player1_address=$1 OR player2_address=$1) AND ended_at IS NOT NULL
           ORDER BY ended_at DESC LIMIT 10) g) as recent_games
     FROM players p WHERE p.address=$1`,
    [address]
  );
  return result.rows[0] || null;
}
