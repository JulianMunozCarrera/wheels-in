import { describe, expect, it } from 'vitest';
import {
  DayEngine, RuleError, SURGEON_GAP, TURNOVER, dayIsOver, decideEmergency, planBump, newEmergency,
  repair, replay, seedDay, type BoardState, type Case,
} from '../src';

// A tiny case for tests.
const mk = (id: string, roomId: string, surgeonId: string, start: number, end: number, extra: Partial<Case> = {}): Case => ({
  id, roomId, surgeonId, procedure: id, patient: 'T.T. 40', start, end, plannedStart: start,
  duration: end - start, status: 'scheduled', priority: 'elective', version: 1, times: {}, ...extra,
});

// Find any two cases that sit on top of each other.
function overlaps(state: BoardState): string[] {
  const cases = Object.values(state.cases).filter((c) => c.status !== 'cancelled');
  const bad: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const a = cases[i];
      const b = cases[j];
      const touch = a.start < b.end && b.start < a.end;
      if (touch && a.roomId === b.roomId) bad.push(`room ${a.id}/${b.id}`);
      if (touch && a.surgeonId === b.surgeonId) bad.push(`surgeon ${a.id}/${b.id}`);
    }
  }
  return bad;
}

describe('repair', () => {
  it('pushes the next case in the room when one runs long', () => {
    const a = mk('a', 'or1', 's1', 100, 220, { status: 'incision' });
    const b = mk('b', 'or1', 's2', 200, 260);
    const moves = repair([a, b], ['a']);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: 'b', start: 220 + TURNOVER });
  });

  it('follows the surgeon into another room', () => {
    // s1 runs long in or1. Their next case is in or2. That one has to wait too.
    const a = mk('a', 'or1', 's1', 100, 250, { status: 'incision' });
    const b = mk('b', 'or2', 's1', 240, 300);
    const c = mk('c', 'or2', 's3', 310, 360);
    const moves = repair([a, b, c], ['a']);
    expect(moves.find((m) => m.id === 'b')!.start).toBe(250 + SURGEON_GAP);
    // b moved, so c behind it in or2 moves as well.
    expect(moves.find((m) => m.id === 'c')!.start).toBe(250 + SURGEON_GAP + 60 + TURNOVER);
  });

  it('never moves a case that already started', () => {
    const a = mk('a', 'or1', 's1', 100, 200, { status: 'incision' });
    const b = mk('b', 'or1', 's2', 150, 210, { priority: 'emergency' });
    expect(repair([a, b], ['b'], new Set(['b']))).toEqual([]);
  });

  it('leaves a clean board alone', () => {
    const day = seedDay(11);
    expect(repair(day.cases, day.cases.map((c) => c.id))).toEqual([]);
  });
});

describe('planBump', () => {
  it('uses an empty room when there is one', () => {
    const e = new DayEngine(5);
    const busy = Object.values(e.state.cases).filter((c) => c.roomId !== 'or8');
    const state = { ...e.state, cases: Object.fromEntries(busy.map((c) => [c.id, c])) };
    const plan = planBump(state, 480, newEmergency('E1'));
    expect(plan.roomId).toBe('or8');
    expect(plan.moves).toEqual([]);
  });

  it('never puts two emergencies on top of each other', () => {
    const e = new DayEngine(9);
    e.tickTo(600);
    for (let i = 0; i < 6; i++) e.emergency(`X${i}`);
    expect(overlaps(e.state)).toEqual([]);
  });

  it('picks the cheapest room out of all the ones it tried', () => {
    const e = new DayEngine(21);
    e.tickTo(640);
    const { plan } = decideEmergency(e.state, e.minute, 'E-test');
    expect(plan.options).toHaveLength(e.state.rooms.length);
    expect(plan.cost).toBe(Math.min(...plan.options.map((o) => o.cost)));
  });
});

describe('a whole simulated day', () => {
  it('never double books, for 25 different days', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const e = new DayEngine(seed);
      for (let m = e.minute; m < 24 * 60 && !dayIsOver(e.state); m += 7) {
        e.tickTo(m);
        expect(overlaps(e.state), `seed ${seed} minute ${m}`).toEqual([]);
      }
      e.tickTo(26 * 60);
      expect(dayIsOver(e.state), `seed ${seed} should finish`).toBe(true);
    }
  });

  it('gives the same day for the same seed', () => {
    const a = new DayEngine(42);
    const b = new DayEngine(42);
    a.tickTo(900);
    b.tickTo(900);
    expect(a.events).toEqual(b.events);
  });

  it('can rebuild any moment from the event list alone', () => {
    const e = new DayEngine(13);
    e.tickTo(700);
    const middle = e.events.length;
    const snapshot = e.state;
    e.tickTo(1000);
    expect(replay(e.events, middle)).toEqual(snapshot);
    expect(replay(e.events)).toEqual(e.state);
  });
});

describe('moving a case by hand', () => {
  const firstIn = (e: DayEngine, roomId: string) =>
    Object.values(e.state.cases).filter((c) => c.roomId === roomId).sort((a, b) => a.start - b.start);

  it('says no when the room is taken', () => {
    const e = new DayEngine(3);
    const [a, b] = firstIn(e, 'or1');
    expect(() => e.move({ id: b.id, roomId: 'or1', start: a.start + 10, version: b.version })).toThrowError(RuleError);
  });

  it('says no when the screen was out of date', () => {
    const e = new DayEngine(3);
    const last = firstIn(e, 'or1').at(-1)!;
    e.move({ id: last.id, roomId: 'or1', start: last.start + 30, version: last.version });
    // Second person still holds the old version number.
    try {
      e.move({ id: last.id, roomId: 'or1', start: last.start + 60, version: last.version });
      expect.unreachable();
    } catch (err) {
      expect((err as RuleError).code).toBe('stale');
    }
  });

  it('says no once the patient is in the room', () => {
    const e = new DayEngine(3);
    e.tickTo(520);
    const started = Object.values(e.state.cases).find((c) => c.status !== 'scheduled')!;
    try {
      e.move({ id: started.id, roomId: started.roomId, start: 900, version: started.version });
      expect.unreachable();
    } catch (err) {
      expect((err as RuleError).code).toBe('locked');
    }
  });
});
