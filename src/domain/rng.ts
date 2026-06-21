export interface Rng {
  nextUint32(): number;
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  fork(salt: number): Rng;
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const api: Rng = {
    nextUint32() {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    next() {
      return api.nextUint32() / 4294967296;
    },
    int(minInclusive, maxInclusive) {
      return minInclusive + Math.floor(api.next() * (maxInclusive - minInclusive + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      return items[api.int(0, items.length - 1)];
    },
    fork(salt) {
      return createRng((state ^ Math.imul(salt >>> 0, 2654435761)) >>> 0);
    },
  };
  return api;
}

export function shuffleDeterministic<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
