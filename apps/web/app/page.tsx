'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clockText, computeStats, replay, type Slot } from '@wheels-in/core';
import { BumpCard, CaseCard, Feed, StatsStrip } from '@/components/Panels';
import { Timeline } from '@/components/Timeline';
import { EMPTY, getClient, type BoardClient } from '@/lib/client';
import { buildFeed } from '@/lib/feed';

const REPO = 'https://github.com/JulianMunozCarrera/wheels-in';
const SPEEDS = [
  [30, 'Slow'],
  [60, 'Normal'],
  [240, 'Fast'],
] as const;

const nothing = () => () => {};
const empty = () => EMPTY;

export default function Page() {
  // The client only exists in the browser, so make it after the first paint.
  const [client, setClient] = useState<BoardClient | null>(null);
  useEffect(() => setClient(getClient()), []);
  const snap = useSyncExternalStore(client ? client.subscribe : nothing, client ? client.get : empty, empty);

  // Redraw four times a second so the clock line glides.
  const [, redraw] = useState(0);
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const liveMinute = snap.running && snap.ready ? snap.minute + (((performance.now() - snap.measuredAt) / 1000) * snap.speed) / 60 : snap.minute;

  // Time travel. null means "show now".
  const [viewAt, setViewAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [ghosts, setGhosts] = useState<(Slot & { id: string })[]>([]);

  // To see the past, replay only the events that happened before that minute.
  const shownState = useMemo(
    () => (viewAt === null ? snap.state : replay(snap.events.filter((e) => e.at <= viewAt))),
    [snap.state, snap.events, viewAt],
  );
  const shown = viewAt ?? liveMinute;
  const stats = useMemo(() => computeStats(shownState), [shownState]);
  const feed = useMemo(() => buildFeed(viewAt === null ? snap.events : snap.events.filter((e) => e.at <= viewAt), snap.state), [snap.events, snap.state, viewAt]);

  // When cases get bumped, leave a dashed outline where they used to be for a few seconds.
  const seen = useRef({ count: 0, state: snap.state });
  useEffect(() => {
    const { count, state: before } = seen.current;
    seen.current = { count: snap.events.length, state: snap.state };
    // A shorter list means a new day started. Clear everything tied to the old one.
    if (snap.events.length < count) {
      setViewAt(null);
      setSelectedId(null);
      setShowPlan(false);
      return;
    }
    if (count === 0) return;
    const fresh: (Slot & { id: string })[] = [];
    for (const ev of snap.events.slice(count)) {
      const old = ev.type === 'case_moved' && ev.reason === 'bump' ? before.cases[ev.id] : null;
      if (old) fresh.push({ id: old.id, roomId: old.roomId, start: old.start, end: old.end });
    }
    if (fresh.length === 0) return;
    setGhosts(fresh);
    const t = setTimeout(() => setGhosts([]), 6000);
    return () => clearTimeout(t);
  }, [snap.events, snap.state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const sendEmergency = async () => {
    if (!client) return;
    setViewAt(null);
    const problem = await client.emergency();
    if (problem) setToast(problem);
    else setShowPlan(true);
  };

  const moveCase = async (id: string, roomId: string, start: number) => {
    if (!client) return;
    const problem = await client.move(id, roomId, start);
    if (problem) setToast(problem);
  };

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <h1>Wheels In</h1>
          <p>
            A live operating room board.{' '}
            {snap.mode === 'demo' ? 'This demo hospital runs in your browser.' : snap.ready ? 'Shared live with everyone on this page.' : 'Connecting to the board.'}
          </p>
        </div>

        <div className="clock" data-travelling={viewAt !== null}>
          <span className="clock-time">{clockText(shown)}</span>
          <span className="clock-note">{viewAt !== null ? 'in the past' : snap.running ? 'board time' : 'paused'}</span>
        </div>

        <StatsStrip stats={stats} />

        <div className="controls">
          <button type="button" className="danger" onClick={sendEmergency} disabled={!snap.ready}>
            Send an emergency
          </button>
          <div className="control-row">
            <button type="button" onClick={() => client?.setRunning(!snap.running)} disabled={!snap.ready}>
              {snap.running ? 'Pause' : 'Play'}
            </button>
            <div className="segment" role="group" aria-label="Speed">
              {SPEEDS.map(([speed, label]) => (
                <button key={speed} type="button" aria-pressed={snap.speed === speed} onClick={() => client?.setSpeed(speed)} disabled={!snap.ready}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => client?.newDay()} disabled={!snap.ready}>
              New day
            </button>
          </div>
        </div>
      </header>

      <main className="deck">
        <div className="board">
          {viewAt !== null && (
            <div className="travel-bar" role="status">
              <span>
                You are looking at {clockText(viewAt)}. The real board is at {clockText(liveMinute)}.
              </span>
              <button type="button" onClick={() => setViewAt(null)}>
                Back to live
              </button>
            </div>
          )}
          {snap.ready || snap.events.length > 0 ? (
            <Timeline
              state={shownState}
              shown={shown}
              liveMinute={liveMinute}
              travelling={viewAt !== null}
              ghosts={viewAt === null ? ghosts : []}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={moveCase}
              onScrub={setViewAt}
            />
          ) : (
            <div className="waiting">{client && snap.mode === 'live' ? 'Can not reach the server yet. Trying again.' : 'Opening the board.'}</div>
          )}
        </div>

        <aside className="side">
          {showPlan && snap.lastPlan && viewAt === null && (
            <BumpCard plan={snap.lastPlan.plan} caseId={snap.lastPlan.caseId} state={snap.state} onClose={() => setShowPlan(false)} />
          )}
          {selectedId && <CaseCard id={selectedId} state={shownState} canDrag={viewAt === null} onClose={() => setSelectedId(null)} />}
          <Feed items={feed} />
        </aside>
      </main>

      <footer className="how">
        <div>
          <h2>No double bookings</h2>
          <p>
            Every change goes through one lock, and the database has its own rule that refuses two cases in one room at one time. I fired 100 bookings at
            the same slot from two servers. One wins, 99 get a clear no.
          </p>
        </div>
        <div>
          <h2>The trauma bump</h2>
          <p>
            Send an emergency and the planner tries every room, works out who would get pushed, and scores the pain. An interval tree finds the clashes and a
            heap fixes them in time order.
          </p>
        </div>
        <div>
          <h2>Time travel</h2>
          <p>
            Nothing is ever overwritten. The board is just a list of events played in order, so dragging along the hours replays the day up to that minute.
          </p>
        </div>
        <p className="credit">
          Built by Julian Munoz. Every patient and surgeon here is made up. <a href={REPO}>Read the code on GitHub</a>
        </p>
      </footer>

      <div className="toast" role="status" aria-live="polite" data-show={toast !== null}>
        {toast}
      </div>
    </div>
  );
}
