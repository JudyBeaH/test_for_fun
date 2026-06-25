import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ENGINE_VERSION } from "../src/content/constants";
import { resolveBattle } from "../src/domain/battleEngine";
import { slotForSidePosition } from "../src/domain/battleBoard";
import type { BattleEvent, BattleInput, BattleOutput, BattleSlot, EnvironmentId, SpeciesId, TeamSnapshot } from "../src/domain/types";

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

function input(player: TeamSnapshot, opponent: TeamSnapshot, seed = 1, environmentId: EnvironmentId = "wetland_channel"): BattleInput {
  return { battleId: `b_${seed}`, playerTeam: player, opponentTeam: opponent, environmentId, seed, engineVersion: ENGINE_VERSION, contentVersion: CONTENT_VERSION };
}

function assertUniqueActiveSlotsThroughEvents(battle: BattleInput, output: BattleOutput): void {
  const activeSlots = new Map<string, BattleSlot>();
  for (const [side, team] of [["player", battle.playerTeam], ["opponent", battle.opponentTeam]] as const) {
    for (const unit of team.units) activeSlots.set(`${side}_${unit.snapshotUnitId}`, slotForSidePosition(side, unit.position));
  }

  const assertUnique = (event: BattleEvent) => {
    const slots = [...activeSlots.values()];
    expect(new Set(slots).size, `${event.sequence}:${event.type}`).toBe(slots.length);
  };

  for (let index = 0; index < output.events.length; index += 1) {
    const event = output.events[index];
    if (event.type === "unitSummoned" && event.targetUnitId && typeof event.metadata.slot === "string") activeSlots.set(event.targetUnitId, event.metadata.slot as BattleSlot);
    if (event.type === "unitMoved") {
      const cause = event.metadata.causeUnitId ?? event.sourceUnitId;
      let cursor = index;
      while (cursor < output.events.length) {
        const movement = output.events[cursor];
        if (movement.type !== "unitMoved" || (movement.metadata.causeUnitId ?? movement.sourceUnitId) !== cause) break;
        if (movement.sourceUnitId && typeof movement.metadata.afterSlot === "string") activeSlots.set(movement.sourceUnitId, movement.metadata.afterSlot as BattleSlot);
        cursor += 1;
      }
      index = cursor - 1;
    }
    if (event.type === "unitRetreated" && event.sourceUnitId) activeSlots.delete(event.sourceUnitId);
    assertUnique(event);
  }
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

  it("青蛙攻击后只和最近后方同伴互换，并强化补位同伴", () => {
    const result = resolveBattle(input(snap(["frog", "weasel"]), snap(["mussel"]), 14));
    const moved = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "player_frog_0");
    const buff = result.events.find((event) => event.type === "statModified" && event.sourceUnitId === "player_frog_0" && event.targetUnitId === "player_weasel_1" && event.metadata.stat === "attack");

    expect(moved.map((event) => event.sourceUnitId)).toEqual(["player_frog_0", "player_weasel_1"]);
    expect(moved.find((event) => event.sourceUnitId === "player_frog_0")?.after).toBe(1);
    expect(moved.find((event) => event.sourceUnitId === "player_weasel_1")?.after).toBe(0);
    expect(buff?.amount).toBe(1);
  });

  it("青蛙在场但不是攻击者时，不会发动后跃互换", () => {
    const result = resolveBattle(input(snap(["weasel", "frog"]), snap(["mussel"]), 141));
    const frogMoves = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "player_frog_1");

    expect(frogMoves).toEqual([]);
    expect(result.finalPlayerUnits.find((unit) => unit.unitId === "player_frog_1")?.position).toBe(1);
  });

  it("乌鸦在多个同伴退场后持续获得攻击，没有三次上限", () => {
    const player = snap(["swallow", "swallow", "swallow", "swallow", "crow"]);
    player.units = player.units.map((unit, index) => index < 4 ? { ...unit, initialAttack: 0, initialMaxHealth: 1 } : { ...unit, initialAttack: 4, initialMaxHealth: 20 });
    const opponent = { units: snap(["weasel"]).units.map((unit) => ({ ...unit, initialAttack: 6, initialMaxHealth: 100 })) };

    const result = resolveBattle(input(player, opponent, 25, "meadow"));
    const crowBuffs = result.events.filter((event) => event.type === "statModified" && event.sourceUnitId === "player_crow_4" && event.targetUnitId === "player_crow_4" && event.metadata.stat === "attack");
    const crow = result.finalPlayerUnits.find((unit) => unit.unitId === "player_crow_4")!;

    expect(crowBuffs.length).toBeGreaterThanOrEqual(4);
    expect(crow.attack).toBeGreaterThanOrEqual(8);
  });

  it("P5B: 双方 battleStart 从同一快照收集，已提交触发不会被同批伤害取消", () => {
    const player = { units: snap(["kingfisher"]).units.map((unit) => ({ ...unit, level: 3 as const, initialMaxHealth: 3 })) };
    const opponent = { units: snap(["kingfisher"]).units.map((unit) => ({ ...unit, level: 3 as const, initialMaxHealth: 3 })) };

    const result = resolveBattle(input(player, opponent, 15, "canopy"));
    const startAbilities = result.events.filter((event) => event.type === "abilityTriggered" && event.metadata.trigger === "battleStart");

    expect(startAbilities.map((event) => event.sourceUnitId)).toEqual(["player_kingfisher_0", "opponent_kingfisher_0"]);
    expect(result.result).toBe("draw");
  });

  it("P5B: 双方 preAttack 从同一 exchange 快照收集，互相击退也都会结算", () => {
    const player = { units: snap(["egret"]).units.map((unit) => ({ ...unit, initialMaxHealth: 2 })) };
    const opponent = { units: snap(["egret"]).units.map((unit) => ({ ...unit, initialMaxHealth: 2 })) };

    const result = resolveBattle(input(player, opponent, 16, "canopy"));
    const preAttackAbilities = result.events.filter((event) => event.type === "abilityTriggered" && event.metadata.trigger === "beforeAttack");

    expect(preAttackAbilities.map((event) => event.sourceUnitId)).toEqual(["player_egret_0", "opponent_egret_0"]);
    expect(result.result).toBe("draw");
  });

  it("P5B: exchange start 锁定攻击者，preAttack 中退场的前排不会被后排替补进本次攻击", () => {
    const player = { units: snap(["weasel", "weasel"]).units.map((unit, index) => index === 0 ? { ...unit, initialMaxHealth: 2 } : unit) };
    const opponent = snap(["egret"]);

    const result = resolveBattle(input(player, opponent, 17, "canopy"));
    const firstExchangeDamage = result.events.filter((event) => event.exchangeId === "x1" && event.type === "damageApplied" && event.metadata.damageKind === "normalAttack");

    expect(firstExchangeDamage.map((event) => event.sourceUnitId)).toEqual(["opponent_egret_0"]);
    expect(firstExchangeDamage.some((event) => event.sourceUnitId === "player_weasel_1")).toBe(false);
  });

  it("P5B: 普攻数值在双方 preAttack 完成后再快照", () => {
    const result = resolveBattle(input(snap(["hare"]), snap(["hare"]), 18));
    const firstExchangeDamage = result.events.filter((event) => event.exchangeId === "x1" && event.type === "damageApplied" && event.metadata.damageKind === "normalAttack");

    expect(firstExchangeDamage.map((event) => event.amount)).toEqual([4, 4]);
    expect(firstExchangeDamage.map((event) => event.simultaneousGroupId)).toEqual(["x1", "x1"]);
  });

  it("P6B: selfRetreat summon creates battle-only unit ids without camp identity reuse", () => {
    const player = { units: snap(["crucian_carp"]).units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 1 })) };
    const opponent = { units: snap(["weasel"]).units.map((unit) => ({ ...unit, initialAttack: 6, initialMaxHealth: 10 })) };

    const result = resolveBattle(input(player, opponent, 19, "meadow"));
    const summon = result.events.find((event) => event.type === "unitSummoned");
    const summoned = result.finalPlayerUnits.find((unit) => unit.unitId.startsWith("summon_player_"));

    expect(summon?.sourceUnitId).toBe("player_crucian_carp_0");
    expect(summon?.metadata.speciesId).toBe("swallow");
    expect(summoned?.speciesId).toBe("swallow");
    expect(summoned?.originOwner).toBe("player");
    expect(summoned?.position).toBe(0);
    expect(result.contribution.byUnitId[summoned!.unitId]).toBeDefined();
    expect(result.events.some((event) => event.type === "attackWindup" && event.sourceUnitId === summoned?.unitId)).toBe(true);
  });

  it("P6B: opponent selfRetreat summon uses the same battle path", () => {
    const player = { units: snap(["weasel"]).units.map((unit) => ({ ...unit, initialAttack: 6, initialMaxHealth: 10 })) };
    const opponent = { units: snap(["crucian_carp"]).units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 1 })) };

    const result = resolveBattle(input(player, opponent, 21, "meadow"));
    const summon = result.events.find((event) => event.type === "unitSummoned" && event.side === "opponent");
    const summoned = result.finalOpponentUnits.find((unit) => unit.unitId.startsWith("summon_opponent_"));

    expect(summon?.sourceUnitId).toBe("opponent_crucian_carp_0");
    expect(summon?.targetUnitId).toBe(summoned?.unitId);
    expect(summon?.metadata.slot).toBe("R0");
    expect(summoned?.speciesId).toBe("swallow");
    expect(summoned?.originOwner).toBe("opponent");
    expect(summoned?.side).toBe("opponent");
    expect(summoned?.position).toBe(0);
    expect(result.contribution.byUnitId[summoned!.unitId]).toBeDefined();
    expect(result.events.some((event) => event.type === "attackWindup" && event.sourceUnitId === summoned?.unitId)).toBe(true);
  });

  it("P6B: pushTarget moves enemies through the board mutation service", () => {
    const opponent = snap(["mussel", "hedgehog"]);
    opponent.units = opponent.units.map((unit) => ({ ...unit, initialMaxHealth: 20 }));

    const result = resolveBattle(input(snap(["yellow_weasel"]), opponent, 20, "canopy"));
    const moved = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "player_yellow_weasel_0");

    expect(moved.length).toBeGreaterThan(0);
    expect(result.finalOpponentUnits.find((unit) => unit.unitId === "opponent_mussel_0")?.position).toBe(1);
    expect(result.finalOpponentUnits.find((unit) => unit.unitId === "opponent_hedgehog_1")?.position).toBe(0);
  });

  it("P6B: opponent pushTarget uses the same board mutation path", () => {
    const player = snap(["mussel", "hedgehog"]);
    player.units = player.units.map((unit) => ({ ...unit, initialMaxHealth: 20 }));

    const result = resolveBattle(input(player, snap(["yellow_weasel"]), 22, "canopy"));
    const moved = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "opponent_yellow_weasel_0");

    expect(moved.length).toBeGreaterThan(0);
    expect(result.finalPlayerUnits.find((unit) => unit.unitId === "player_mussel_0")?.position).toBe(1);
    expect(result.finalPlayerUnits.find((unit) => unit.unitId === "player_hedgehog_1")?.position).toBe(0);
  });

  it("P6B: dealDamageAndGainOnRetreat damages through the shared pipeline and grants growth on takedown", () => {
    const player = { units: snap(["chinese_alligator"]).units.map((unit) => ({ ...unit, initialAttack: 0, initialMaxHealth: 8 })) };
    const opponent = { units: snap(["hedgehog"]).units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 2 })) };

    const result = resolveBattle(input(player, opponent, 23, "wetland_channel"));
    const alligator = result.finalPlayerUnits.find((unit) => unit.unitId === "player_chinese_alligator_0")!;

    expect(result.events.some((event) => event.type === "damageApplied" && event.sourceUnitId === "player_chinese_alligator_0" && event.metadata.damageKind === "ability")).toBe(true);
    expect(result.events.some((event) => event.type === "statModified" && event.sourceUnitId === "player_chinese_alligator_0" && event.targetUnitId === "player_chinese_alligator_0" && event.metadata.stat === "health")).toBe(true);
    expect(alligator.maxHealth).toBeGreaterThan(8);
  });

  it("P6B: opponent dealDamageAndGainOnRetreat uses the same shared pipeline", () => {
    const player = { units: snap(["hedgehog"]).units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 2 })) };
    const opponent = { units: snap(["chinese_alligator"]).units.map((unit) => ({ ...unit, initialAttack: 0, initialMaxHealth: 8 })) };

    const result = resolveBattle(input(player, opponent, 24, "wetland_channel"));
    const alligator = result.finalOpponentUnits.find((unit) => unit.unitId === "opponent_chinese_alligator_0")!;

    expect(result.events.some((event) => event.type === "damageApplied" && event.sourceUnitId === "opponent_chinese_alligator_0" && event.metadata.damageKind === "ability")).toBe(true);
    expect(result.events.some((event) => event.type === "statModified" && event.sourceUnitId === "opponent_chinese_alligator_0" && event.targetUnitId === "opponent_chinese_alligator_0" && event.metadata.stat === "health")).toBe(true);
    expect(alligator.maxHealth).toBeGreaterThan(8);
  });

  it("P6B: 青蛙换位与河麂推挤交错时，事件流始终保持唯一槽位", () => {
    const player = snap(["frog", "weasel"]);
    player.units = player.units.map((unit, index) => index === 0 ? { ...unit, initialAttack: 1, initialMaxHealth: 20 } : { ...unit, initialAttack: 4, initialMaxHealth: 20 });
    const opponent = snap(["chinese_water_deer", "mussel"]);
    opponent.units = opponent.units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 20 }));
    const battle = input(player, opponent, 26, "wetland_channel");

    const result = resolveBattle(battle);
    const movementCauses = new Set(result.events.filter((event) => event.type === "unitMoved").map((event) => event.metadata.causeUnitId));

    expect(movementCauses.has("player_frog_0")).toBe(true);
    expect(movementCauses.has("opponent_chinese_water_deer_0")).toBe(true);
    assertUniqueActiveSlotsThroughEvents(battle, result);
  });

  it("P6B: 黑麂攻击前使用通用换位和护盾机制支援补位同伴", () => {
    const player = snap(["black_muntjac", "weasel"]);
    player.units = player.units.map((unit) => ({ ...unit, initialAttack: 4, initialMaxHealth: 20 }));
    const opponent = { units: snap(["mussel"]).units.map((unit) => ({ ...unit, initialAttack: 1, initialMaxHealth: 30 })) };
    const battle = input(player, opponent, 27, "meadow");

    const result = resolveBattle(battle);
    const moved = result.events.filter((event) => event.type === "unitMoved" && event.metadata.causeUnitId === "player_black_muntjac_0");
    const shield = result.events.find((event) => event.type === "statModified" && event.sourceUnitId === "player_black_muntjac_0" && event.targetUnitId === "player_weasel_1" && event.metadata.stat === "shield");

    expect(moved.map((event) => event.sourceUnitId)).toEqual(["player_black_muntjac_0", "player_weasel_1"]);
    expect(shield?.amount).toBe(2);
    assertUniqueActiveSlotsThroughEvents(battle, result);
  });
});
