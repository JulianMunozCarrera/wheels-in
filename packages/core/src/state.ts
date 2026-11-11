import { IntervalTree } from './intervalTree';
import type { BoardEvent, BoardState, Case } from './types';

export const emptyState = (): BoardState => ({ seed: 0, rooms: [], surgeons: [], cases: {} });

// Take the board and one event. Give back the new board.
// This never changes the old board. That is what makes time travel easy.
export function applyEvent(state: BoardState, ev: BoardEvent): BoardState {
  switch (ev.type) {
    case 'day_seeded': {
      const cases: Record<string, Case> = {};
      for (const c of ev.cases) cases[c.id] = c;
      return { seed: ev.seed, rooms: ev.rooms, surgeons: ev.surgeons, cases };
    }
    case 'case_booked':
      return { ...state, cases: { ...state.cases, [ev.case.id]: ev.case } };
    case 'case_moved': {
      const old = state.cases[ev.id];
      if (!old) return state;
      const next: Case = { ...old, roomId: ev.roomId, start: ev.start, end: ev.end, version: old.version + 1 };
      // When a person moves a case by hand, that becomes the new promise.
      if (ev.reason === 'manual') next.plannedStart = ev.start;
      return { ...state, cases: { ...state.cases, [ev.id]: next } };
    }
    case 'case_status': {
      const old = state.cases[ev.id];
      if (!old) return state;
      const next: Case = {
        ...old,
        status: ev.status,
        version: old.version + 1,
        times: { ...old.times, [ev.status]: ev.at },
      };
      return { ...state, cases: { ...state.cases, [ev.id]: next } };
    }
    case 'case_cancelled': {
      const old = state.cases[ev.id];
      if (!old) return state;
      return { ...state, cases: { ...state.cases, [ev.id]: { ...old, status: 'cancelled', version: old.version + 1 } } };
    }
  }
}

// Play a list of events from the start. Stop early to see the past.
export function replay(events: BoardEvent[], upTo = events.length): BoardState {
  let state = emptyState();
  for (let i = 0; i < upTo && i < events.length; i++) state = applyEvent(state, events[i]);
  return state;
}

// Two lookup tables: one tree per room and one tree per surgeon.
// Ask it "who is in OR 3 between 9:00 and 10:00?" and it answers fast.
export class ScheduleIndex {
  private rooms = new Map<string, IntervalTree>();
  private surgeons = new Map<string, IntervalTree>();
  private spot = new Map<string, { roomId: string; surgeonId: string }>();

  constructor(cases: Case[] = []) {
    for (const c of cases) if (c.status !== 'cancelled') this.put(c);
  }

  private tree(map: Map<string, IntervalTree>, key: string): IntervalTree {
    let t = map.get(key);
    if (!t) map.set(key, (t = new IntervalTree()));
    return t;
  }

  // Add a case, or move it if it is already here.
  put(c: Pick<Case, 'id' | 'roomId' | 'surgeonId' | 'start' | 'end'>): void {
    this.drop(c.id);
    this.tree(this.rooms, c.roomId).insert(c.id, c.start, c.end);
    this.tree(this.surgeons, c.surgeonId).insert(c.id, c.start, c.end);
    this.spot.set(c.id, { roomId: c.roomId, surgeonId: c.surgeonId });
  }

  drop(id: string): void {
    const s = this.spot.get(id);
    if (!s) return;
    this.tree(this.rooms, s.roomId).remove(id);
    this.tree(this.surgeons, s.surgeonId).remove(id);
    this.spot.delete(id);
  }

  // Cases in this room that touch [start, end).
  inRoom(roomId: string, start: number, end: number, skipId?: string): string[] {
    return this.tree(this.rooms, roomId).search(start, end).filter((id) => id !== skipId);
  }

  // Cases this surgeon has that touch [start, end).
  forSurgeon(surgeonId: string, start: number, end: number, skipId?: string): string[] {
    return this.tree(this.surgeons, surgeonId).search(start, end).filter((id) => id !== skipId);
  }
}
