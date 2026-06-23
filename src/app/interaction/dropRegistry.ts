import type { PointerBounds, PointerPoint } from "./gestureTypes";

export interface DropRegistryEntry<TTarget> {
  id: string;
  target: TTarget;
  getBounds: () => PointerBounds | null;
}

export interface DropRegistry<TTarget> {
  register: (entry: DropRegistryEntry<TTarget>) => () => void;
  targetAt: (point: PointerPoint) => TTarget | null;
  clear: () => void;
}

function contains(bounds: PointerBounds, point: PointerPoint): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

export function createDropRegistry<TTarget>(): DropRegistry<TTarget> {
  const entries: DropRegistryEntry<TTarget>[] = [];
  return {
    register(entry) {
      const existing = entries.findIndex((candidate) => candidate.id === entry.id);
      if (existing >= 0) entries.splice(existing, 1);
      entries.push(entry);
      return () => {
        const index = entries.findIndex((candidate) => candidate.id === entry.id);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    targetAt(point) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const bounds = entries[index].getBounds();
        if (bounds && contains(bounds, point)) return entries[index].target;
      }
      return null;
    },
    clear() {
      entries.length = 0;
    },
  };
}
