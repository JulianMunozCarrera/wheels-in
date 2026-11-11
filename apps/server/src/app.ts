import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { WebSocket } from 'ws';
import { decideBook, decideEmergency, decideMove, RuleError } from '@wheels-in/core';
import { Board } from './board';
import type { Bus } from './bus';

// Which web status code goes with which broken rule.
const STATUS = { conflict: 409, stale: 409, locked: 409, not_found: 404, bad_input: 400 } as const;

// Build the web server. Tests call this too, so it takes its parts as inputs.
export async function buildApp(pool: pg.Pool, bus: Bus): Promise<FastifyInstance & { board: Board }> {
  const app = Fastify({ logger: process.env.LOG === '1' });
  const board = new Board(pool, bus);
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true });
  await app.register(websocket);

  // A broken rule is not a crash. Send it back as a clear message.
  app.setErrorHandler((raw, _req, reply) => {
    const err = raw as Error & { validation?: unknown };
    if (err instanceof RuleError) return reply.code(STATUS[err.code]).send({ code: err.code, message: err.message });
    if (err.validation) return reply.code(400).send({ code: 'bad_input', message: err.message });
    app.log.error(err);
    return reply.code(500).send({ code: 'server_error', message: 'Something broke on our side' });
  });

  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  // The whole day so far. A browser asks for this once when it opens.
  app.get('/api/board', async () => board.read());

  // Drag a case to a new room or time.
  app.post<{ Params: { id: string }; Body: { roomId: string; start: number; version: number } }>(
    '/api/cases/:id/move',
    { schema: { body: { type: 'object', required: ['roomId', 'start', 'version'], properties: { roomId: { type: 'string' }, start: { type: 'number' }, version: { type: 'integer' } } } } },
    async (req) => {
      const { events } = await board.write((state, clock) => ({
        events: decideMove(state, Math.floor(clock.minute), { id: req.params.id, ...req.body }),
      }));
      return { events };
    },
  );

  // Book a new case.
  app.post<{ Body: { roomId: string; surgeonId: string; procedure: string; patient?: string; start: number; duration: number; priority?: 'elective' | 'urgent' } }>(
    '/api/cases',
    {
      schema: {
        body: {
          type: 'object',
          required: ['roomId', 'surgeonId', 'procedure', 'start', 'duration'],
          properties: {
            roomId: { type: 'string' }, surgeonId: { type: 'string' }, procedure: { type: 'string' }, patient: { type: 'string' },
            start: { type: 'number' }, duration: { type: 'number', minimum: 5, maximum: 720 }, priority: { enum: ['elective', 'urgent'] },
          },
        },
      },
    },
    async (req, reply) => {
      const id = `B${randomUUID().slice(0, 6)}`;
      const { events } = await board.write((state, clock) => ({
        events: decideBook(state, Math.floor(clock.minute), { id, patient: '', ...req.body }),
      }));
      return reply.code(201).send({ events });
    },
  );

  // An emergency came in. Find it a room and bump whoever is in the way.
  app.post('/api/emergency', async (_req, reply) => {
    const id = `E${randomUUID().slice(0, 6)}`;
    const { events, result } = await board.write((state, clock) => {
      const { events, plan } = decideEmergency(state, Math.floor(clock.minute), id);
      return { events, result: plan };
    });
    return reply.code(201).send({ events, plan: result });
  });

  // Pause, play, or change speed.
  app.post<{ Body: { speed?: number; running?: boolean } }>(
    '/api/clock',
    { schema: { body: { type: 'object', properties: { speed: { enum: [30, 60, 240] }, running: { type: 'boolean' } } } } },
    async (req) => {
      const { clock } = await board.write(() => ({ clock: { ...req.body } }));
      return { clock };
    },
  );

  // Start a new day.
  app.post('/api/reset', async () => {
    const { clock } = await board.write((_state, c) => ({ newDaySeed: c.seed + 1 }));
    return { clock };
  });

  // Live updates. Every browser holds one of these open.
  const sockets = new Set<WebSocket>();
  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.send(JSON.stringify({ kind: 'hello' }));
  });

  // News from the bus goes out to every browser on this server.
  bus.subscribe((message) => {
    const text = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  });

  const full = app as unknown as FastifyInstance & { board: Board };
  full.board = board;
  return full;
}
