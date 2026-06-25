import { CONTENT_VERSION, ENGINE_VERSION } from "../../src/content/constants";
import { ANIMALS } from "../../src/content/animals";
import type { BattleInput, BattleResult, SpeciesId, TeamSnapshot, TeamSnapshotUnit } from "../../src/domain/types";

type UnitOptions = Partial<Pick<TeamSnapshotUnit, "bondXp" | "initialAttack" | "initialMaxHealth" | "level" | "position">> & {
  sling?: boolean;
  sleeping?: boolean;
};

export interface BattleGoldenExpectation {
  result: BattleResult;
  eventTypes: string;
  eventCount: number;
  finalPlayer: string;
  finalOpponent: string;
  diagnostics: readonly string[];
}

export interface BattleGoldenFixture {
  id: string;
  titleZh: string;
  covers: readonly string[];
  input: BattleInput;
  expected: BattleGoldenExpectation;
  mustRemainZh: readonly string[];
  intentionalFutureChangesZh: readonly string[];
}

const baseStats: Record<SpeciesId, { attack: number; health: number }> = Object.fromEntries(
  ANIMALS.map((animal) => [animal.id, { attack: animal.baseAttack, health: animal.baseHealth }]),
) as Record<SpeciesId, { attack: number; health: number }>;

export const MECHANIC_CARRIERS = {
  allyRetreatResponder: "crow",
  afterAttackMover: "frog",
  airEnvironmentSupport: "swallow",
  battleStartBuffer: "otter",
  beforeAttackBuffer: "hare",
  beforeAttackDamage: "egret",
  equipmentUser: "hare",
  frontShieldStarter: "swallow",
  highDamageStriker: "weasel",
  lowestHealthVictim: "hare",
  onHurtCounter: "hedgehog",
  retreatBuffer: "carp",
  retreatShielder: "pangolin",
  skillDamageStarter: "kingfisher",
  sleeper: "mussel",
  sturdyFront: "mussel",
} satisfies Record<string, SpeciesId>;

function unit(speciesId: SpeciesId, index: number, options: UnitOptions = {}): TeamSnapshotUnit {
  const stats = baseStats[speciesId];
  return {
    snapshotUnitId: `${speciesId}_${index}`,
    speciesId,
    position: options.position ?? index,
    bondXp: options.bondXp ?? 1,
    level: options.level ?? 1,
    initialAttack: options.initialAttack ?? stats.attack,
    initialMaxHealth: options.initialMaxHealth ?? stats.health,
    equipmentEffect: options.sling ? { itemId: "pinecone_sling", initialAttackBonus: 1, initialHealthBonus: 0, battleStartDamage: 2 } : null,
    startingStatuses: options.sleeping ? [{
      statusId: `${speciesId}_${index}_sleep`,
      def: {
        kind: "sleepThenEmpower",
        remainingParticipatingBattles: 1,
        sleeping: true,
        bonusDamagePerAttack: 5,
        bonusAttackChargesAfterWake: 3,
      },
    }] : [],
  };
}

function team(units: readonly TeamSnapshotUnit[]): TeamSnapshot {
  return { units };
}

function input(id: string, seed: number, player: TeamSnapshot, opponent: TeamSnapshot, environmentId: BattleInput["environmentId"] = "wetland_channel"): BattleInput {
  return { battleId: id, playerTeam: player, opponentTeam: opponent, environmentId, seed, engineVersion: ENGINE_VERSION, contentVersion: CONTENT_VERSION };
}

const noFutureChange = ["P5B 可以增加 phase/batch 的同步表达，但不应改变胜负、最终存活状态或伤害数值。"] as const;

