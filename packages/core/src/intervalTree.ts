// An interval tree. It answers one question fast:
// "which cases touch this slice of time?"
//
// It is a treap. That is a search tree that keeps itself balanced
// by giving every node a random looking number (its priority).
// Every node also remembers the latest end time below it (maxEnd).
// That lets us skip whole branches that end too early to matter.

interface Node {
  id: string;
  start: number;
  end: number;
  pri: number;
  maxEnd: number;
  left: Node | null;
  right: Node | null;
}

// Turn a string into a number. Same string always gives the same number.
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Fix maxEnd after the children changed.
function update(n: Node): Node {
  n.maxEnd = Math.max(n.end, n.left ? n.left.maxEnd : -Infinity, n.right ? n.right.maxEnd : -Infinity);
  return n;
}

// Is node a before the key (start, id)?
function before(a: Node, start: number, id: string): boolean {
  return a.start < start || (a.start === start && a.id < id);
}

// Cut the tree in two: everything before the key, and everything else.
function split(n: Node | null, start: number, id: string): [Node | null, Node | null] {
  if (!n) return [null, null];
  if (before(n, start, id)) {
    const [a, b] = split(n.right, start, id);
    n.right = a;
    return [update(n), b];
  }
  const [a, b] = split(n.left, start, id);
  n.left = b;
  return [a, update(n)];
}

// Glue two trees together. Everything in a must come before everything in b.
function merge(a: Node | null, b: Node | null): Node | null {
  if (!a) return b;
  if (!b) return a;
  if (a.pri > b.pri) {
    a.right = merge(a.right, b);
    return update(a);
  }
  b.left = merge(a, b.left);
  return update(b);
}

export class IntervalTree {
  private root: Node | null = null;
  // Remember where each id sits so we can remove it later.
  private where = new Map<string, { start: number; end: number }>();

  get size(): number {
    return this.where.size;
  }

  has(id: string): boolean {
    return this.where.has(id);
  }

  // Add a block of time. If the id is already here, it is replaced.
  insert(id: string, start: number, end: number): void {
    if (this.where.has(id)) this.remove(id);
    const node: Node = { id, start, end, pri: hash(id), maxEnd: end, left: null, right: null };
    const [a, b] = split(this.root, start, id);
    this.root = merge(merge(a, node), b);
    this.where.set(id, { start, end });
  }

  // Take a block out.
  remove(id: string): void {
    const spot = this.where.get(id);
    if (!spot) return;
    const [a, rest] = split(this.root, spot.start, id);
    // The node we want is now the very first one in rest. Cut it off.
    const [, b] = split(rest, spot.start, id + '\u0000');
    this.root = merge(a, b);
    this.where.delete(id);
  }

  // Give back every id whose time touches [start, end).
  // Two blocks that only share an edge do not touch.
  search(start: number, end: number): string[] {
    const found: string[] = [];
    const walk = (n: Node | null) => {
      // Nothing down here ends late enough. Skip the whole branch.
      if (!n || n.maxEnd <= start) return;
      walk(n.left);
      // This node starts too late, and so does everything to its right.
      if (n.start >= end) return;
      if (n.end > start) found.push(n.id);
      walk(n.right);
    };
    walk(this.root);
    return found;
  }
}
