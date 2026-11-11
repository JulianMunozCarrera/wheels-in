import { repair, type Move } from './repair';
import { ScheduleIndex } from './state';
import { DAY_END, PREP, SURGEON_GAP, TURNOVER, type BoardState, type Case } from './types';

// How much each kind of pain costs. Bigger number means we avoid it more.
export const COST = {
  emergencyWait: 8, // each minute the emergency patient waits
  delayElective: 1, // each minute a normal case is pushed
  delayUrgent: 3, // each minute an urgent case is pushed
  overtime: 2, // each minute staff stay past the end of the day
};

export interface BumpOption {
  roomId: string;
  surgeonId: string;
  start: number;
  cost: number;
  casesMoved: number;
  minutesDelayed: number;
}

export interface BumpPlan extends BumpOption {
  end: number;
  moves: Move[];
  // Every room we looked at, so the screen can show why this one won.
  options: BumpOption[];
}

// An emergency just came in. Where do we put it?
// We try every room. For each one we work out who gets pushed and what it costs.
// The cheapest room wins.
export function planBump(state: BoardState, now: number, emergency: Case): BumpPlan {
  const cases = Object.values(state.cases).filter((c) => c.status !== 'cancelled');
  const index = new ScheduleIndex(cases);
  const onCall = state.surgeons.filter((s) => s.onCall);
  const surgeons = onCall.length > 0 ? onCall : state.surgeons;

  // Things the emergency can not push: cases that started, and other emergencies.
  const wall = (id: string) => {
    const c = state.cases[id];
    return c.status !== 'scheduled' || c.priority === 'emergency';
  };

  let best: BumpPlan | null = null;
  const options: BumpOption[] = [];

  for (const room of state.rooms) {
    for (const surgeon of surgeons) {
      // Start as soon as the patient can get there. Then slide later past every wall.
      let start = now + PREP;
      for (let moved = true; moved; ) {
        moved = false;
        const end = start + emergency.duration;
        for (const id of index.inRoom(room.id, start - TURNOVER, end + TURNOVER)) {
          if (wall(id) && state.cases[id].end + TURNOVER > start) {
            start = state.cases[id].end + TURNOVER;
            moved = true;
          }
        }
        for (const id of index.forSurgeon(surgeon.id, start - SURGEON_GAP, end + SURGEON_GAP)) {
          if (wall(id) && state.cases[id].end + SURGEON_GAP > start) {
            start = state.cases[id].end + SURGEON_GAP;
            moved = true;
          }
        }
      }

      // Drop the emergency in and let repair push everyone else out of the way.
      const placed: Case = { ...emergency, roomId: room.id, surgeonId: surgeon.id, start, end: start + emergency.duration };
      const pinned = new Set(cases.filter((c) => c.priority === 'emergency').map((c) => c.id));
      pinned.add(placed.id);
      const moves = repair([...cases, placed], [placed.id], pinned);

      // Add up the pain.
      let cost = (start - now) * COST.emergencyWait;
      let minutesDelayed = 0;
      for (const m of moves) {
        const c = state.cases[m.id];
        const delay = m.start - m.from.start;
        minutesDelayed += delay;
        cost += delay * (c.priority === 'urgent' ? COST.delayUrgent : COST.delayElective);
        cost += (Math.max(0, m.end - DAY_END) - Math.max(0, m.from.end - DAY_END)) * COST.overtime;
      }

      const option: BumpOption = { roomId: room.id, surgeonId: surgeon.id, start, cost, casesMoved: moves.length, minutesDelayed };
      // Keep only the best surgeon for each room in the list we show.
      const seen = options.findIndex((o) => o.roomId === room.id);
      if (seen === -1) options.push(option);
      else if (cost < options[seen].cost) options[seen] = option;

      if (!best || cost < best.cost) best = { ...option, end: placed.end, moves, options };
    }
  }

  if (!best) throw new Error('no rooms on the board');
  return best;
}
