import type pg from 'pg';
import {
  applyEvent, emptyState, seedDay, DAY_START, RuleError,
  type BoardEvent, type BoardState, type EventBody,
} from '@wheels-in/core';
import type { Bus } from './bus';

export interface Clock {
  epoch: number;
  seed: number;
  minute: number;
  speed: number;
  running: boolean;
}

// What a write wants to do. All of it is optional.
export interface Plan<T> {
  // Events to save. "at" is the board minute. It defaults to the clock.
  events?: (EventBody & { at?: number })[];
  // Changes to the clock, like a new speed.
  clock?: Partial<Clock>;
  // Throw the day away and start a new one from this seed.
  newDaySeed?: number;
  result?: T;
}

// Only one writer may hold this lock at a time, across every server.
const WRITE_LOCK = 4711;

export class Board {
  // A copy of the board kept in memory so we do not rebuild it on every write.
  private state: BoardState = emptyState();
  private lastSeq = 0;
  private epoch = -1;

  constructor(private pool: pg.Pool, private bus: Bus) {}

  // Read the whole day straight from the database.
  async read(): Promise<{ clock: Clock; events: BoardEvent[] }> {
    const db = await this.pool.connect();
    try {
      // One snapshot, so the clock and the events agree with each other.
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const clock = toClock((await db.query('SELECT * FROM board WHERE id = 1')).rows[0]);
      const rows = (await db.query('SELECT seq, at, body FROM events ORDER BY seq')).rows;
      await db.query('COMMIT');
      return { clock, events: rows.map(toEvent) };
    } finally {
      db.release();
    }
  }

  // Every change to the board goes through here. The steps:
  //   1. Take the lock, so writers go one at a time.
  //   2. Catch up on anything another server wrote since we last looked.
  //   3. Ask "decide" what should happen. It may throw a RuleError to say no.
  //   4. Save the events and update the cases table.
  //   5. Commit. The database checks its no double booking rules here.
  //   6. Tell every server, so they can tell every browser.
  async write<T>(decide: (state: BoardState, clock: Clock) => Plan<T>): Promise<{ result: T | undefined; events: BoardEvent[]; clock: Clock }> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);

      const clock = toClock((await db.query('SELECT * FROM board WHERE id = 1')).rows[0]);
      let state = this.state;
      let seq = this.lastSeq;
      // A new day started somewhere else. Our copy is useless. Start over.
      if (clock.epoch !== this.epoch) {
        state = emptyState();
        seq = 0;
      }
      const missed = await db.query('SELECT seq, at, body FROM events WHERE seq > $1 ORDER BY seq', [seq]);
      for (const row of missed.rows) {
        const ev = toEvent(row);
        state = applyEvent(state, ev);
        seq = ev.seq;
      }

      const plan = decide(state, clock);
      const next: Clock = { ...clock, ...plan.clock };
      let bodies = plan.events ?? [];

      if (plan.newDaySeed !== undefined) {
        await db.query('TRUNCATE events, cases');
        state = emptyState();
        seq = 0;
        next.epoch = clock.epoch + 1;
        next.seed = plan.newDaySeed;
        next.minute = DAY_START;
        bodies = [seedDay(plan.newDaySeed)];
      }

      const saved: BoardEvent[] = [];
      for (const { at, ...body } of bodies) {
        const ev = { ...body, seq: ++seq, at: at ?? Math.floor(next.minute) } as BoardEvent;
        await db.query('INSERT INTO events (seq, at, body) VALUES ($1, $2, $3)', [ev.seq, ev.at, JSON.stringify(body)]);
        await project(db, state, ev);
        state = applyEvent(state, ev);
        saved.push(ev);
      }

      await db.query('UPDATE board SET epoch = $1, seed = $2, minute = $3, speed = $4, running = $5 WHERE id = 1', [
        next.epoch, next.seed, next.minute, next.speed, next.running,
      ]);
      await db.query('COMMIT');

      // Only now, after the commit worked, do we trust the new state.
      this.state = state;
      this.lastSeq = seq;
      this.epoch = next.epoch;

      if (saved.length > 0) this.bus.publish({ kind: 'events', epoch: next.epoch, events: saved, sentAt: Date.now() });
      this.bus.publish({ kind: 'clock', clock: next });
      return { result: plan.result, events: saved, clock: next };
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      // 23P01 is the database saying "that would be a double booking".
      if ((err as { code?: string }).code === '23P01') {
        throw new RuleError('conflict', 'That slot was just taken');
      }
      throw err;
    } finally {
      db.release();
    }
  }
}

// Keep the cases table in step with one event.
async function project(db: pg.PoolClient, before: BoardState, ev: BoardEvent): Promise<void> {
  const insert = (c: { id: string; roomId: string; surgeonId: string; start: number; end: number; status: string; version: number }) =>
    db.query(
      'INSERT INTO cases (id, room_id, surgeon_id, start_min, end_min, status, version) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [c.id, c.roomId, c.surgeonId, c.start, c.end, c.status, c.version],
    );

  switch (ev.type) {
    case 'day_seeded':
      for (const c of ev.cases) await insert(c);
      return;
    case 'case_booked':
      await insert(ev.case);
      return;
    case 'case_moved': {
      // Only update if the version is the one we expect. If not, someone got there first.
      const res = await db.query(
        'UPDATE cases SET room_id = $2, start_min = $3, end_min = $4, version = version + 1 WHERE id = $1 AND version = $5',
        [ev.id, ev.roomId, ev.start, ev.end, before.cases[ev.id]?.version],
      );
      if (res.rowCount !== 1) throw new RuleError('stale', 'Someone else just changed this case. Try again.');
      return;
    }
    case 'case_status':
      await db.query('UPDATE cases SET status = $2, version = version + 1 WHERE id = $1', [ev.id, ev.status]);
      return;
    case 'case_cancelled':
      await db.query("UPDATE cases SET status = 'cancelled', version = version + 1 WHERE id = $1", [ev.id]);
      return;
  }
}

const toClock = (row: Record<string, unknown>): Clock => ({
  epoch: Number(row.epoch),
  seed: Number(row.seed),
  minute: Number(row.minute),
  speed: Number(row.speed),
  running: Boolean(row.running),
});

const toEvent = (row: { seq: string; at: number; body: EventBody }): BoardEvent =>
  ({ ...row.body, seq: Number(row.seq), at: Number(row.at) }) as BoardEvent;
