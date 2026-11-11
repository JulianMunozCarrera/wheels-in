import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardState, pool, post, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server.close();
});

describe('the api', () => {
  it('serves a full seeded day', async () => {
    const state = await boardState(server.url);
    expect(state.rooms).toHaveLength(8);
    expect(Object.keys(state.cases).length).toBeGreaterThan(25);
  });

  it('moves a case and bumps its version', async () => {
    const state = await boardState(server.url);
    const last = Object.values(state.cases).filter((c) => c.roomId === 'or8').sort((a, b) => b.start - a.start)[0];
    const res = await post(`${server.url}/api/cases/${last.id}/move`, { roomId: 'or8', start: last.start + 30, version: last.version });
    expect(res.status).toBe(200);
    const after = await boardState(server.url);
    expect(after.cases[last.id].start).toBe(last.start + 30);
    expect(after.cases[last.id].version).toBe(last.version + 1);
  });

  it('refuses a move onto another case', async () => {
    const state = await boardState(server.url);
    const [first, second] = Object.values(state.cases).filter((c) => c.roomId === 'or1').sort((a, b) => a.start - b.start);
    const res = await post(`${server.url}/api/cases/${second.id}/move`, { roomId: 'or1', start: first.start + 5, version: second.version });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('refuses a move from an out of date screen', async () => {
    const state = await boardState(server.url);
    const c = Object.values(state.cases).filter((x) => x.roomId === 'or7').sort((a, b) => b.start - a.start)[0];
    const res = await post(`${server.url}/api/cases/${c.id}/move`, { roomId: 'or7', start: c.start + 20, version: c.version - 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale');
  });

  it('rejects junk input', async () => {
    const res = await post(`${server.url}/api/cases/C101/move`, { roomId: 'or1' });
    expect(res.status).toBe(400);
  });

  it('books an emergency and explains the choice', async () => {
    const res = await post(`${server.url}/api/emergency`);
    expect(res.status).toBe(201);
    expect(res.body.plan.options).toHaveLength(8);
    expect(res.body.events[0].case.priority).toBe('emergency');
  });

  it('keeps the cases table equal to the replayed events', async () => {
    const state = await boardState(server.url);
    const rows = (await pool.query('SELECT id, room_id, start_min, end_min, version FROM cases ORDER BY id')).rows;
    const fromEvents = Object.values(state.cases)
      .map((c) => ({ id: c.id, room_id: c.roomId, start_min: c.start, end_min: c.end, version: c.version }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(fromEvents);
  });
});
