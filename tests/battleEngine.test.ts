import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ENGINE_VERSION } from "../src/content/constants";
import { resolveBattle } from "../src/domain/battleEngine";
import type { BattleInput, SpeciesId, TeamSnapshot } from "../src/domain/types";

function snap(ids: SpeciesId[], opts: Partial<{ sleepFirst: boolean; slingFirst: boolean }> = {}): TeamSnapshot {
  return {
    units: ids.map((speciesId, position) => ({
      snapshotUnitId: `${speciesId}_${position}`,
      speciesId,
      position,
      bondXp: 1,
      level: 1,
      initialAttack: speciesId === "weasel" ? 6 : speciesId === "mussel" ? 2 : 3,
      initialMaxHealth: speciesId === "pangolin" ? 8 : speciesId === "mussel" ? 6 : 5,
      equipmentEffect: opts.slingFirst && position === 0 ? { itemId: "pinecone_sling", initialAttackBonus: 1, initialHealthBonus: 0, battleStartDamage: 2 } : null,
      startingStatuses: opts.sleepFirst && position === 0 ? [{ statusId: "sleep", def: { kind: "sleepThenEmpower", remainingParticipatingBattles: 1, sleeping: true, bonusDamagePerAttack: 5, bonusAttackChargesAfterWake: 3 } }] : [],
    })),
  };
}

function input(player: TeamSnapshot, opponent: TeamSnapshot, seed = 1): BattleInput {
  return { battleId: `b_${seed}`, playerTeam: player, opponentTeam: opponent, environmentId: "wetland_channel", seed, engineVersion: ENGINE_VERSION, contentVersion: CONTENT_VERSION };
}

describe("v0.2 battle engine", () => {
  it("相同 BattleInput 产生等价输出", () => {
    const battle = input(snap(["frog", "otter"]), snap(["mussel", "hedgehog"]), 42);
    expect(resolveBattle(battle)).toEqual(resolveBattle(battle));
  });

  it("普通攻击同时伤害", () => {
    const result = resolveBattle(input(snap(["weasel"]), snap(["weasel"]), 7));
    const damage = result.events.filter((event) => event.type === "damageApplied" && event.metadata.damageKind === "normalAttack");
    expect(damage.slice(0, 2).map((event) => event.amount)).toEqual([6, 6]);
  });

  it("技能伤害能触发仍存活目标的 onHurt", () => {
    const result = resolveBattle(input(snap(["kingfisher"]), snap(["hedgehog", "mussel"]), 9));
    expect(result.events.some((event) => event.sourceUnitId?.includes("hedgehog") && event.type === "abilityTriggered")).toBe(true);
  });

  it("被技能伤害击退的单位不会反伤", () => {
    const weak = snap(["hedgehog"]);
    weak.units = weak.units.map((unit) => ({ ...unit, initialMaxHealth: 1 }));
    const result = resolveBattle(input(snap(["kingfisher"]), weak, 10));
    expect(result.events.some((event) => event.sourceUnitId?.includes("opponent_hedgehog") && event.type === "abilityTriggered")).toBe(false);
  });

  it("褪黑素：睡眠跳攻、受实际伤害醒来、强化攻击消耗", () => {
    const result = resolveBattle(input(snap(["mussel"], { sleepFirst: true }), snap(["hedgehog", "mussel"]), 11));
    expect(result.events.some((event) => event.type === "attackSkipped")).toBe(true);
    expect(result.events.some((event) => event.messageZh.includes("褪黑素效果解除"))).toBe(true);
    expect(result.events.some((event) => event.messageZh.includes("强化攻击"))).toBe(true);
  });

  it("松果弹弓通过统一伤害管线造成装备伤害", () => {
    const result = resolveBattle(input(snap(["hare"], { slingFirst: true }), snap(["mussel"]), 12));
    expect(result.events.some((event) => event.type === "equipmentTriggered")).toBe(true);
    expect(result.events.some((event) => event.type === "damageApplied" && event.metadata.damageKind === "equipment")).toBe(true);
  });

  it("退场后不压缩阵位，下一只存活动物在原位置成为最前排", () => {
    const player = snap(["frog", "weasel"]);
    player.units = [
      { ...player.units[0], initialAttack: 1, initialMaxHealth: 1 },
      { ...player.units[1], position: 3 },
    ];
    const result = resolveBattle(input(player, snap(["weasel"]), 13));
    expect(result.events.some((event) => event.type === "lineCompacted")).toBe(false);
    expect(result.finalPlayerUnits.find((unit) => unit.unitId === "player_weasel_1")?.position).toBe(3);
    const retreatIndex = result.events.findIndex((event) => event.type === "unitRetreated" && event.sourceUnitId === "player_frog_0");
    const nextWeaselAttack = result.events.findIndex((event, index) => index > retreatIndex && event.type === "attackWindup" && event.sourceUnitId === "player_weasel_1");
    expect(retreatIndex).toBeGreaterThanOrEqual(0);
    expect(nextWeaselAttack).toBeGreaterThan(retreatIndex);
  });

  it("青蛙攻击后换位会同时产出青蛙和补位队友的移动事件", () => {
    const result = resolveBattle(input(snap(["frog", "weasel"]), snap(["mussel"]), 14));
    const moved = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "player_frog_0");

    expect(moved.map((event) => event.sourceUnitId)).toEqual(expect.arrayContaining(["player_frog_0", "player_weasel_1"]));
    expect(moved.find((event) => event.sourceUnitId === "player_frog_0")?.after).toBe(1);
    expect(moved.find((event) => event.sourceUnitId === "player_weasel_1")?.after).toBe(0);
  });
});