export const BATTLE_GOLDEN_FIXTURES: readonly BattleGoldenFixture[] = [
  {
    id: "golden_01_basic_draw",
    titleZh: "普通攻击同归于尽平局",
    covers: ["draw", "normalAttack", "simultaneousImpact"],
    input: input("golden_01_basic_draw", 501, team([unit(MECHANIC_CARRIERS.highDamageStriker, 0)]), team([unit(MECHANIC_CARRIERS.highDamageStriker, 0)])),
    expected: { result: "draw", eventTypes: "battleStarted>environmentApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 10, finalPlayer: "player_weasel_0:weasel:-2:4:6:0:0:R:-", finalOpponent: "opponent_weasel_0:weasel:-2:4:6:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["双方同一交换内互相造成普通伤害，最终平局。"],
    intentionalFutureChangesZh: ["P5B 会把双方 windup/impact 标成同一 exchange 的同步批次。"],
  },
  {
    id: "golden_02_start_shield",
    titleZh: "战斗开始给前排护盾",
    covers: ["battleStart", "shield", "startEffect"],
    input: input("golden_02_start_shield", 502, team([unit(MECHANIC_CARRIERS.sturdyFront, 0), unit(MECHANIC_CARRIERS.frontShieldStarter, 1)]), team([unit(MECHANIC_CARRIERS.beforeAttackBuffer, 0)])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>environmentApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 31, finalPlayer: "player_mussel_0:mussel:-3:8:2:0:0:R:-|player_swallow_1:swallow:4:4:2:0:1:A:-", finalOpponent: "opponent_hare_0:hare:-1:5:5:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["战斗开始护盾机制会给前排同伴护盾。"],
    intentionalFutureChangesZh: ["P5B 会把双方 battleStart 收集方式改为同阶段快照。"],
  },
  {
    id: "golden_03_start_stat_buff",
    titleZh: "战斗开始强化前方同伴",
    covers: ["battleStart", "statModified", "startEffect"],
    input: input("golden_03_start_stat_buff", 503, team([unit(MECHANIC_CARRIERS.afterAttackMover, 0), unit(MECHANIC_CARRIERS.battleStartBuffer, 1)]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0)])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>statModified>environmentApplied>abilityTriggered>statModified>statModified>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>abilityTriggered>statModified>abilityTriggered>unitMoved>unitMoved>statModified>attackWindup>attackWindup>attackExchange>shieldAbsorbed>damageApplied>damageApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 32, finalPlayer: "player_frog_0:frog:5:7:4:0:1:A:-|player_otter_1:otter:0:4:5:0:0:R:-", finalOpponent: "opponent_mussel_0:mussel:-4:8:2:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["战斗开始属性强化机制会对前方同伴提供攻击和体力强化。"],
    intentionalFutureChangesZh: noFutureChange,
  },
  {
    id: "golden_04_skill_damage_triggers_onhurt",
    titleZh: "技能伤害触发存活目标受伤反应",
    covers: ["skillDamage", "onHurt", "battleStart"],
    input: input("golden_04_skill_damage_triggers_onhurt", 504, team([unit(MECHANIC_CARRIERS.skillDamageStarter, 0)]), team([unit(MECHANIC_CARRIERS.onHurtCounter, 0), unit(MECHANIC_CARRIERS.sturdyFront, 1)])),
    expected: { result: "loss", eventTypes: "battleStarted>statModified>statModified>environmentApplied>abilityTriggered>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>abilityTriggered>damageApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 23, finalPlayer: "player_kingfisher_0:kingfisher:-2:5:4:0:0:R:-", finalOpponent: "opponent_hedgehog_0:hedgehog:-3:5:3:0:0:R:-|opponent_mussel_1:mussel:7:8:2:2:1:A:-", diagnostics: [] },
    mustRemainZh: ["技能伤害命中仍存活目标时，可触发该目标的 onHurt 反应。"],
    intentionalFutureChangesZh: ["P5B 可能改变同阶段技能和反应事件的 batchId，但反击是否发生不应改变。"],
  },
  {
    id: "golden_05_skill_kill_no_onhurt",
    titleZh: "技能击退刺猬时不触发反击",
    covers: ["skillDamage", "retreat", "onHurtGuard"],
    input: input("golden_05_skill_kill_no_onhurt", 505, team([unit(MECHANIC_CARRIERS.skillDamageStarter, 0)]), team([unit(MECHANIC_CARRIERS.onHurtCounter, 0, { initialMaxHealth: 1 })])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>environmentApplied>abilityTriggered>damageApplied>unitRetreated>battleEnded", eventCount: 7, finalPlayer: "player_kingfisher_0:kingfisher:5:5:4:0:0:A:-", finalOpponent: "opponent_hedgehog_0:hedgehog:0:1:3:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["被技能直接击退的单位不能执行 onHurt 反应。"],
    intentionalFutureChangesZh: noFutureChange,
  },
  {
    id: "golden_06_sleep_wake_empower",
    titleZh: "睡眠、受伤醒来、强化攻击",
    covers: ["status", "sleep", "onHurt", "empoweredAttack"],
    input: input("golden_06_sleep_wake_empower", 506, team([unit(MECHANIC_CARRIERS.sleeper, 0, { sleeping: true })]), team([unit(MECHANIC_CARRIERS.onHurtCounter, 0), unit(MECHANIC_CARRIERS.sturdyFront, 1)])),
    expected: { result: "draw", eventTypes: "battleStarted>statModified>statModified>environmentApplied>attackSkipped>attackWindup>attackExchange>damageApplied>statusConsumed>abilityTriggered>statModified>attackWindup>attackWindup>statusConsumed>attackExchange>damageApplied>shieldAbsorbed>damageApplied>unitRetreated>attackWindup>attackWindup>statusConsumed>attackExchange>damageApplied>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>statusConsumed>statusExpired>attackExchange>shieldAbsorbed>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 38, finalPlayer: "player_mussel_0:mussel:0:8:2:0:0:R:-", finalOpponent: "opponent_hedgehog_0:hedgehog:-2:5:3:0:0:R:-|opponent_mussel_1:mussel:-4:8:2:0:1:R:-", diagnostics: [] },
    mustRemainZh: ["睡眠单位跳过攻击，受实际伤害且存活后醒来并获得强化普通攻击。"],
    intentionalFutureChangesZh: ["P5B 可以改变醒来事件归属的 hurt batch，但状态链结果必须保持。"],
  },
  {
    id: "golden_07_equipment_start_damage",
    titleZh: "装备战斗开始伤害",
    covers: ["equipment", "battleStart", "skillDamage"],
    input: input("golden_07_equipment_start_damage", 507, team([unit(MECHANIC_CARRIERS.equipmentUser, 0, { sling: true })]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0)])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>environmentApplied>equipmentTriggered>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>shieldAbsorbed>damageApplied>damageApplied>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>damageApplied>unitRetreated>battleEnded", eventCount: 24, finalPlayer: "player_hare_0:hare:1:5:5:0:0:A:-", finalOpponent: "opponent_mussel_0:mussel:-1:8:2:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["装备在战斗开始触发，并通过统一伤害管线造成装备伤害。"],
    intentionalFutureChangesZh: ["P5B 会把双方装备与 battleStart 技能放入更明确的启动批次。"],
  },
  {
    id: "golden_08_after_attack_move",
    titleZh: "攻击后与最近后方同伴互换",
    covers: ["movement", "afterAttack", "unitMoved"],
    input: input("golden_08_after_attack_move", 508, team([unit(MECHANIC_CARRIERS.afterAttackMover, 0), unit(MECHANIC_CARRIERS.highDamageStriker, 1)]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0)])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>statModified>environmentApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>abilityTriggered>statModified>abilityTriggered>unitMoved>unitMoved>statModified>attackWindup>attackWindup>attackExchange>shieldAbsorbed>damageApplied>damageApplied>unitRetreated>abilityTriggered>abilityNoTarget>battleEnded", eventCount: 25, finalPlayer: "player_frog_0:frog:4:6:3:0:1:A:-|player_weasel_1:weasel:2:4:7:0:0:A:-", finalOpponent: "opponent_mussel_0:mussel:0:8:2:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["青蛙攻击后只让自身与最近后方同伴互换，不会在其他动物攻击时触发，也不会推动整条队列。"],
    intentionalFutureChangesZh: ["P6B 将旧的宽泛 moveSelf 收窄为 swapSelfWithNearestAlly；位置模型可继续调整，但不应恢复队列连带移动。"],
  },
  {
    id: "golden_09_before_attack_buff",
    titleZh: "攻击前蓄势加攻",
    covers: ["beforeAttack", "statModified"],
    input: input("golden_09_before_attack_buff", 509, team([unit(MECHANIC_CARRIERS.beforeAttackBuffer, 0)]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0)])),
    expected: { result: "draw", eventTypes: "battleStarted>statModified>environmentApplied>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>shieldAbsorbed>damageApplied>damageApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 28, finalPlayer: "player_hare_0:hare:-1:5:5:0:0:R:-", finalOpponent: "opponent_mussel_0:mussel:-4:8:2:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["beforeAttack 强化机制在攻击伤害结算前生效。"],
    intentionalFutureChangesZh: ["P5B 会把双方 beforeAttack 改为同阶段快照后统一解析。"],
  },
  {
    id: "golden_10_before_attack_lowest_damage",
    titleZh: "攻击前打击最低体力敌人",
    covers: ["beforeAttack", "skillDamage", "lowestHealth"],
    input: input("golden_10_before_attack_lowest_damage", 510, team([unit(MECHANIC_CARRIERS.beforeAttackDamage, 0)]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0), unit(MECHANIC_CARRIERS.lowestHealthVictim, 1, { initialMaxHealth: 2 })])),
    expected: { result: "win", eventTypes: "battleStarted>statModified>statModified>environmentApplied>attackWindup>attackWindup>abilityTriggered>damageApplied>unitRetreated>attackExchange>damageApplied>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>attackExchange>shieldAbsorbed>damageApplied>damageApplied>unitRetreated>battleEnded", eventCount: 22, finalPlayer: "player_egret_0:egret:3:7:5:0:0:A:-", finalOpponent: "opponent_mussel_0:mussel:0:8:2:0:0:R:-|opponent_hare_1:hare:0:2:3:0:1:R:-", diagnostics: [] },
    mustRemainZh: ["beforeAttack 伤害机制选择最低体力敌人。"],
    intentionalFutureChangesZh: noFutureChange,
  },
  {
    id: "golden_11_self_retreat_buff",
    titleZh: "自身退场后强化前排",
    covers: ["selfRetreat", "retreatChain", "statModified"],
    input: input("golden_11_self_retreat_buff", 511, team([unit(MECHANIC_CARRIERS.retreatBuffer, 0, { initialMaxHealth: 1 }), unit(MECHANIC_CARRIERS.highDamageStriker, 1)]), team([unit(MECHANIC_CARRIERS.highDamageStriker, 0)])),
    expected: { result: "draw", eventTypes: "battleStarted>statModified>environmentApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>abilityTriggered>statModified>statModified>abilityTriggered>statModified>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 22, finalPlayer: "player_carp_0:carp:-3:3:2:0:0:R:-|player_weasel_1:weasel:0:6:5:0:1:R:-", finalOpponent: "opponent_weasel_0:weasel:-3:4:6:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["selfRetreat 强化机制会对仍存活前排触发。"],
    intentionalFutureChangesZh: ["P6B 修正了 selfRetreat 被来源退场挡掉的问题；后续只应改变 wave 标注，不应再次让退场技能失效。"],
  },
  {
    id: "golden_12_ally_retreat_buff",
    titleZh: "同伴退场后加攻",
    covers: ["allyRetreat", "retreatChain", "statModified"],
    input: input("golden_12_ally_retreat_buff", 512, team([unit(MECHANIC_CARRIERS.afterAttackMover, 0, { initialMaxHealth: 1 }), unit(MECHANIC_CARRIERS.allyRetreatResponder, 1)]), team([unit(MECHANIC_CARRIERS.highDamageStriker, 0)])),
    expected: { result: "draw", eventTypes: "battleStarted>statModified>environmentApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>abilityTriggered>statModified>abilityTriggered>statModified>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 21, finalPlayer: "player_frog_0:frog:-3:3:3:0:0:R:-|player_crow_1:crow:-2:4:4:0:1:R:-", finalOpponent: "opponent_weasel_0:weasel:-3:4:6:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["allyRetreat 机制会在同伴退场后触发加攻。"],
    intentionalFutureChangesZh: ["P5B 可以改变退场 wave 的 batchId，但乌鸦触发次数应保持。"],
  },
  {
    id: "golden_13_self_retreat_shield",
    titleZh: "自身退场后给前排护盾",
    covers: ["selfRetreat", "shield", "retreatChain"],
    input: input("golden_13_self_retreat_shield", 513, team([unit(MECHANIC_CARRIERS.retreatShielder, 0, { initialMaxHealth: 1 }), unit(MECHANIC_CARRIERS.beforeAttackBuffer, 1)]), team([unit(MECHANIC_CARRIERS.highDamageStriker, 0)])),
    expected: { result: "win", eventTypes: "battleStarted>environmentApplied>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>abilityTriggered>statModified>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>unitRetreated>battleEnded", eventCount: 22, finalPlayer: "player_pangolin_0:pangolin:-5:1:3:0:0:R:-|player_hare_1:hare:1:5:3:0:1:A:-", finalOpponent: "opponent_weasel_0:weasel:-2:4:6:0:0:R:-", diagnostics: [] },
    mustRemainZh: ["selfRetreat 护盾机制会给新的前排同伴护盾。"],
    intentionalFutureChangesZh: ["P6B 修正了 selfRetreat 被来源退场挡掉的问题；护盾会影响后续普攻结算，这是有意变化。"],
  },
  {
    id: "golden_14_environment_meadow",
    titleZh: "草甸环境强化陆地单位",
    covers: ["environment", "statModified", "shield"],
    input: input("golden_14_environment_meadow", 514, team([unit(MECHANIC_CARRIERS.beforeAttackBuffer, 0)]), team([unit(MECHANIC_CARRIERS.sturdyFront, 0), unit(MECHANIC_CARRIERS.onHurtCounter, 1)]), "meadow"),
    expected: { result: "draw", eventTypes: "battleStarted>statModified>statModified>statModified>statModified>environmentApplied>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>shieldAbsorbed>damageApplied>damageApplied>unitRetreated>attackWindup>attackWindup>attackExchange>shieldAbsorbed>damageApplied>damageApplied>unitRetreated>unitRetreated>battleEnded", eventCount: 34, finalPlayer: "player_hare_0:hare:-2:5:6:0:0:R:-", finalOpponent: "opponent_mussel_0:mussel:-3:6:2:0:0:R:-|opponent_hedgehog_1:hedgehog:0:5:4:0:1:R:-", diagnostics: [] },
    mustRemainZh: ["草甸给双方第一个陆地单位攻击和护盾。"],
    intentionalFutureChangesZh: noFutureChange,
  },
  {
    id: "golden_15_canopy_air_support",
    titleZh: "林冠环境由空中单位支援前排",
    covers: ["environment", "airHabitat", "statModified"],
    input: input("golden_15_canopy_air_support", 515, team([unit(MECHANIC_CARRIERS.sturdyFront, 0), unit(MECHANIC_CARRIERS.airEnvironmentSupport, 1)]), team([unit(MECHANIC_CARRIERS.beforeAttackBuffer, 0), unit(MECHANIC_CARRIERS.skillDamageStarter, 1)]), "canopy"),
    expected: { result: "loss", eventTypes: "battleStarted>statModified>statModified>environmentApplied>abilityTriggered>statModified>abilityTriggered>damageApplied>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>abilityTriggered>statModified>attackWindup>attackWindup>abilityTriggered>statModified>attackExchange>damageApplied>shieldAbsorbed>damageApplied>unitRetreated>unitRetreated>attackWindup>attackWindup>attackExchange>damageApplied>damageApplied>unitRetreated>battleEnded", eventCount: 35, finalPlayer: "player_mussel_0:mussel:-2:6:3:0:0:R:-|player_swallow_1:swallow:-1:4:2:0:1:R:-", finalOpponent: "opponent_hare_0:hare:-1:5:6:0:0:R:-|opponent_kingfisher_1:kingfisher:1:3:4:0:1:A:-", diagnostics: [] },
    mustRemainZh: ["林冠环境用后排空中单位强化前排。"],
    intentionalFutureChangesZh: noFutureChange,
  },
];
