import { decideBook, decideEmergency, decideMove, type BookInput, type MoveInput } from './commands';
import type { BumpPlan } from './bump';
import { seedDay } from './seed';
import { simStep } from './sim';
import { applyEvent, emptyState } from './state';
import { DAY_START, type BoardEvent, type BoardState, type EventBody } from './types';

// The whole board living in memory. No server needed.
// The browser demo runs on this. So do the tests.
export class DayEngine {
  state: BoardState = emptyState();
  events: BoardEvent[] = [];
  minute = DAY_START;

  constructor(seed: number) {
    this.commit([seedDay(seed)]);
  }

  // Save events: give each one a number, then update the board.
  private commit(bodies: EventBody[]): BoardEvent[] {
    const saved: BoardEvent[] = [];
    for (const body of bodies) {
      const ev = { ...body, seq: this.events.length + 1, at: this.minute } as BoardEvent;
      this.events.push(ev);
      this.state = applyEvent(this.state, ev);
      saved.push(ev);
    }
    return saved;
  }

  // Move the clock forward, one minute at a time.
  tickTo(minute: number): BoardEvent[] {
    const saved: BoardEvent[] = [];
    while (this.minute < Math.floor(minute)) {
      this.minute++;
      saved.push(...this.commit(simStep(this.state, this.minute)));
    }
    return saved;
  }

  move(input: MoveInput): BoardEvent[] {
    return this.commit(decideMove(this.state, this.minute, input));
  }

  book(input: BookInput): BoardEvent[] {
    return this.commit(decideBook(this.state, this.minute, input));
  }

  emergency(id: string): { events: BoardEvent[]; plan: BumpPlan } {
    const { events, plan } = decideEmergency(this.state, this.minute, id);
    return { events: this.commit(events), plan };
  }
}
