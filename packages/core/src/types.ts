// All times are minutes since midnight. 450 means 7:30 in the morning.

// A case walks through these steps in order.
export type Status = 'scheduled' | 'wheels_in' | 'incision' | 'closing' | 'wheels_out' | 'cancelled';

export type Priority = 'elective' | 'urgent' | 'emergency';

export interface Room {
  id: string;
  name: string;
  specialty: string;
}

export interface Surgeon {
  id: string;
  name: string;
  specialty: string;
  // On call surgeons take the emergencies.
  onCall: boolean;
}

// One surgery on the board.
export interface Case {
  id: string;
  roomId: string;
  surgeonId: string;
  procedure: string;
  patient: string;
  // Where the block sits right now.
  start: number;
  end: number;
  // Where the block was first promised. We use this to measure delays.
  plannedStart: number;
  // How long the surgery should take.
  duration: number;
  status: Status;
  priority: Priority;
  // Goes up by one on every change. Stops two people from editing the same case.
  version: number;
  // The minute each step really happened.
  times: Partial<Record<Status, number>>;
}

// Why a block moved.
export type MoveReason = 'manual' | 'bump' | 'overrun' | 'late' | 'finish';

// Everything that can happen on the board. The list of these IS the database.
export type EventBody =
  | { type: 'day_seeded'; seed: number; rooms: Room[]; surgeons: Surgeon[]; cases: Case[] }
  | { type: 'case_booked'; case: Case }
  | { type: 'case_moved'; id: string; roomId: string; start: number; end: number; reason: MoveReason; cause?: string }
  | { type: 'case_status'; id: string; status: Status }
  | { type: 'case_cancelled'; id: string };

// An event after it was saved. seq is its place in line. at is the board time.
export type BoardEvent = EventBody & { seq: number; at: number };

export interface BoardState {
  seed: number;
  rooms: Room[];
  surgeons: Surgeon[];
  cases: Record<string, Case>;
}

// A place a case can sit.
export interface Slot {
  roomId: string;
  start: number;
  end: number;
}

// Rules of the hospital day.
export const DAY_START = 7 * 60; // board opens at 7:00
export const FIRST_CASE = 7 * 60 + 30; // first cut of the day
export const DAY_END = 17 * 60; // staff should go home at 17:00
export const BOARD_END = 21 * 60; // the board stops drawing at 21:00
export const TURNOVER = 15; // minutes to clean a room between cases
export const SURGEON_GAP = 10; // minutes a surgeon needs between two cases
export const PREP = 10; // minutes to get an emergency patient to the room

// A rule was broken. The code tells the app what kind of rule.
export class RuleError extends Error {
  constructor(public code: 'conflict' | 'stale' | 'not_found' | 'locked' | 'bad_input', message: string) {
    super(message);
  }
}

export const isRunning = (s: Status) => s === 'wheels_in' || s === 'incision' || s === 'closing';
export const isDone = (s: Status) => s === 'wheels_out' || s === 'cancelled';
