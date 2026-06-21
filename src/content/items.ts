import type { ItemDef, ItemId } from "../domain/types";

export const ITEMS: readonly ItemDef[] = [
  {
    id: "red_berry",
    nameZh: "红果",
    kind: "food",
    price: 2,
    targetScope: { kind: "singleUnit" },
    descriptionZh: "单体永久 +1 攻击、+1 体力。",
    effects: [{ kind: "modifyPermanentAttack", amount: 1 }, { kind: "modifyPermanentHealth", amount: 1 }],
  },
  {
    id: "river_moss",
    nameZh: "河苔",
    kind: "food",
    price: 2,
    targetScope: { kind: "habitat", habitat: "water" },
    descriptionZh: "当前所有己方水域动物永久 +2 体力。",
    effects: [{ kind: "modifyPermanentHealth", amount: 2 }],
  },
  {
    id: "bond_nut",
    nameZh: "同心果",
    kind: "food",
    price: 3,
    targetScope: { kind: "singleUnit" },
    descriptionZh: "单体默契 +1，可触发升级发现。",
    effects: [{ kind: "modifyBondXp", amount: 1 }],
  },
  {
    id: "pinecone_sling",
    nameZh: "松果弹弓",
    kind: "equipment",
    price: 3,
    targetScope: { kind: "singleUnit" },
    descriptionZh: "装备：参战初始攻击 +1，战斗开始对随机敌人造成 2 技能伤害。",
    effects: [{ kind: "modifyInitialAttack", amount: 1 }, { kind: "battleStartDamage", target: "randomEnemy", amount: 2 }],
  },
  {
    id: "bitter_root",
    nameZh: "苦根",
    kind: "food",
    price: 2,
    targetScope: { kind: "singleUnit" },
    descriptionZh: "单体永久 -1 体力、+2 攻击；不能使初始最大体力低于 1。",
    effects: [{ kind: "modifyPermanentHealth", amount: -1 }, { kind: "modifyPermanentAttack", amount: 2 }],
  },
  {
    id: "melatonin",
    nameZh: "褪黑素",
    kind: "food",
    price: 2,
    targetScope: { kind: "singleUnit" },
    descriptionZh: "下一次参战睡眠；首次实际受伤仍存活后醒来，接下来 3 次普通攻击各 +5 伤害。",
    effects: [{
      kind: "attachStatus",
      duration: { kind: "nextParticipatingBattle" },
      status: {
        kind: "sleepThenEmpower",
        remainingParticipatingBattles: 1,
        sleeping: true,
        bonusDamagePerAttack: 5,
        bonusAttackChargesAfterWake: 3,
      },
    }],
  },
] as const;

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((item) => [item.id, item])) as Record<ItemId, ItemDef>;
