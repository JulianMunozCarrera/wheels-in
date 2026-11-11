// Load test. Start the server first, then run: npm run loadtest
//
// It opens a crowd of browsers (web sockets) that only watch,
// plus a few "coordinators" that drag cases around as fast as they can.
// At the end it checks the one thing that matters: zero double bookings.
//
// Settings: URL, CLIENTS, WRITERS, SECONDS

import { WebSocket } from 'ws';
import { applyEvent, emptyState, replay, type BoardEvent, type BoardState } from '@wheels-in/core';

const URL_BASE = process.env.URL ?? 'http://localhost:4000';
const CLIENTS = Number(process.env.CLIENTS ?? 500);
const WRITERS = Number(process.env.WRITERS ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 15);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The value that N percent of the samples are at or below.
const pct = (list: number[], p: number) => {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const fanout: number[] = [];
let delivered = 0;
let state: BoardState = emptyState();
let lastSeq = 0;

// Open all the watchers. The first one also keeps a live copy of the board.
const sockets: WebSocket[] = [];
for (let i = 0; i < CLIENTS; i++) {
  const ws = new WebSocket(URL_BASE.replace('http', 'ws') + '/ws');
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.kind !== 'events') return;
    delivered++;
    fanout.push(Date.now() - msg.sentAt);
    if (i === 0) {
      for (const ev of msg.events as BoardEvent[]) {
        if (ev.seq <= lastSeq) continue;
        state = applyEvent(state, ev);
        lastSeq = ev.seq;
      }
    }
  });
  sockets.push(ws);
  if (i % 50 === 49) await sleep(20);
}
await Promise.all(sockets.map((ws) => new Promise((r) => (ws.readyState === ws.OPEN ? r(0) : ws.once('open', r)))));

const first = (await (await fetch(`${URL_BASE}/api/board`)).json()) as { events: BoardEvent[] };
state = replay(first.events);
lastSeq = first.events.at(-1)?.seq ?? 0;
console.log(`${CLIENTS} browsers connected. ${WRITERS} coordinators writing for ${SECONDS}s...`);

const latency: number[] = [];
const tally = { ok: 0, refused: 0, failed: 0 };
const stopAt = Date.now() + SECONDS * 1000;

// One coordinator: pick a case, drag it somewhere random, repeat.
async function coordinator(n: number) {
  let i = n * 1000;
  while (Date.now() < stopAt) {
    const cases = Object.values(state.cases).filter((c) => c.status === 'scheduled');
    if (cases.length === 0) break;
    const c = cases[(i * 7919) % cases.length];
    const roomId = state.rooms[i % state.rooms.length].id;
    const start = 8 * 60 + ((i * 35) % 720);
    i++;
    const t0 = performance.now();
    const res =
      i % 60 === 0
        ? await fetch(`${URL_BASE}/api/emergency`, { method: 'POST' })
        : await fetch(`${URL_BASE}/api/cases/${c.id}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ roomId, start, version: c.version }),
          });
    await res.arrayBuffer();
    latency.push(performance.now() - t0);
    if (res.status < 300) tally.ok++;
    else if (res.status < 500) tally.refused++;
    else tally.failed++;
  }
}
await Promise.all(Array.from({ length: WRITERS }, (_, n) => coordinator(n)));
await sleep(500);

// The final check, done from the saved events and nothing else.
const final = replay(((await (await fetch(`${URL_BASE}/api/board`)).json()) as { events: BoardEvent[] }).events);
const cases = Object.values(final.cases).filter((c) => c.status !== 'cancelled');
let doubleBooked = 0;
for (let a = 0; a < cases.length; a++) {
  for (let b = a + 1; b < cases.length; b++) {
    const x = cases[a];
    const y = cases[b];
    if (x.start < y.end && y.start < x.end && (x.roomId === y.roomId || x.surgeonId === y.surgeonId)) doubleBooked++;
  }
}

const total = tally.ok + tally.refused + tally.failed;
console.table({
  'write requests': total,
  'requests per second': Math.round(total / SECONDS),
  'accepted': tally.ok,
  'refused by a rule (4xx)': tally.refused,
  'server errors (5xx)': tally.failed,
  'write latency p50 ms': +pct(latency, 50).toFixed(1),
  'write latency p95 ms': +pct(latency, 95).toFixed(1),
  'write latency p99 ms': +pct(latency, 99).toFixed(1),
  'messages delivered to browsers': delivered,
  'fan out p50 ms': pct(fanout, 50),
  'fan out p95 ms': pct(fanout, 95),
  'fan out p99 ms': pct(fanout, 99),
  'double bookings': doubleBooked,
});

sockets.forEach((ws) => ws.close());
process.exit(doubleBooked === 0 && tally.failed === 0 ? 0 : 1);
