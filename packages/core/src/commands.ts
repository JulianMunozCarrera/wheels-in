import { planBump, type BumpPlan } from './bump';
import { newEmergency } from './seed';
import { ScheduleIndex } from './state';
import { BOARD_END, DAY_START, RuleError, type BoardState, type Case, type EventBody } from './types';

// A command is a wish, like "move this case".
// Each function here checks the wish against the rules.
// If the wish is fine it gives back events. If not it throws a RuleError.
// Nothing here touches a database, so the server and the browser share it.

const label = (state: BoardState, roomId: string) => state.rooms.find((r) => r.id === roomId)?.name ?? roomId;
const doctor = (state: BoardState, id: string) => state.surgeons.find((s) => s.id === id)?.name ?? id;

// Throw if this slot sits on top of another case, in the room or for the surgeon.
function mustBeFree(state: BoardState, c: Pick<Case, 'id' | 'roomId' | 'surgeonId' | 'start' | 'end'>): void {
  const index = new ScheduleIndex(Object.values(state.cases));
  const roomHit = index.inRoom(c.roomId, c.start, c.end, c.id)[0];
  if (roomHit) throw new RuleError('conflict', `${label(state, c.roomId)} is taken then by ${state.cases[roomHit].procedure}`);
  const surgeonHit = index.forSurgeon(c.surgeonId, c.start, c.end, c.id)[0];
  if (surgeonHit) {
    throw new RuleError('conflict', `${doctor(state, c.surgeonId)} is operating in ${label(state, state.cases[surgeonHit].roomId)} then`);
  }
}

function mustFitTheDay(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new RuleError('bad_input', 'That time does not make sense');
  if (start < DAY_START || end > BOARD_END) throw new RuleError('bad_input', 'That is outside the surgical day');
}

export interface MoveInput {
  id: string;
  roomId: string;
  start: number;
  // The version the person was looking at when they dragged the case.
  version: number;
}

// Someone dragged a case to a new spot.
export function decideMove(state: BoardState, now: number, input: MoveInput): EventBody[] {
  const c = state.cases[input.id];
  if (!c) throw new RuleError('not_found', 'That case is not on the board');
  // Someone else changed the case first. Their screen was out of date.
  if (c.version !== input.version) throw new RuleError('stale', 'Someone else just changed this case. Try again.');
  if (c.status !== 'scheduled') throw new RuleError('locked', 'This case already started, so it can not move');
  if (!state.rooms.some((r) => r.id === input.roomId)) throw new RuleError('bad_input', 'No such room');
  const start = Math.round(input.start);
  const end = start + c.duration;
  mustFitTheDay(start, end);
  if (start < now) throw new RuleError('bad_input', 'That time has already passed');
  mustBeFree(state, { ...c, roomId: input.roomId, start, end });
  return [{ type: 'case_moved', id: c.id, roomId: input.roomId, start, end, reason: 'manual' }];
}

export interface BookInput {
  id: string;
  roomId: string;
  surgeonId: string;
  procedure: string;
  patient: string;
  start: number;
  duration: number;
  priority?: 'elective' | 'urgent';
}

// Someone added a brand new case.
export function decideBook(state: BoardState, now: number, input: BookInput): EventBody[] {
  if (state.cases[input.id]) throw new RuleError('conflict', 'That case id is already used');
  if (!state.rooms.some((r) => r.id === input.roomId)) throw new RuleError('bad_input', 'No such room');
  if (!state.surgeons.some((s) => s.id === input.surgeonId)) throw new RuleError('bad_input', 'No such surgeon');
  if (!input.procedure || input.procedure.length > 80) throw new RuleError('bad_input', 'Give the procedure a short name');
  const start = Math.round(input.start);
  const duration = Math.round(input.duration);
  mustFitTheDay(start, start + duration);
  if (start < now) throw new RuleError('bad_input', 'That time has already passed');
  const c: Case = {
    id: input.id,
    roomId: input.roomId,
    surgeonId: input.surgeonId,
    procedure: input.procedure,
    patient: String(input.patient ?? '').slice(0, 20),
    start,
    end: start + duration,
    plannedStart: start,
    duration,
    status: 'scheduled',
    priority: input.priority === 'urgent' ? 'urgent' : 'elective',
    version: 1,
    times: {},
  };
  mustBeFree(state, c);
  return [{ type: 'case_booked', case: c }];
}

// An emergency arrived. Book it and push whoever is in the way.
export function decideEmergency(state: BoardState, now: number, id: string): { events: EventBody[]; plan: BumpPlan } {
  if (state.cases[id]) throw new RuleError('conflict', 'That case id is already used');
  const fresh = newEmergency(id);
  const plan = planBump(state, now, fresh);
  const booked: Case = { ...fresh, roomId: plan.roomId, surgeonId: plan.surgeonId, start: plan.start, end: plan.end, plannedStart: plan.start };
  const events: EventBody[] = [{ type: 'case_booked', case: booked }];
  for (const m of plan.moves) {
    events.push({ type: 'case_moved', id: m.id, roomId: m.roomId, start: m.start, end: m.end, reason: 'bump', cause: id });
  }
  return { events, plan };
}
