import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveBattle } from "../src/domain/battleEngine";
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
      for (const unit of [...output.finalPlayerUnits, ...output.finalOpponentUnits]) {
        expect(Number.isNaN(unit.health)).toBe(false);
        expect(unit.shield).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("规则层源码不 import React、DOM、storage 或浏览器 API", () => {
    const files = readdirSync("src/domain").filter((file) => file.endsWith(".ts"));
    const source = files.map((file) => readFileSync(join("src/domain", file), "utf8")).join("\n");
    expect(source).not.toMatch(/from ["']react|from ["'].*storage|localStorage|document|window|Math\.random|Date\.now|fetch\(/);
  });
});
