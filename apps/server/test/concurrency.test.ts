import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startTicker } from '../src/ticker';
import { boardState, overlapsInDatabase, pool, post, startServer } from './helpers';

// Two servers on one database. This is the setup that breaks naive code.
let a: Awaited<ReturnType<typeof startServer>>;
let b: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  a = await startServer();
  b = await startServer(false);
});
afterAll(async () => {
  await a.close();
  await b.close();
  await pool.end();
});

const count = <T>(list: T[], want: T) => list.filter((x) => x === want).length;

describe('many people at once', () => {
  it('lets exactly one of 100 people book the same slot', async () => {
    const booking = { roomId: 'or8', surgeonId: 's13', procedure: 'Race test', start: 19 * 60, duration: 60 };
    // Half the requests go to each server.
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => post(`${i % 2 ? a.url : b.url}/api/cases`, booking)),
    );
    const codes = results.map((r) => r.status);
    expect(count(codes, 201)).toBe(1);
    expect(count(codes, 409)).toBe(99);
    expect(await overlapsInDatabase()).toBe(0);
  });

  it('lets exactly one of 40 people move the same case', async () => {
    const state = await boardState(a.url);
    const c = Object.values(state.cases).filter((x) => x.roomId === 'or6').sort((x, y) => y.start - x.start)[0];
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        post(`${i % 2 ? a.url : b.url}/api/cases/${c.id}/move`, { roomId: 'or6', start: c.start + 10 + i, version: c.version }),
      ),
    );
    expect(count(results.map((r) => r.status), 200)).toBe(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'stale')).toBe(true);
  });

  it('is saved by the database even when the app is skipped', async () => {
    // Go around the app and write straight to the table, 30 times at once.
    // The EXCLUDE rule alone has to stop the double booking.
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        pool.query("INSERT INTO cases (id, room_id, surgeon_id, start_min, end_min) VALUES ($1, 'or5', $2, 1200, 1250)", [`raw${i}`, `raw-s${i}`]),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === '23P01')).toBe(true);
    await pool.query("DELETE FROM cases WHERE id LIKE 'raw%'");
  });

  it('survives a storm of random moves and emergencies', async () => {
    const state = await boardState(a.url);
    const cases = Object.values(state.cases);
    const jobs = Array.from({ length: 300 }, (_, i) => {
      const url = i % 2 ? a.url : b.url;
      if (i % 25 === 0) return post(`${url}/api/emergency`);
      const c = cases[(i * 7) % cases.length];
      const roomId = `or${(i % 8) + 1}`;
      return post(`${url}/api/cases/${c.id}/move`, { roomId, start: 450 + ((i * 35) % 600), version: c.version });
    });
    const codes = (await Promise.all(jobs)).map((r) => r.status);
    expect(codes.every((s) => s === 200 || s === 201 || s === 409)).toBe(true);
    expect(count(codes, 200)).toBeGreaterThan(0);
    expect(await overlapsInDatabase()).toBe(0);
  });
});

describe('live updates', () => {
  // Without Redis the two servers can not hear each other, so skip this one.
  it.skipIf(!process.env.REDIS_URL)('sends a change made on server A to a browser on server B', async () => {
    const socket = new WebSocket(b.wsUrl);
    const got = new Promise<any>((resolve) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.kind === 'events') resolve(msg);
      });
    });
    await new Promise((r) => socket.once('open', r));
    const sent = await post(`${a.url}/api/emergency`);
    const msg = await got;
    expect(msg.events[0].seq).toBe(sent.body.events[0].seq);
    socket.close();
  });

  it('lets server B act on a change it only heard about from server A', async () => {
    // Start from a clean day so the storm above does not get in the way.
    await a.app.board.write(() => ({ newDaySeed: 5 }));
    const before = await boardState(a.url);
    const c = Object.values(before.cases).filter((x) => x.roomId === 'or7').sort((x, y) => y.start - x.start)[0];
    const first = await post(`${a.url}/api/cases/${c.id}/move`, { roomId: 'or7', start: c.start + 15, version: c.version });
    expect(first.status).toBe(200);
    // B has not seen this write yet. It has to catch up before it decides.
    const old = await post(`${b.url}/api/cases/${c.id}/move`, { roomId: 'or7', start: c.start + 30, version: c.version });
    expect(old.body.code).toBe('stale');
    const fresh = await post(`${b.url}/api/cases/${c.id}/move`, { roomId: 'or7', start: c.start + 30, version: c.version + 1 });
    expect(fresh.status).toBe(200);
  });

  it('runs the clock from exactly one server', async () => {
    await a.app.board.write(() => ({ newDaySeed: 2, clock: { speed: 240 } }));
    const url = process.env.DATABASE_URL ?? 'postgres://wheels:wheels@localhost:5432/wheels';
    const stopA = startTicker(a.app.board, url, 50);
    const stopB = startTicker(b.app.board, url, 50);
    await new Promise((r) => setTimeout(r, 2000));
    await stopA();
    await stopB();
    const { clock } = await a.app.board.read();
    // 2 real seconds at 240x is about 8 board minutes. Two leaders would give 16.
    expect(clock.minute).toBeGreaterThan(424);
    expect(clock.minute).toBeLessThan(431);
  });
});
