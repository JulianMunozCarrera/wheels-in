import { hash } from './intervalTree';
import { repair } from './repair';
import { DAY_END, FIRST_CASE, type Case, type EventBody, type Priority, type Room, type Surgeon } from './types';

// A tiny random number maker. Same seed in, same numbers out.
// That means every fake hospital day can be replayed exactly.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length)];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// Each room does one kind of surgery. [name, usual minutes]
const MENU: Record<string, [string, number][]> = {
  Orthopedics: [['Total knee replacement', 120], ['Total hip replacement', 110], ['ACL reconstruction', 90], ['Rotator cuff repair', 100], ['Ankle fracture fixation', 80]],
  General: [['Laparoscopic cholecystectomy', 75], ['Inguinal hernia repair', 60], ['Bowel resection', 180], ['Appendectomy', 55], ['Thyroidectomy', 110]],
  Cardiac: [['Coronary artery bypass', 240], ['Aortic valve replacement', 210], ['Pacemaker insertion', 70]],
  Neurosurgery: [['Craniotomy for tumor', 240], ['Lumbar discectomy', 100], ['Spinal fusion', 200], ['VP shunt placement', 80]],
  Urology: [['TURP', 60], ['Nephrectomy', 150], ['Cystoscopy', 30], ['Ureteroscopy', 50]],
  ENT: [['Tonsillectomy', 40], ['Septoplasty', 60], ['Tympanoplasty', 90], ['Sinus surgery', 80]],
};

// What walks in through the emergency doors.
export const EMERGENCIES: [string, number][] = [
  ['Trauma laparotomy', 110],
  ['Ruptured appendix', 65],
  ['Open fracture washout', 90],
  ['Bowel obstruction', 120],
  ['Ruptured ectopic pregnancy', 60],
  ['Epidural hematoma evacuation', 100],
];

const ROOM_PLAN = ['Orthopedics', 'Orthopedics', 'General', 'General', 'Cardiac', 'Neurosurgery', 'Urology', 'ENT'];

// Made up names. No real people here.
const NAMES = ['Okafor', 'Lindqvist', 'Tanaka', 'Moreau', 'Haddad', 'Castellanos', 'Nowak', 'Achebe', 'Singh', 'Bergstrom', 'Park', 'Valdez', 'Ibrahim', 'Kowalczyk', 'Reyes', 'Fontaine'];
const LETTERS = 'ABCDEFGHJKLMNPRSTW';

// A fake patient tag like "R.T. 58". It is only two letters and an age.
function fakePatient(r: () => number): string {
  return `${LETTERS[Math.floor(r() * LETTERS.length)]}.${LETTERS[Math.floor(r() * LETTERS.length)]}. ${between(r, 19, 86)}`;
}

// Build a whole fake hospital day from one number.
export function seedDay(seed: number): Extract<EventBody, { type: 'day_seeded' }> {
  const r = rng(seed);

  const rooms: Room[] = ROOM_PLAN.map((specialty, i) => ({ id: `or${i + 1}`, name: `OR ${i + 1}`, specialty }));

  // Two surgeons for each kind of surgery, plus two on call for emergencies.
  const names = [...NAMES].sort(() => r() - 0.5);
  const surgeons: Surgeon[] = [];
  for (const specialty of Object.keys(MENU)) {
    for (let k = 0; k < 2; k++) {
      surgeons.push({ id: `s${surgeons.length + 1}`, name: `Dr. ${names[surgeons.length]}`, specialty, onCall: false });
    }
  }
  for (let k = 0; k < 2; k++) {
    surgeons.push({ id: `s${surgeons.length + 1}`, name: `Dr. ${names[surgeons.length]}`, specialty: 'Trauma', onCall: true });
  }

  const cases: Case[] = [];
  const roomsSeen: Record<string, number> = {};
  rooms.forEach((room, roomIndex) => {
    const team = surgeons.filter((s) => s.specialty === room.specialty);
    // The two rooms of one specialty swap surgeons at lunch.
    // So a late morning in one room can hurt the afternoon in the other.
    const nth = (roomsSeen[room.specialty] = (roomsSeen[room.specialty] ?? 0) + 1) - 1;
    const morning = team[nth % 2];
    const afternoon = team[(nth + 1) % 2];

    let clock = FIRST_CASE;
    let count = 0;
    while (clock < DAY_END - 60) {
      const fits = MENU[room.specialty].filter(([, mins]) => clock + mins <= DAY_END + 20);
      if (fits.length === 0) break;
      const [procedure, usual] = pick(r, fits);
      // Round to 5 minutes so the board looks like a real schedule.
      const duration = Math.round((usual * (0.9 + r() * 0.2)) / 5) * 5;
      const priority: Priority = r() < 0.15 ? 'urgent' : 'elective';
      count++;
      cases.push({
        id: `C${roomIndex + 1}${String(count).padStart(2, '0')}`,
        roomId: room.id,
        surgeonId: clock < 12 * 60 + 30 ? morning.id : afternoon.id,
        procedure,
        patient: fakePatient(r),
        start: clock,
        end: clock + duration,
        plannedStart: clock,
        duration,
        status: 'scheduled',
        priority,
        version: 1,
        times: {},
      });
      clock += duration + pick(r, [20, 25, 30]);
    }
  });

  // The lunch swap can leave a surgeon in two rooms at once.
  // Run the repair tool once so the day starts with no overlaps.
  for (const m of repair(cases, cases.map((c) => c.id))) {
    const c = cases.find((x) => x.id === m.id)!;
    c.start = c.plannedStart = m.start;
    c.end = m.end;
  }

  return { type: 'day_seeded', seed, rooms, surgeons, cases };
}

// The hidden truth about how a case will really go.
// The board does not know this. It finds out minute by minute, like a real day.
export function truthFor(seed: number, c: Pick<Case, 'id' | 'duration' | 'priority'>) {
  const r = rng(hash(`${seed}:${c.id}`));
  const late = c.priority === 'emergency' || r() < 0.6 ? 0 : between(r, 3, 18);
  const prep = between(r, 10, 20);
  const close = between(r, 8, 16);
  // Most cases run close to plan. One in five runs long.
  const stretch = r() < 0.2 ? 1.15 + r() * 0.3 : 0.88 + r() * 0.2;
  const cut = Math.max(8, Math.round(c.duration * stretch) - prep - close);
  return { late, prep, cut, close };
}

// The minutes when an emergency will arrive on this day.
export function emergencyMinutes(seed: number): number[] {
  const r = rng(hash(`emergencies:${seed}`));
  const count = 2 + (r() < 0.5 ? 1 : 0);
  const out = new Set<number>();
  while (out.size < count) out.add(between(r, 9 * 60, 15 * 60 + 30));
  return [...out].sort((a, b) => a - b);
}

// Make a fresh emergency case. It has no room yet. The bump planner picks one.
export function newEmergency(id: string): Case {
  const r = rng(hash(id));
  const [procedure, duration] = pick(r, EMERGENCIES);
  return {
    id,
    roomId: '',
    surgeonId: '',
    procedure,
    patient: fakePatient(r),
    start: 0,
    end: duration,
    plannedStart: 0,
    duration,
    status: 'scheduled',
    priority: 'emergency',
    version: 1,
    times: {},
  };
}
