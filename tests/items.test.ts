import { describe, expect, it } from "vitest";
import { applyCampAction } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";

describe("v0.2 items", () => {
  it("红果永久修改当前实例，河苔只影响当前水域动物", () => {
    let state = createExpedition(12);
    state.team.push({ instanceId: "frog", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.team.push({ instanceId: "hare", speciesId: "hare", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.camp!.itemSlots[0].offer = { offerInstanceId: "red", itemId: "red_berry" };
    state = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["frog"] }).state;
    expect(state.team[0]!.permanentAttackBonus).toBe(1);
    state.camp!.supply = 10;
    state.camp!.itemSlots[1].offer = { offerInstanceId: "moss", itemId: "river_moss" };
    state = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[1].slotId, targetInstanceIds: [] }).state;
    expect(state.team[0]!.permanentHealthBonus).toBe(3);
    expect(state.team[1]!.permanentHealthBonus).toBe(0);
  });

  it("同心果可触发升级发现，苦根不能把体力降到 1 以下", () => {
    let state = createExpedition(13);
    state.team.push({ instanceId: "low", speciesId: "frog", bondXp: 2, permanentAttackBonus: 0, permanentHealthBonus: -3, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.camp!.itemSlots[0].offer = { offerInstanceId: "nut", itemId: "bond_nut" };
    state = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["low"] }).state;
    expect(state.pendingDiscoveries.length).toBe(1);
    state.camp!.supply = 10;
    state.camp!.itemSlots[0].offer = { offerInstanceId: "bitter", itemId: "bitter_root" };
    const result = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["low"] });
    expect(result.ok).toBe(false);
  });

  it("仓库容量与装备替换流程明确", () => {
    let state = createExpedition(14);
    state.team.push({ instanceId: "hare", speciesId: "hare", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.inventory.push({ instanceId: "s1", itemId: "pinecone_sling" });
    state = applyCampAction(state, { type: "equipInventoryItem", itemInstanceId: "s1", targetInstanceId: "hare" }).state;
    expect(state.team[0]!.equipment?.itemId).toBe("pinecone_sling");
  });

  it("市场装备可以直接装备到选中个体，旧装备在仓库有空位时回仓", () => {
    let state = createExpedition(15);
    state.team.push({ instanceId: "frog", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.camp!.itemSlots[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };

    state = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["frog"] }).state;
    expect(state.team[0]!.equipment?.itemId).toBe("pinecone_sling");
    expect(state.inventory).toHaveLength(0);
    expect(state.camp!.itemSlots[0].offer).toBeNull();

    state.camp!.supply = 10;
    state.camp!.itemSlots[0].offer = { offerInstanceId: "sling2", itemId: "pinecone_sling" };
    state = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["frog"] }).state;
    expect(state.team[0]!.equipment?.itemId).toBe("pinecone_sling");
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0].itemId).toBe("pinecone_sling");
  });

  it("市场装备替换旧装备时若仓库已满会阻止，避免旧装备丢失", () => {
    const state = createExpedition(16);
    state.team.push({ instanceId: "frog", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: { instanceId: "old", itemId: "pinecone_sling" }, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.inventory.push({ instanceId: "stored", itemId: "pinecone_sling" });
    state.camp!.itemSlots[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };

    const result = applyCampAction(state, { type: "buyAndUseItem", slotId: state.camp!.itemSlots[0].slotId, targetInstanceIds: ["frog"] });
    expect(result.ok).toBe(false);
    expect(result.state.team[0]!.equipment?.instanceId).toBe("old");
    expect(result.state.inventory).toHaveLength(1);
  });
});
