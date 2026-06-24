import { describe, expect, it } from "vitest";
import { resolveBattle } from "../src/domain/battleEngine";
import type { BattleOutput, BattleUnit } from "../src/domain/types";
import { BATTLE_GOLDEN_FIXTURES, type BattleGoldenExpectation } from "./fixtures/battleGoldenFixtures";

function unitSummary(units: readonly BattleUnit[]): string {
  return units
    .map((unit) => [
      unit.unitId,
      unit.speciesId,
      unit.health,
      unit.maxHealth,
      unit.attack,
      unit.shield,
      unit.position,
      unit.retreated ? "R" : "A",
      unit.statuses.map((status) => status.kind).join("+") || "-",
    ].join(":"))
    .join("|");
}

function summarize(output: BattleOutput): BattleGoldenExpectation {
  return {
    result: output.result,
    eventTypes: output.events.map((event) => event.type).join(">"),
    eventCount: output.events.length,
    finalPlayer: unitSummary(output.finalPlayerUnits),
    finalOpponent: unitSummary(output.finalOpponentUnits),
    diagnostics: output.diagnostics,
  };
}

describe("P5A golden battle fixtures", () => {
  it("keeps 15-25 deterministic fixtures covering current battle behavior", () => {
    expect(BATTLE_GOLDEN_FIXTURES.length).toBeGreaterThanOrEqual(15);
    expect(BATTLE_GOLDEN_FIXTURES.length).toBeLessThanOrEqual(25);
    expect(new Set(BATTLE_GOLDEN_FIXTURES.map((fixture) => fixture.id)).size).toBe(BATTLE_GOLDEN_FIXTURES.length);
    const coverage = new Set(BATTLE_GOLDEN_FIXTURES.flatMap((fixture) => fixture.covers));
    for (const required of ["startEffect", "beforeAttack", "skillDamage", "onHurt", "retreatChain", "movement", "equipment", "draw"]) {
      expect(coverage.has(required), required).toBe(true);
    }
  });

  it.each(BATTLE_GOLDEN_FIXTURES)("$id: $titleZh", (fixture) => {
    const output = resolveBattle(fixture.input);

    expect(summarize(output)).toEqual(fixture.expected);
    expect(resolveBattle(fixture.input)).toEqual(output);
  });

  it("adds phase and grouping schema without presentation timing", () => {
    for (const fixture of BATTLE_GOLDEN_FIXTURES) {
      const output = resolveBattle(fixture.input);
      for (const event of output.events) {
        expect(event.phaseId, `${fixture.id}:${event.sequence}:${event.type}`).toBeTruthy();
        expect(event).not.toHaveProperty("startMs");
        expect(event).not.toHaveProperty("durationMs");
      }
    }
  });

  it("tags normal attack damage events with their simultaneous group", () => {
    const output = resolveBattle(BATTLE_GOLDEN_FIXTURES.find((fixture) => fixture.id === "golden_01_basic_draw")!.input);
    const normalDamage = output.events.filter((event) => event.type === "damageApplied" && event.metadata.damageKind === "normalAttack");

    expect(normalDamage.slice(0, 2).map((event) => event.simultaneousGroupId)).toEqual(["x1", "x1"]);
    expect(normalDamage.slice(0, 2).map((event) => event.exchangeId)).toEqual(["x1", "x1"]);
  });
});
