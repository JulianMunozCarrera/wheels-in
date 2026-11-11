'use client';

import { useMemo, useRef, useState } from 'react';
import {
  BOARD_END, DAY_END, DAY_START, ScheduleIndex, clockText,
  type BoardState, type Case, type Slot,
} from '@wheels-in/core';

const SPAN = BOARD_END - DAY_START;
// Where a minute sits across the board, as a percent.
const x = (minute: number) => ((minute - DAY_START) / SPAN) * 100;
const HOURS = Array.from({ length: SPAN / 60 + 1 }, (_, i) => DAY_START + i * 60);

const STATUS_WORD: Record<string, string> = {
  scheduled: 'scheduled', wheels_in: 'wheels in', incision: 'incision', closing: 'closing', wheels_out: 'done', cancelled: 'cancelled',
};

interface Props {
  state: BoardState;
  // The minute the board is showing. In the past when time travelling.
  shown: number;
  // The real "now" of the board.
  liveMinute: number;
  travelling: boolean;
  ghosts: (Slot & { id: string })[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onMove(id: string, roomId: string, start: number): void;
  onScrub(minute: number | null): void;
}

interface Drag {
  id: string;
  roomId: string;
  start: number;
  ok: boolean;
  moved: boolean;
}

export function Timeline({ state, shown, liveMinute, travelling, ghosts, selectedId, onSelect, onMove, onScrub }: Props) {
  const lanes = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cases = useMemo(() => Object.values(state.cases).filter((c) => c.status !== 'cancelled'), [state]);
  const index = useMemo(() => new ScheduleIndex(cases), [cases]);
  const surgeonName = (id: string) => state.surgeons.find((s) => s.id === id)?.name ?? '';

  // Turn a mouse position into a minute on the board.
  const minuteAt = (clientX: number) => {
    const box = lanes.current!.getBoundingClientRect();
    return DAY_START + ((clientX - box.left) / box.width) * SPAN;
  };

  // Dragging along the hour ruler rewinds the day.
  const scrub = (e: React.PointerEvent) => {
    const m = Math.max(DAY_START, Math.min(minuteAt(e.clientX), liveMinute));
    // Close enough to now counts as now.
    onScrub(liveMinute - m < 3 ? null : m);
  };

  // Start dragging a case. We remember where the mouse grabbed it.
  const grab = (e: React.PointerEvent, c: Case) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const canMove = c.status === 'scheduled' && !travelling;
    const grabOffset = minuteAt(e.clientX) - c.start;
    const startX = e.clientX;
    const startY = e.clientY;
    let latest: Drag = { id: c.id, roomId: c.roomId, start: c.start, ok: true, moved: false };
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!canMove) return;
      if (!latest.moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
      const box = lanes.current!.getBoundingClientRect();
      const row = Math.max(0, Math.min(state.rooms.length - 1, Math.floor(((ev.clientY - box.top) / box.height) * state.rooms.length)));
      const roomId = state.rooms[row].id;
      // Snap to 5 minutes. Never earlier than now. Never off the end of the board.
      const earliest = Math.ceil((liveMinute + 1) / 5) * 5;
      const start = Math.max(earliest, Math.min(BOARD_END - c.duration, Math.round((minuteAt(ev.clientX) - grabOffset) / 5) * 5));
      const end = start + c.duration;
      const ok = index.inRoom(roomId, start, end, c.id).length === 0 && index.forSurgeon(c.surgeonId, start, end, c.id).length === 0;
      latest = { id: c.id, roomId, start, ok, moved: true };
      setDrag(latest);
    };
    const drop = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', drop);
      el.removeEventListener('pointercancel', drop);
      setDrag(null);
      // A click without a drag just opens the case.
      if (!latest.moved) return onSelect(selectedId === c.id ? null : c.id);
      if (latest.roomId !== c.roomId || latest.start !== c.start) onMove(c.id, latest.roomId, latest.start);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  };

  const rowOf = (roomId: string) => state.rooms.findIndex((r) => r.id === roomId);
  const rowTop = (roomId: string) => `${(rowOf(roomId) / state.rooms.length) * 100}%`;
  const rowHeight = `${100 / state.rooms.length}%`;

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div className="timeline-inner">
          <div className="ruler-row">
            <div className="room-label ruler-label">Rewind</div>
            <div
              className="ruler"
              role="slider"
              tabIndex={0}
              aria-label="Rewind the day"
              aria-valuemin={DAY_START}
              aria-valuemax={Math.floor(liveMinute)}
              aria-valuenow={Math.floor(shown)}
              aria-valuetext={clockText(shown)}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                scrub(e);
              }}
              onPointerMove={(e) => e.buttons === 1 && scrub(e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') onScrub(Math.max(DAY_START, shown - 5));
                if (e.key === 'ArrowRight') onScrub(shown + 5 >= liveMinute ? null : shown + 5);
                if (e.key === 'Escape' || e.key === 'End') onScrub(null);
              }}
            >
              {HOURS.slice(0, -1).map((h) => (
                <span key={h} className="hour" style={{ left: `${x(h)}%` }}>
                  {clockText(h)}
                </span>
              ))}
              <span className="played" style={{ width: `${x(Math.min(liveMinute, BOARD_END))}%` }} />
            </div>
          </div>

          <div className="lanes-row">
            <div className="labels">
              {state.rooms.map((room) => (
                <div key={room.id} className="room-label">
                  <strong>{room.name}</strong>
                  <span>{room.specialty}</span>
                </div>
              ))}
            </div>

            <div className="lanes" ref={lanes} style={{ height: state.rooms.length * 58 }} onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
              {/* Faint stripes, one per room, and a tint for overtime. */}
              {state.rooms.map((room, i) => (
                <div key={room.id} className="lane" style={{ top: rowTop(room.id), height: rowHeight }} data-odd={i % 2} />
              ))}
              <div className="overtime" style={{ left: `${x(DAY_END)}%` }}>
                <span>after 17:00</span>
              </div>

              {/* Dashed outlines show where bumped cases used to be. */}
              {ghosts.map((g) => (
                <div
                  key={`ghost-${g.id}`}
                  className="ghost"
                  style={{ top: rowTop(g.roomId), height: rowHeight, left: `${x(g.start)}%`, width: `${x(g.end) - x(g.start)}%` }}
                />
              ))}

              {cases.map((c) => {
                const d = drag && drag.id === c.id && drag.moved ? drag : null;
                const roomId = d ? d.roomId : c.roomId;
                const start = d ? d.start : c.start;
                const end = d ? d.start + c.duration : c.end;
                if (rowOf(roomId) === -1) return null;
                const late = c.start - c.plannedStart;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="case"
                    data-status={c.status}
                    data-priority={c.priority}
                    data-selected={selectedId === c.id}
                    data-dragging={d ? (d.ok ? 'ok' : 'bad') : undefined}
                    data-waiting={c.status === 'scheduled' && c.start < shown - 1}
                    style={{ top: rowTop(roomId), height: rowHeight, left: `${x(start)}%`, width: `${Math.max(0.5, x(Math.min(end, BOARD_END)) - x(start))}%` }}
                    aria-label={`${c.procedure}, ${clockText(c.start)} to ${clockText(c.end)}, ${surgeonName(c.surgeonId)}, ${STATUS_WORD[c.status]}`}
                    onPointerDown={(e) => grab(e, c)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(selectedId === c.id ? null : c.id)}
                  >
                    <span className="case-body">
                      <span className="case-name">{c.procedure}</span>
                      <span className="case-meta">
                        {clockText(start)} {surgeonName(c.surgeonId)}
                      </span>
                    </span>
                    {late >= 5 && c.status === 'scheduled' && !d && <span className="late">+{late}</span>}
                  </button>
                );
              })}

              <div className="now" data-travelling={travelling} style={{ left: `${x(Math.min(shown, BOARD_END))}%` }}>
                <span>{clockText(shown)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="legend">
        <span data-k="scheduled">Scheduled</span>
        <span data-k="wheels_in">Wheels in</span>
        <span data-k="incision">Incision</span>
        <span data-k="closing">Closing</span>
        <span data-k="wheels_out">Done</span>
        <span data-k="emergency">Emergency</span>
        <span className="legend-tip">Drag a scheduled case to move it. Drag along the hours to rewind.</span>
      </div>
    </div>
  );
}
