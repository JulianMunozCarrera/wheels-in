import pg from 'pg';
import { applyEvent, dayIsOver, simStep, type BoardEvent, type EventBody } from '@wheels-in/core';
import type { Board } from './board';

// Only one server may run the clock. Whoever holds this lock is the leader.
const LEADER_LOCK = 4712;
// How long the finished board stays up before a new day starts, in board minutes.
const REST = 30;

// The ticker moves the board clock and plays the fake hospital day.
// If the leader dies, its lock is freed and another server takes over.
export function startTicker(board: Board, databaseUrl: string | undefined, everyMs = 250): () => Promise<void> {
  const db = new pg.Client({ connectionString: databaseUrl });
  let connected = false;
  let leader = false;
  let busy = false;
  let stopped = false;
  let last = Date.now();

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (!connected) {
        await db.connect();
        connected = true;
      }
      if (!leader) {
        leader = (await db.query('SELECT pg_try_advisory_lock($1) AS ok', [LEADER_LOCK])).rows[0].ok;
        last = Date.now();
        if (!leader) return;
      }

      // Real seconds since the last tick. Capped, so a frozen laptop does not skip hours.
      const now = Date.now();
      const seconds = Math.min(2, (now - last) / 1000);
      last = now;

      await board.write((state, clock) => {
        if (!clock.running) return {};

        // Everyone went home. Wait a bit, then start a fresh day.
        if (dayIsOver(state)) {
          const lastOut = Math.max(...Object.values(state.cases).map((c) => c.times.wheels_out ?? 0));
          if (clock.minute > lastOut + REST) return { newDaySeed: clock.seed + 1 };
        }

        const to = clock.minute + (seconds * clock.speed) / 60;
        const events: (EventBody & { at: number })[] = [];
        let s = state;
        // Play each whole minute we crossed.
        for (let m = Math.floor(clock.minute) + 1; m <= Math.floor(to); m++) {
          for (const body of simStep(s, m)) {
            events.push({ ...body, at: m });
            s = applyEvent(s, { ...body, seq: 0, at: m } as BoardEvent);
          }
        }
        return { events, clock: { minute: to } };
      });
    } catch (err) {
      console.error('ticker error', err);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(tick, everyMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 10));
    if (connected) await db.end().catch(() => {});
  };
}
