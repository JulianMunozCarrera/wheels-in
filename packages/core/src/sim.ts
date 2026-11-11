import { decideEmergency } from './commands';
import { repair } from './repair';
import { emergencyMinutes, truthFor } from './seed';
import { applyEvent } from './state';
import { isRunning, TURNOVER, type BoardEvent, type BoardState, type Case, type EventBody } from './types';

// How many minutes we add each time a surgery runs past its block.
const OVERRUN_STEP = 10;

// Play one minute of the fake hospital day.
// It looks at every case and asks: should anything happen right now?
// It gives back the events for this minute. It does not save anything.
export function simStep(start: BoardState, minute: number): EventBody[] {
  let state = start;
  const out: EventBody[] = [];
  // Apply each event right away so the next choice sees it.
  const emit = (body: EventBody) => {
    out.push(body);
    state = applyEvent(state, { ...body, seq: 0, at: minute } as BoardEvent);
  };
  const all = () => Object.values(state.cases);
  const pushOthers = (dirty: Case, reason: 'late' | 'overrun', pinned: Set<string>) => {
    for (const m of repair(all(), [dirty.id], pinned)) {
      emit({ type: 'case_moved', id: m.id, roomId: m.roomId, start: m.start, end: m.end, reason, cause: dirty.id });
    }
  };

  // An emergency is due this minute.
  if (emergencyMinutes(state.seed).includes(minute) && !state.cases[`E${minute}`]) {
    for (const body of decideEmergency(state, minute, `E${minute}`).events) emit(body);
  }

  const ids = all()
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((c) => c.id);

  for (const id of ids) {
    const c = state.cases[id];
    const truth = truthFor(state.seed, c);

    if (c.status === 'scheduled') {
      if (minute < c.start + truth.late) continue;
      const roomCases = all().filter((o) => o.roomId === c.roomId && o.id !== c.id);
      // The room must be empty and cleaned.
      const roomBusy = roomCases.some((o) => isRunning(o.status) || (o.times.wheels_out ?? -999) + TURNOVER > minute);
      // Cases in a room go in order. No jumping the line.
      const notNext = roomCases.some((o) => o.status === 'scheduled' && (o.start < c.start || (o.start === c.start && o.id < c.id)));
      // A surgeon can only be in one room.
      const surgeonBusy = all().some((o) => o.id !== c.id && o.surgeonId === c.surgeonId && isRunning(o.status));
      if (roomBusy || notNext || surgeonBusy) continue;

      // Starting late: slide the block to now, then push whoever that hits.
      if (minute !== c.start) {
        emit({ type: 'case_moved', id: c.id, roomId: c.roomId, start: minute, end: minute + c.duration, reason: 'late' });
        pushOthers(state.cases[c.id], 'late', new Set([c.id]));
      }
      emit({ type: 'case_status', id: c.id, status: 'wheels_in' });
      continue;
    }

    if (c.status === 'wheels_in' && minute >= c.times.wheels_in! + truth.prep) {
      emit({ type: 'case_status', id: c.id, status: 'incision' });
    } else if (c.status === 'incision' && minute >= c.times.incision! + truth.cut) {
      emit({ type: 'case_status', id: c.id, status: 'closing' });
    } else if (c.status === 'closing' && minute >= c.times.closing! + truth.close) {
      // Done. Trim the block so it ends at the real finish time.
      if (c.end !== minute) emit({ type: 'case_moved', id: c.id, roomId: c.roomId, start: c.start, end: minute, reason: 'finish' });
      emit({ type: 'case_status', id: c.id, status: 'wheels_out' });
    } else if (isRunning(c.status) && minute >= c.end) {
      // Still going past the end of its block. Make the block longer and push the next cases.
      emit({ type: 'case_moved', id: c.id, roomId: c.roomId, start: c.start, end: minute + OVERRUN_STEP, reason: 'overrun' });
      pushOthers(state.cases[c.id], 'overrun', new Set());
    }
  }

  return out;
}

// True when every case is finished.
export function dayIsOver(state: BoardState): boolean {
  const cases = Object.values(state.cases);
  return cases.length > 0 && cases.every((c) => c.status === 'wheels_out' || c.status === 'cancelled');
}
