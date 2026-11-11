import { Redis } from 'ioredis';

// The bus carries news from one server to all the others.
// Server A saves a change, shouts it on the bus, and servers B and C
// pass it on to the browsers connected to them.

export type Listener = (message: unknown) => void;

export interface Bus {
  publish(message: unknown): void;
  subscribe(fn: Listener): void;
  close(): Promise<void>;
}

const CHANNEL = 'wheels-in:board';

// With a Redis url we use Redis. Without one we just talk to ourselves,
// which is fine when there is only one server.
export function makeBus(redisUrl = process.env.REDIS_URL): Bus {
  const listeners: Listener[] = [];
  const tell = (message: unknown) => listeners.forEach((fn) => fn(message));

  if (!redisUrl) {
    return {
      publish: (message) => queueMicrotask(() => tell(message)),
      subscribe: (fn) => void listeners.push(fn),
      close: async () => {},
    };
  }

  // Redis needs one connection to talk and a second one to listen.
  const pub = new Redis(redisUrl);
  const sub = new Redis(redisUrl);
  sub.subscribe(CHANNEL).catch((err) => console.error('redis subscribe failed', err));
  sub.on('message', (_channel, text) => tell(JSON.parse(text)));

  return {
    publish: (message) => void pub.publish(CHANNEL, JSON.stringify(message)),
    subscribe: (fn) => void listeners.push(fn),
    close: async () => {
      await Promise.all([pub.quit(), sub.quit()]);
    },
  };
}
