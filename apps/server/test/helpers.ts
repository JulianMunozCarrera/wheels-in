import type { AddressInfo } from 'node:net';
import { replay, type BoardState } from '@wheels-in/core';
import { buildApp } from '../src/app';
import { makeBus } from '../src/bus';
import { makePool, migrate } from '../src/db';

export const pool = makePool();

// Start a server on a free port, with a fresh day on the board.
export async function startServer(freshDay = true) {
  await migrate(pool);
  const bus = makeBus();
  const app = await buildApp(pool, bus);
  if (freshDay) await app.board.write(() => ({ newDaySeed: 1, clock: { running: true, speed: 60 } }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      await app.close();
      await bus.close();
    },
  };
}

export async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

export async function boardState(url: string): Promise<BoardState> {
  const data = (await (await fetch(`${url}/api/board`)).json()) as any;
  return replay(data.events);
}

// Ask the database itself: do any two cases overlap? The answer must be zero.
export async function overlapsInDatabase(): Promise<number> {
  const res = await pool.query(`
    SELECT count(*)::int AS n FROM cases a JOIN cases b ON a.id < b.id
    WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
      AND int4range(a.start_min, a.end_min) && int4range(b.start_min, b.end_min)
      AND (a.room_id = b.room_id OR a.surgeon_id = b.surgeon_id)`);
  return res.rows[0].n;
}
