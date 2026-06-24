import { describe, expect, it } from "vitest";
import { BoardMutationService, combatSideForSlot, slotForSidePosition } from "../src/domain/battleBoard";
import type { BattleSlot, BattleUnit, Side, SpeciesId } from "../src/domain/types";

function unit(unitId: string, side: Side, position: number, speciesId: SpeciesId = "frog"): BattleUnit {
  const slot = slotForSidePosition(side, position);
  return {
    unitId,
    side: combatSideForSlot(slot),
    originOwner: side,
    slot,
    speciesId,
    level: 1,
    attack: 3,
    health: 4,
    maxHealth: 4,
    shield: 0,
    position,
    triggerCounts: {},
    statuses: [],
    retreated: false,
  };
}

function ids(units: readonly BattleUnit[]): string {
  return units.map((item) => `${item.unitId}@${item.slot}:${item.position}:${item.side}:${item.originOwner}`).join("|");
}

function uniqueActiveSlots(units: readonly BattleUnit[]): boolean {
  const slots = units.filter((item) => !item.retreated).map((item) => item.slot);
  return new Set(slots).size === slots.length;
}

function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0;
}

describe("P5C BoardMutationService", () => {
  it("maps input positions to global fixed slots and derives combat side from slot", () => {
    expect(slotForSidePosition("player", 0)).toBe("L0");
    expect(slotForSidePosition("player", 4)).toBe("L4");
    expect(slotForSidePosition("opponent", 0)).toBe("R0");
    expect(slotForSidePosition("opponent", 4)).toBe("R4");
    expect(combatSideForSlot("L2")).toBe("player");
    expect(combatSideForSlot("R2")).toBe("opponent");
  });

  it("preserves existing same-side after-attack move and promoted ally cases", () => {
    const units = [unit("frog", "player", 0), unit("weasel", "player", 1, "weasel"), unit("enemy", "opponent", 0, "mussel")];
    const board = new BoardMutationService(units);
    const result = board.moveWithinSide("frog", 1);

    expect(result.ok).toBe(true);
    expect(result.moved.map((item) => `${item.unit.unitId}:${item.beforePosition}->${item.afterPosition}`)).toEqual(["weasel:1->0", "frog:0->1"]);
    expect(units.find((item) => item.unitId === "frog")?.slot).toBe("L1");
    expect(units.find((item) => item.unitId === "weasel")?.slot).toBe("L0");
    expect(uniqueActiveSlots(units)).toBe(true);
  });

  it("supports same-side swap, push, pull, and compaction without cross-side movement", () => {
    const units = [unit("a", "player", 0), unit("b", "player", 2), unit("c", "player", 4), unit("x", "opponent", 0)];
    const board = new BoardMutationService(units);

    expect(board.swap("L0", "L2").ok).toBe(true);
    expect(units.find((item) => item.unitId === "a")?.slot).toBe("L2");
    expect(board.push("b").ok).toBe(true);
    expect(board.pull("c").ok).toBe(true);
    expect(board.swap("L0", "R0").ok).toBe(false);
    expect(board.move("a", "R1").ok).toBe(false);

    units.find((item) => item.unitId === "b")!.retreated = true;
    const compacted = board.compact("player");
    expect(compacted.ok).toBe(true);
    expect(board.activeSideSlots("player")).toEqual(["L0", "L1"]);
    expect(uniqueActiveSlots(units)).toBe(true);
  });

  it("rejects duplicate active occupancy", () => {
    const units = [unit("a", "player", 0), unit("b", "player", 0)];
    const result = new BoardMutationService(units).validateOccupancy();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("occupy L0");
  });

  it("keeps unit ids stable and deterministic under randomized same-side mutations", () => {
    const run = (seed: number): string => {
      const units = [
        unit("p0", "player", 0),
        unit("p1", "player", 1),
        unit("p2", "player", 3),
        unit("o0", "opponent", 0),
        unit("o1", "opponent", 2),
      ];
      const originalIds = units.map((item) => item.unitId).join("|");
      const board = new BoardMutationService(units);
      let current = seed;
      for (let i = 0; i < 200; i += 1) {
        current = nextSeed(current);
        const active = units.filter((item) => !item.retreated);
        const selected = active[current % active.length];
        const op = current % 5;
        if (op === 0) board.push(selected.unitId);
        if (op === 1) board.pull(selected.unitId);
        if (op === 2) board.moveWithinSide(selected.unitId, (current % 3) - 1);
        if (op === 3) {
          const slots = board.activeSideSlots(selected.side);
          if (slots.length >= 2) board.swap(slots[0], slots[slots.length - 1] as BattleSlot);
        }
        if (op === 4) board.compact(selected.side);
        expect(board.validateOccupancy().ok).toBe(true);
        expect(uniqueActiveSlots(units)).toBe(true);
        expect(units.map((item) => item.unitId).join("|")).toBe(originalIds);
        for (const item of units) expect(item.side).toBe(combatSideForSlot(item.slot));
      }
      return ids(units);
    };

    for (let seed = 1; seed <= 40; seed += 1) {
      expect(run(seed)).toBe(run(seed));
    }
  });
});
