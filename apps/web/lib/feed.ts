import { clockText, type BoardEvent, type BoardState } from '@wheels-in/core';

export interface FeedItem {
  seq: number;
  at: number;
  tone: 'in' | 'out' | 'emergency' | 'over' | 'move';
  text: string;
}

// Turn raw events into short sentences a person can read.
// Most events are skipped on purpose. The feed should be calm, not a firehose.
export function buildFeed(events: BoardEvent[], state: BoardState, limit = 40): FeedItem[] {
  const room = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? id;
  const items: FeedItem[] = [];
  const ranOver = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const add = (tone: FeedItem['tone'], text: string) => items.push({ seq: ev.seq, at: ev.at, tone, text });

    if (ev.type === 'case_status') {
      const c = state.cases[ev.id];
      if (!c) continue;
      if (ev.status === 'wheels_in') add('in', `${room(c.roomId)} wheels in. ${c.procedure}`);
      if (ev.status === 'wheels_out') add('out', `${room(c.roomId)} wheels out. ${c.procedure}`);
    } else if (ev.type === 'case_booked' && ev.case.priority === 'emergency') {
      // Count how many cases this emergency pushed. They come right after it.
      let pushed = 0;
      for (let j = i + 1; j < events.length; j++) {
        const next = events[j];
        if (next.type === 'case_moved' && next.cause === ev.case.id && next.reason === 'bump') pushed++;
        else break;
      }
      const tail = pushed === 0 ? 'Nobody had to move.' : `${pushed} ${pushed === 1 ? 'case' : 'cases'} pushed back.`;
      add('emergency', `Emergency. ${ev.case.procedure} goes to ${room(ev.case.roomId)} at ${clockText(ev.case.start)}. ${tail}`);
    } else if (ev.type === 'case_moved' && ev.reason === 'manual') {
      const c = state.cases[ev.id];
      if (c) add('move', `${c.procedure} moved to ${room(ev.roomId)} at ${clockText(ev.start)}`);
    } else if (ev.type === 'case_moved' && ev.reason === 'overrun' && !ev.cause && !ranOver.has(ev.id)) {
      ranOver.add(ev.id);
      const c = state.cases[ev.id];
      if (c) add('over', `${room(ev.roomId)} is running over. ${c.procedure}`);
    }
  }
  return items.slice(-limit).reverse();
}
