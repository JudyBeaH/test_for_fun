import { describe, expect, it } from "vitest";
import { resolveBattle } from "../src/domain/battleEngine";
import { compileBattleCues, formatBattleCueTimeline } from "../src/presentation/battleCueCompiler";
import { BATTLE_GOLDEN_FIXTURES } from "./fixtures/battleGoldenFixtures";

function fixtureOutput(id: string) {
  const fixture = BATTLE_GOLDEN_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return resolveBattle(fixture.input);
}

describe("P5E battle cue compiler", () => {
  it("compiles deterministic skippable cues without mutating BattleOutput or adding timing", () => {
    const output = fixtureOutput("golden_08_after_attack_move");
    const before = structuredClone(output);
    const first = compileBattleCues(output.events);
    const second = compileBattleCues(output.events);

    expect(second).toEqual(first);
    expect(output).toEqual(before);
    expect(first.every((cue) => cue.isSkippable)).toBe(true);
    for (const cue of first) {
      expect(cue).not.toHaveProperty("startMs");
      expect(cue).not.toHaveProperty("durationMs");
    }
  });

  it("snapshots paired windup, simultaneous impact, and retreat", () => {
    const timeline = formatBattleCueTimeline(compileBattleCues(fixtureOutput("golden_01_basic_draw").events));

    expect(timeline).toMatchInlineSnapshot(`
      "[01] 入场 phase=setup events=battleStarted
      [02] 环境 phase=environment batch=env-1 events=environmentApplied
      [03] x1 锁定攻击者 phase=exchangeStart exchange=x1 batch=x1-lock events=attackWindup+attackWindup
      [04] x1 成对冲击 phase=impact exchange=x1 simultaneous=x1 events=attackExchange+damageApplied+damageApplied
      [05] x1 退场波 phase=retreat exchange=x1 batch=x1-retreat-1 events=unitRetreated+unitRetreated
      [06] 结算 phase=battleEnd events=battleEnded"
    `);
  });

  it("snapshots movement as a single cue inside the afterAttack batch", () => {
    const timeline = formatBattleCueTimeline(compileBattleCues(fixtureOutput("golden_08_after_attack_move").events));

    expect(timeline).toMatchInlineSnapshot(`
      "[01] 入场 phase=setup events=battleStarted
      [02] 环境 phase=environment batch=env-1 events=statModified+statModified+environmentApplied
      [03] x1 锁定攻击者 phase=exchangeStart exchange=x1 batch=x1-lock events=attackWindup+attackWindup
      [04] x1 成对冲击 phase=impact exchange=x1 simultaneous=x1 events=attackExchange+damageApplied+damageApplied
      [05] x1 受伤反应 phase=hurt exchange=x1 batch=x1-hurt-1 events=abilityTriggered+statModified
      [06] x1 攻击后 phase=afterAttack exchange=x1 batch=x1-after events=abilityTriggered
      [07] 移位 phase=afterAttack exchange=x1 batch=x1-after events=unitMoved+unitMoved
      [08] x1 攻击后 phase=afterAttack exchange=x1 batch=x1-after events=statModified
      [09] x2 锁定攻击者 phase=exchangeStart exchange=x2 batch=x2-lock events=attackWindup+attackWindup
      [10] x2 成对冲击 phase=impact exchange=x2 simultaneous=x2 events=attackExchange+shieldAbsorbed+damageApplied+damageApplied
      [11] x2 退场波 phase=retreat exchange=x2 batch=x2-retreat-1 events=unitRetreated
      [12] x2 攻击后 phase=afterAttack exchange=x2 batch=x2-after events=abilityTriggered+abilityNoTarget
      [13] 结算 phase=battleEnd events=battleEnded"
    `);
  });

  it("snapshots status, hurt waves, and chain retreats", () => {
    const timeline = formatBattleCueTimeline(compileBattleCues(fixtureOutput("golden_06_sleep_wake_empower").events));

    expect(timeline).toMatchInlineSnapshot(`
      "[01] 入场 phase=setup events=battleStarted
      [02] 环境 phase=environment batch=env-1 events=statModified+statModified+environmentApplied
      [03] x1 锁定攻击者 phase=exchangeStart exchange=x1 batch=x1-lock events=attackSkipped+attackWindup
      [04] x1 成对冲击 phase=impact exchange=x1 simultaneous=x1 events=attackExchange+damageApplied+statusConsumed
      [05] x1 受伤反应 phase=hurt exchange=x1 batch=x1-hurt-1 events=abilityTriggered+statModified
      [06] x2 锁定攻击者 phase=exchangeStart exchange=x2 batch=x2-lock events=attackWindup+attackWindup
      [07] x2 成对冲击 phase=impact exchange=x2 batch=x2-damage-snapshot simultaneous=x2 events=statusConsumed+attackExchange+damageApplied+shieldAbsorbed+damageApplied
      [08] x2 退场波 phase=retreat exchange=x2 batch=x2-retreat-1 events=unitRetreated
      [09] x3 锁定攻击者 phase=exchangeStart exchange=x3 batch=x3-lock events=attackWindup+attackWindup
      [10] x3 成对冲击 phase=impact exchange=x3 batch=x3-damage-snapshot simultaneous=x3 events=statusConsumed+attackExchange+damageApplied+damageApplied
      [11] x3 受伤反应 phase=hurt exchange=x3 batch=x3-hurt-1 events=abilityTriggered+statModified
      [12] x4 锁定攻击者 phase=exchangeStart exchange=x4 batch=x4-lock events=attackWindup+attackWindup
      [13] x4 成对冲击 phase=impact exchange=x4 batch=x4-damage-snapshot simultaneous=x4 events=statusConsumed+statusExpired+attackExchange+shieldAbsorbed+damageApplied+damageApplied
      [14] x4 退场波 phase=retreat exchange=x4 batch=x4-retreat-1 events=unitRetreated+unitRetreated
      [15] 结算 phase=battleEnd events=battleEnded"
    `);
  });
});
