import { describe, expect, it } from "vitest";
import { createRng } from "../src/domain/rng";

describe("seeded rng", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createRng(20260620);
    const b = createRng(20260620);
    expect(Array.from({ length: 12 }, () => a.nextUint32())).toEqual(Array.from({ length: 12 }, () => b.nextUint32()));
  });

  it("changes sequence for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 6 }, () => a.nextUint32())).not.toEqual(Array.from({ length: 6 }, () => b.nextUint32()));
  });
});
