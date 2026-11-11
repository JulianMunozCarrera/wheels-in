import { buildApp } from './app';
import { makeBus } from './bus';
import { makePool, migrate } from './db';
import { startTicker } from './ticker';

// Boot the server: database, bus, web server, clock.
const pool = makePool();
const bus = makeBus();
await migrate(pool);
const app = await buildApp(pool, bus);

// First boot ever: there is no day yet, so make one.
const { events } = await app.board.read();
if (events.length === 0) await app.board.write(() => ({ newDaySeed: Number(process.env.SEED ?? 1) }));

const stopTicker = startTicker(app.board, process.env.DATABASE_URL ?? 'postgres://wheels:wheels@localhost:5432/wheels');
await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
console.log(`Wheels In server is up on port ${process.env.PORT ?? 4000}`);

// Shut down cleanly when asked.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stopTicker();
    await app.close();
    await bus.close();
    await pool.end();
    process.exit(0);
  });
}
