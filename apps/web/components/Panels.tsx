'use client';

import { clockText, type BoardState, type BumpPlan, type Stats } from '@wheels-in/core';
import type { FeedItem } from '@/lib/feed';

export function StatsStrip({ stats }: { stats: Stats }) {
  return (
    <dl className="stats">
      <div>
        <dt>First cases on time</dt>
        <dd>
          {stats.firstOnTime}
          <small> of {stats.firstStarted}</small>
        </dd>
      </div>
      <div>
        <dt>Rooms running</dt>
        <dd>
          {stats.roomsRunning}
          <small> of {stats.roomsTotal}</small>
        </dd>
      </div>
      <div>
        <dt>Cases done</dt>
        <dd>
          {stats.done}
          <small> of {stats.total}</small>
        </dd>
      </div>
      <div>
        <dt>Late cases are behind by</dt>
        <dd>
          {stats.behind}
          <small> min</small>
        </dd>
      </div>
    </dl>
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <section className="panel feed" aria-label="Activity">
      <h2>Activity</h2>
      {items.length === 0 ? (
        <p className="quiet">Nothing has happened yet. The first patients roll in at 07:30.</p>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={item.seq} data-tone={item.tone}>
              <time>{clockText(item.at)}</time>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Shows every room the planner scored, so you can see why the winner won.
export function BumpCard({ plan, state, caseId, onClose }: { plan: BumpPlan; state: BoardState; caseId: string; onClose(): void }) {
  const room = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? id;
  const options = [...plan.options].sort((a, b) => a.cost - b.cost);
  const name = state.cases[caseId]?.procedure ?? 'The emergency';
  return (
    <section className="panel bump" aria-label="Emergency placed">
      <header>
        <h2>Why {room(plan.roomId)}?</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        {name} needed a room right away. The planner scored all {options.length} rooms and took the lowest score.
        {plan.moves.length === 0 ? ' Nobody had to move.' : ` ${plan.moves.length} ${plan.moves.length === 1 ? 'case was' : 'cases were'} pushed back.`}
      </p>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Start</th>
            <th>Pushed</th>
            <th>Delay</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.roomId} data-winner={o.roomId === plan.roomId}>
              <td>{room(o.roomId)}</td>
              <td>{clockText(o.start)}</td>
              <td>{o.casesMoved}</td>
              <td>{o.minutesDelayed} min</td>
              <td>{Math.round(o.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="quiet">Score: 8 points per minute the patient waits, 1 per minute a case is delayed (3 if urgent), 2 per minute of overtime.</p>
    </section>
  );
}

const STEPS = [
  ['wheels_in', 'Wheels in'],
  ['incision', 'Incision'],
  ['closing', 'Closing'],
  ['wheels_out', 'Wheels out'],
] as const;

export function CaseCard({ id, state, canDrag, onClose }: { id: string; state: BoardState; canDrag: boolean; onClose(): void }) {
  const c = state.cases[id];
  if (!c) return null;
  const room = state.rooms.find((r) => r.id === c.roomId)?.name;
  const surgeon = state.surgeons.find((s) => s.id === c.surgeonId)?.name;
  const late = c.start - c.plannedStart;
  return (
    <section className="panel case-card" aria-label="Case details" data-priority={c.priority}>
      <header>
        <h2>{c.procedure}</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        {room} with {surgeon}. Patient {c.patient} (made up).
        {c.priority !== 'elective' && <strong> {c.priority === 'emergency' ? 'Emergency.' : 'Urgent.'}</strong>}
      </p>
      <p>
        {clockText(c.start)} to {clockText(c.end)}
        {late > 0 && c.priority !== 'emergency' && <span className="late-text"> ({late} min later than planned)</span>}
      </p>
      <ol className="steps">
        {STEPS.map(([key, label]) => (
          <li key={key} data-done={c.times[key] !== undefined}>
            <span>{label}</span>
            <time>{c.times[key] !== undefined ? clockText(c.times[key]!) : 'not yet'}</time>
          </li>
        ))}
      </ol>
      {c.status === 'scheduled' && canDrag && <p className="quiet">Drag the block on the board to move this case.</p>}
    </section>
  );
}
