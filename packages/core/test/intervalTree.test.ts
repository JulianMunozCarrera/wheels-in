import { describe, expect, it } from 'vitest';
import { IntervalTree, MinHeap, rng } from '../src';

describe('IntervalTree', () => {
  it('finds blocks that touch a time range', () => {
    const t = new IntervalTree();
    t.insert('a', 10, 20);
    t.insert('b', 20, 30);
    t.insert('c', 25, 40);
    expect(t.search(15, 22).sort()).toEqual(['a', 'b']);
    // Sharing an edge is not touching.
    expect(t.search(20, 25)).toEqual(['b']);
    expect(t.search(40, 50)).toEqual([]);
  });

  it('forgets a block after remove', () => {
    const t = new IntervalTree();
    t.insert('a', 10, 20);
    t.insert('b', 10, 20);
    t.remove('a');
    expect(t.search(0, 100)).toEqual(['b']);
    expect(t.size).toBe(1);
  });

  it('agrees with the slow and obvious way on 2000 random steps', () => {
    const r = rng(7);
    const t = new IntervalTree();
    const plain = new Map<string, [number, number]>();
    for (let step = 0; step < 2000; step++) {
      const id = `k${Math.floor(r() * 60)}`;
      if (r() < 0.3) {
        t.remove(id);
        plain.delete(id);
      } else {
        const start = Math.floor(r() * 500);
        const end = start + 1 + Math.floor(r() * 80);
        t.insert(id, start, end);
        plain.set(id, [start, end]);
      }
      const qs = Math.floor(r() * 500);
      const qe = qs + 1 + Math.floor(r() * 100);
      const want = [...plain].filter(([, [s, e]]) => s < qe && qs < e).map(([k]) => k).sort();
      expect(t.search(qs, qe).sort()).toEqual(want);
    }
  });
});

describe('MinHeap', () => {
  it('hands back numbers smallest first', () => {
    const r = rng(3);
    const h = new MinHeap<number>((a, b) => a < b);
    const nums = Array.from({ length: 300 }, () => Math.floor(r() * 1000));
    nums.forEach((n) => h.push(n));
    const out: number[] = [];
    while (h.size) out.push(h.pop()!);
    expect(out).toEqual([...nums].sort((a, b) => a - b));
  });
});
