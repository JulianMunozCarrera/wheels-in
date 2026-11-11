import { MinHeap } from './minHeap';
import { ScheduleIndex } from './state';
import { SURGEON_GAP, TURNOVER, type Case, type Slot } from './types';

export interface Move extends Slot {
  id: string;
  from: Slot;
}

// Something changed and now blocks sit on top of each other.
// This pushes cases later, one by one, until nothing overlaps.
//
// How it works:
//   1. Put every changed case in a heap, earliest first.
//   2. Take the earliest one out.
//   3. If it can move and something earlier is in its way, push it later. Back in the heap.
//   4. Otherwise it stays. Anything in ITS way gets pushed later. Those go in the heap.
//   5. Repeat until the heap is empty.
//
// Blocks only ever move later, so this always finishes.
//
// cases:  the whole board, with the change already made
// dirty:  ids of the cases that changed
// pinned: ids that must not move (like an emergency)
export function repair(cases: Case[], dirty: string[], pinned: Set<string> = new Set()): Move[] {
  const byId = new Map<string, Case>();
  for (const c of cases) if (c.status !== 'cancelled') byId.set(c.id, { ...c });
  const index = new ScheduleIndex([...byId.values()]);
  const before = new Map<string, Slot>();
  for (const c of byId.values()) before.set(c.id, { roomId: c.roomId, start: c.start, end: c.end });

  // A case that already started can not move. Neither can a pinned one.
  const fixed = (c: Case) => c.status !== 'scheduled' || pinned.has(c.id);
  const comesFirst = (a: Case, b: Case) => a.start < b.start || (a.start === b.start && a.id < b.id);

  const heap = new MinHeap<{ id: string; start: number }>(
    (a, b) => a.start < b.start || (a.start === b.start && a.id < b.id),
  );
  const queue = (c: Case) => heap.push({ id: c.id, start: c.start });
  const moveTo = (c: Case, start: number) => {
    c.end = start + (c.end - c.start);
    c.start = start;
    index.put(c);
    queue(c);
  };

  // Who is too close to this case? Same room needs a cleaning gap.
  // Same surgeon needs a short break. Gives back id -> gap needed.
  const tooClose = (c: Case) => {
    const near = new Map<string, number>();
    for (const id of index.inRoom(c.roomId, c.start - TURNOVER, c.end + TURNOVER, c.id)) near.set(id, TURNOVER);
    for (const id of index.forSurgeon(c.surgeonId, c.start - SURGEON_GAP, c.end + SURGEON_GAP, c.id)) {
      near.set(id, Math.max(near.get(id) ?? 0, SURGEON_GAP));
    }
    return near;
  };

  for (const id of dirty) {
    const c = byId.get(id);
    if (c) queue(c);
  }

  let safety = 0;
  while (heap.size > 0) {
    if (++safety > 50_000) throw new Error('repair did not settle');
    const top = heap.pop()!;
    const c = byId.get(top.id)!;
    // This heap entry is old. The case moved again since. Skip it.
    if (c.start !== top.start) continue;

    const near = tooClose(c);

    if (!fixed(c)) {
      // Something that can not move, or that comes first, is in my way. I go after it.
      let pushTo = c.start;
      for (const [id, gap] of near) {
        const other = byId.get(id)!;
        if (fixed(other) || comesFirst(other, c)) pushTo = Math.max(pushTo, other.end + gap);
      }
      if (pushTo > c.start) {
        moveTo(c, pushTo);
        continue;
      }
    }

    // I am staying here. Everyone in my way moves to after me.
    for (const [id, gap] of near) {
      const other = byId.get(id)!;
      if (!fixed(other)) moveTo(other, c.end + gap);
    }
  }

  // Report only the cases that ended up somewhere new.
  const moves: Move[] = [];
  for (const c of byId.values()) {
    const from = before.get(c.id)!;
    if (from.start !== c.start || from.end !== c.end) {
      moves.push({ id: c.id, roomId: c.roomId, start: c.start, end: c.end, from });
    }
  }
  moves.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return moves;
}
