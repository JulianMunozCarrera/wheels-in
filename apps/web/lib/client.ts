import {
  DayEngine, RuleError, applyEvent, dayIsOver, emptyState, replay,
  type BoardEvent, type BoardState, type BumpPlan,
} from '@wheels-in/core';

// Everything the screen needs to draw one frame.
export interface Snapshot {
  mode: 'demo' | 'live';
  // False while we are still loading or the server is unreachable.
  ready: boolean;
  events: BoardEvent[];
  state: BoardState;
  minute: number;
  speed: number;
  running: boolean;
  // When "minute" was measured, so the clock can glide between updates.
  measuredAt: number;
  // The last emergency plan, so we can show why a room was picked.
  lastPlan: { plan: BumpPlan; caseId: string } | null;
}

// The screen talks to this. It does not care if a server is behind it or not.
export interface BoardClient {
  subscribe(fn: () => void): () => void;
  get(): Snapshot;
  // These give back an error message, or null if it worked.
  move(id: string, roomId: string, start: number): Promise<string | null>;
  emergency(): Promise<string | null>;
  setSpeed(speed: number): void;
  setRunning(running: boolean): void;
  newDay(): void;
}

export const EMPTY: Snapshot = {
  mode: 'demo', ready: false, events: [], state: emptyState(),
  minute: 420, speed: 60, running: true, measuredAt: 0, lastPlan: null,
};

// Shared plumbing: hold a snapshot and tell listeners when it changes.
class Store {
  protected snap: Snapshot = EMPTY;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = () => this.snap;
  protected set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn());
  }
}

// Demo mode. The whole hospital runs inside the browser tab.
// It uses the exact same rules as the server, because both import the core package.
class LocalBoard extends Store implements BoardClient {
  private engine!: DayEngine;
  private minute = 0;
  private seed = 7;
  private last = performance.now();

  constructor() {
    super();
    this.begin(this.seed, 9 * 60 + 5);
    setInterval(() => this.tick(), 200);
  }

  // Start a day. We open mid morning so the board is busy right away.
  private begin(seed: number, openAt: number) {
    this.seed = seed;
    this.engine = new DayEngine(seed);
    this.engine.tickTo(openAt);
    this.minute = openAt;
    this.set({ mode: 'demo', ready: true, lastPlan: null, ...this.view() });
  }

  private view() {
    return { events: this.engine.events.slice(), state: this.engine.state, minute: this.minute, measuredAt: performance.now() };
  }

  private tick() {
    const now = performance.now();
    const seconds = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    if (!this.snap.running) return;
    this.minute += (seconds * this.snap.speed) / 60;
    const before = this.engine.events.length;
    this.engine.tickTo(this.minute);

    // Day finished. Leave the board up for a moment, then roll a new day.
    if (dayIsOver(this.engine.state)) {
      const lastOut = Math.max(...Object.values(this.engine.state.cases).map((c) => c.times.wheels_out ?? 0));
      if (this.minute > lastOut + 30) return this.begin(this.seed + 1, 7 * 60 + 20);
    }
    if (this.engine.events.length !== before) this.set(this.view());
    else this.set({ minute: this.minute, measuredAt: now });
  }

  async move(id: string, roomId: string, start: number) {
    try {
      this.engine.move({ id, roomId, start, version: this.engine.state.cases[id].version });
      this.set(this.view());
      return null;
    } catch (err) {
      return err instanceof RuleError ? err.message : 'That did not work';
    }
  }

  async emergency() {
    const id = `E${Date.now().toString(36)}`;
    const { plan } = this.engine.emergency(id);
    this.set({ ...this.view(), lastPlan: { plan, caseId: id } });
    return null;
  }

  setSpeed(speed: number) {
    this.set({ speed });
  }
  setRunning(running: boolean) {
    this.set({ running, minute: this.minute, measuredAt: performance.now() });
  }
  newDay() {
    this.begin(this.seed + 1, 9 * 60 + 5);
  }
}

// Live mode. A real server holds the board and many people share it.
class RemoteBoard extends Store implements BoardClient {
  private epoch = -1;
  private lastSeq = 0;
  private loading = false;
  private retry = 500;

  constructor(private api: string) {
    super();
    this.snap = { ...EMPTY, mode: 'live' };
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.api.replace(/^http/, 'ws') + '/ws');
    ws.onopen = () => {
      this.retry = 500;
      void this.load();
    };
    ws.onmessage = (m) => this.hear(JSON.parse(m.data));
    // Lost the line. Wait a bit longer each time, then try again.
    ws.onclose = () => {
      this.set({ ready: false });
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }

  // Fetch the whole day. Used on connect and any time we think we missed something.
  private async load() {
    if (this.loading) return;
    this.loading = true;
    try {
      const data = await (await fetch(`${this.api}/api/board`)).json();
      this.epoch = data.clock.epoch;
      this.lastSeq = data.events.at(-1)?.seq ?? 0;
      this.set({
        ready: true, events: data.events, state: replay(data.events),
        minute: data.clock.minute, speed: data.clock.speed, running: data.clock.running, measuredAt: performance.now(),
      });
    } catch {
      this.set({ ready: false });
    } finally {
      this.loading = false;
    }
  }

  private hear(msg: any) {
    if (msg.kind === 'clock') {
      if (msg.clock.epoch !== this.epoch) return void this.load();
      this.set({ minute: msg.clock.minute, speed: msg.clock.speed, running: msg.clock.running, measuredAt: performance.now() });
    }
    if (msg.kind === 'events') {
      const fresh = (msg.events as BoardEvent[]).filter((e) => e.seq > this.lastSeq);
      if (fresh.length === 0 && msg.epoch === this.epoch) return;
      // Wrong day, or a gap in the numbers. We missed something. Reload it all.
      if (msg.epoch !== this.epoch || fresh[0].seq !== this.lastSeq + 1) return void this.load();
      let state = this.snap.state;
      for (const e of fresh) state = applyEvent(state, e);
      this.lastSeq = fresh[fresh.length - 1].seq;
      this.set({ events: [...this.snap.events, ...fresh], state });
    }
  }

  private async post(path: string, body: unknown = {}) {
    try {
      const res = await fetch(this.api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: { message: 'Could not reach the server' } };
    }
  }

  async move(id: string, roomId: string, start: number) {
    const version = this.snap.state.cases[id]?.version;
    const res = await this.post(`/api/cases/${id}/move`, { roomId, start, version });
    return res.ok ? null : res.data.message;
  }

  async emergency() {
    const res = await this.post('/api/emergency');
    if (!res.ok) return res.data.message as string;
    this.set({ lastPlan: { plan: res.data.plan, caseId: res.data.events[0].case.id } });
    return null;
  }

  setSpeed(speed: number) {
    void this.post('/api/clock', { speed });
  }
  setRunning(running: boolean) {
    void this.post('/api/clock', { running });
  }
  newDay() {
    void this.post('/api/reset');
  }
}

let client: BoardClient | null = null;

// One client for the whole page. With an API url we go live. Without one we run the demo.
export function getClient(): BoardClient {
  if (!client) {
    const api = process.env.NEXT_PUBLIC_API_URL;
    client = api ? new RemoteBoard(api.replace(/\/$/, '')) : new LocalBoard();
  }
  return client;
}
