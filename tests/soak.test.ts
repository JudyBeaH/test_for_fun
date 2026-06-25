import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveBattle } from "../src/domain/battleEngine";
import { combatSideForSlot } from "../src/domain/battleBoard";
import { createExpedition } from "../src/domain/expeditionEngine";
import { battleInputForState } from "../src/sim/opponentGenerator";
import { runAutoCamp } from "../src/sim/autoPlayer";

describe("soak and boundaries", () => {
  it("1000 场随机战斗无异常、无 NaN、无负护盾、无重复事件序号", () => {
    for (let i = 0; i < 1000; i += 1) {
      let state = createExpedition(1000 + i);
      state = runAutoCamp(state);
      if (!state.formation.some(Boolean)) continue;
      const output = resolveBattle(battleInputForState(state));
      expect(new Set(output.events.map((event) => event.sequence)).size).toBe(output.events.length);
      const activeSlots = [...output.finalPlayerUnits, ...output.finalOpponentUnits].filter((unit) => !unit.retreated).map((unit) => unit.slot);
      expect(new Set(activeSlots).size).toBe(activeSlots.length);
      for (const event of output.events) expect(event.phaseId).toBeTruthy();
      for (const event of output.events.filter((item) => item.type === "damageApplied" && item.metadata.damageKind === "normalAttack")) {
        expect(event.exchangeId).toBeTruthy();
        expect(event.simultaneousGroupId).toBe(event.exchangeId);
      }
      for (const unit of [...output.finalPlayerUnits, ...output.finalOpponentUnits]) {
        expect(Number.isNaN(unit.health)).toBe(false);
        expect(unit.shield).toBeGreaterThanOrEqual(0);
        expect(unit.side).toBe(combatSideForSlot(unit.slot));
        expect(unit.originOwner).toMatch(/player|opponent/);
        expect(unit.unitId.startsWith(`${unit.originOwner}_`) || unit.unitId.startsWith(`summon_${unit.originOwner}_`)).toBe(true);
      }
    }
  }, 30000);

  it("规则层源码不 import React、DOM、storage 或浏览器 API", () => {
    const files = readdirSync("src/domain").filter((file) => file.endsWith(".ts"));
    const source = files.map((file) => readFileSync(join("src/domain", file), "utf8")).join("\n");
    expect(source).not.toMatch(/from ["']react|from ["'].*storage|localStorage|document|window|Math\.random|Date\.now|fetch\(/);
  });
});
