import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Open a pool of database connections.
export function makePool(url = process.env.DATABASE_URL ?? 'postgres://wheels:wheels@localhost:5432/wheels'): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10 });
}

// Create the tables if they are not there yet. Safe to run every boot.
export async function migrate(pool: pg.Pool): Promise<void> {
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const db = await pool.connect();
  try {
    // Two servers may boot at once. The lock makes them take turns.
    await db.query('SELECT pg_advisory_lock(4710)');
    await db.query(sql);
  } finally {
    await db.query('SELECT pg_advisory_unlock(4710)').catch(() => {});
    db.release();
  }
}
