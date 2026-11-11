// A min heap. You put things in, and it always hands back the smallest one first.
// We use it to fix the schedule in time order.

export class MinHeap<T> {
  private items: T[] = [];

  // smaller(a, b) should say true when a comes before b.
  constructor(private smaller: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    // Bubble the new item up until its parent is smaller.
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.smaller(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      // Put the last item on top, then sink it down to its place.
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < a.length && this.smaller(a[l], a[best])) best = l;
        if (r < a.length && this.smaller(a[r], a[best])) best = r;
        if (best === i) break;
        [a[i], a[best]] = [a[best], a[i]];
        i = best;
      }
    }
    return top;
  }
}
