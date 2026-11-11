import { isRunning, type BoardState } from './types';

export interface Stats {
  firstOnTime: number; // first cases of the day that started on time
  firstStarted: number; // first cases that have started at all
  roomsRunning: number;
  roomsTotal: number;
  done: number;
  total: number;
  behind: number; // average minutes late, over cases that are late
  emergencies: number;
}

// A first case counts as on time if it starts within this many minutes.
const GRACE = 5;

// The numbers across the top of the board.
export function computeStats(state: BoardState): Stats {
  const cases = Object.values(state.cases).filter((c) => c.status !== 'cancelled');
  let firstOnTime = 0;
  let firstStarted = 0;
  let roomsRunning = 0;

  for (const room of state.rooms) {
    const mine = cases.filter((c) => c.roomId === room.id && c.priority !== 'emergency');
    if (cases.some((c) => c.roomId === room.id && isRunning(c.status))) roomsRunning++;
    const first = mine.sort((a, b) => a.plannedStart - b.plannedStart)[0];
    if (first && first.times.wheels_in !== undefined) {
      firstStarted++;
      if (first.times.wheels_in - first.plannedStart <= GRACE) firstOnTime++;
    }
  }

  const late = cases.filter((c) => c.status !== 'wheels_out' && c.start - c.plannedStart > 0);
  const behind = late.length ? Math.round(late.reduce((sum, c) => sum + (c.start - c.plannedStart), 0) / late.length) : 0;

  return {
    firstOnTime,
    firstStarted,
    roomsRunning,
    roomsTotal: state.rooms.length,
    done: cases.filter((c) => c.status === 'wheels_out').length,
    total: cases.length,
    behind,
    emergencies: cases.filter((c) => c.priority === 'emergency').length,
  };
}

// Turn 450 into "07:30".
export function clockText(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
