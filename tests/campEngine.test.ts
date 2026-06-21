import { describe, expect, it } from "vitest";
import { applyCampAction, computeCampRules, enterCamp } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { CampModifier, TeamMember } from "../src/domain/types";

function testMember(instanceId: string, speciesId: TeamMember["speciesId"], bondXp = 1): TeamMember {
  return { instanceId, speciesId, bondXp, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

function teamIds(team: Array<TeamMember | null>): string[] {
  return team.map((member) => member?.instanceId ?? "empty");
}

function presentMembers(team: Array<TeamMember | null>): TeamMember[] {
  return team.filter((member): member is TeamMember => Boolean(member));
}

function ownedIds(state: { team: Array<TeamMember | null>; reserve: TeamMember[] }): string[] {
  return [...presentMembers(state.team), ...state.reserve].map((member) => member.instanceId);
}

describe("v0.2 camp market and merge", () => {
  it("回合 1~3/4~6/7+ 分别开放 3/4/5 个动物位", () => {
    const s1 = createExpedition(1);
    const s4 = enterCamp({ ...s1, round: 4, camp: null });
    const s7 = enterCamp({ ...s1, round: 7, camp: null });
    expect(computeCampRules(s1).animalOfferSlots).toBe(3);
    expect(computeCampRules(s4).animalOfferSlots).toBe(4);
    expect(computeCampRules(s7).animalOfferSlots).toBe(5);
  });

  it("招募后来源格立即为空，重复物种不会自动合成", () => {
    let state = createExpedition(2);
    state.camp!.animalSlots[0].offer = { offerInstanceId: "a", speciesId: "frog" };
    state = applyCampAction(state, { type: "recruitToTeam", slotId: state.camp!.animalSlots[0].slotId }).state;
    expect(state.camp!.animalSlots[0].offer).toBeNull();
    state.camp!.animalSlots[1].offer = { offerInstanceId: "b", speciesId: "frog" };
    state = applyCampAction(state, { type: "recruitToTeam", slotId: state.camp!.animalSlots[1].slotId }).state;
    expect(state.team).toHaveLength(2);
  });

  it("市场动物拖到指定空战斗位时填入该空格", () => {
    let state = createExpedition(13);
    state.team = [testMember("front", "hare"), null, null, null, null];
    state.camp!.animalSlots[0].offer = { offerInstanceId: "a", speciesId: "frog" };

    state = applyCampAction(state, { type: "recruitToTeam", slotId: state.camp!.animalSlots[0].slotId, targetIndex: 3 }).state;

    expect(state.team[0]?.instanceId).toBe("front");
    expect(state.team[3]?.speciesId).toBe("frog");
    expect(state.camp!.animalSlots[0].offer).toBeNull();
  });

  it("手动合成保留目标并产生升级发现", () => {
    let state = createExpedition(3);
    for (let i = 0; i < 2; i += 1) {
      state.camp!.animalSlots[i].offer = { offerInstanceId: `frog${i}`, speciesId: "frog" };
      state = applyCampAction(state, { type: "recruitToTeam", slotId: state.camp!.animalSlots[i].slotId }).state;
      state.camp!.supply = 10;
    }
    const [source, target] = state.team;
    state = applyCampAction(state, { type: "mergeOwned", sourceInstanceId: source!.instanceId, targetInstanceId: target!.instanceId }).state;
    expect(presentMembers(state.team)).toHaveLength(1);
    expect(state.team[1]!.bondXp).toBe(2);
    expect(state.pendingDiscoveries).toHaveLength(0);
    state.team[1]!.bondXp = 2;
    state.reserve.push({ ...source!, instanceId: "extra", bondXp: 1 });
    state = applyCampAction(state, { type: "mergeOwned", sourceInstanceId: "extra", targetInstanceId: state.team[1]!.instanceId }).state;
    expect(state.pendingDiscoveries.length).toBeGreaterThan(0);
  });

  it("营地修改器支持结转、补给上限和免费刷新", () => {
    const state = createExpedition(4);
    const mods: CampModifier[] = [{ kind: "modifyCarryLimit", amount: 3 }, { kind: "modifySupplyCap", amount: 2 }, { kind: "grantFreeRefreshes", amount: 1 }];
    const rules = computeCampRules(state, mods);
    expect(rules.carrySupplyLimit).toBe(3);
    expect(rules.supplyCap).toBe(12);
    expect(rules.freeRefreshes).toBe(1);
  });

  it("刷新后标记留意的动物和物品会按槽位保留到下个营地", () => {
    let state = createExpedition(14);
    state = applyCampAction(state, { type: "refresh" }).state;
    state = applyCampAction(state, { type: "toggleHold", slotKind: "animal", slotId: state.camp!.animalSlots[0].slotId }).state;
    state = applyCampAction(state, { type: "toggleHold", slotKind: "item", slotId: state.camp!.itemSlots[0].slotId }).state;
    const animalOffer = state.camp!.animalSlots[0].offer;
    const itemOffer = state.camp!.itemSlots[0].offer;

    const nextCamp = enterCamp({ ...state, round: state.round + 1 }, state.camp!.supply);

    expect(nextCamp.camp!.animalSlots[0].held).toBe(true);
    expect(nextCamp.camp!.animalSlots[0].offer).toEqual(animalOffer);
    expect(nextCamp.camp!.itemSlots[0].held).toBe(true);
    expect(nextCamp.camp!.itemSlots[0].offer).toEqual(itemOffer);
  });

  it("告别返还补给可超过入营上限，并按等级返还 1/3/5", () => {
    let state = createExpedition(5);
    state.camp!.supply = 10;
    state.team.push({ instanceId: "l1", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.team.push({ instanceId: "l2", speciesId: "hare", bondXp: 3, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.team.push({ instanceId: "l3", speciesId: "mussel", bondXp: 6, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state = applyCampAction(state, { type: "release", area: "team", instanceId: "l1" }).state;
    expect(state.camp!.supply).toBe(11);
    state = applyCampAction(state, { type: "release", area: "team", instanceId: "l2" }).state;
    expect(state.camp!.supply).toBe(14);
    state = applyCampAction(state, { type: "release", area: "team", instanceId: "l3" }).state;
    expect(state.camp!.supply).toBe(19);
  });

  it("替补和上场可交换，同种移动不会自动合成", () => {
    let state = createExpedition(6);
    state.team.push({ instanceId: "field", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.reserve.push({ instanceId: "bench", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state = applyCampAction(state, { type: "moveOwned", sourceArea: "reserve", sourceIndex: 0, targetArea: "team", targetIndex: 0 }).state;
    expect(state.team[0]!.instanceId).toBe("bench");
    expect(state.reserve[0].instanceId).toBe("field");
    expect(state.team[0]!.bondXp).toBe(1);
    expect(state.reserve[0].bondXp).toBe(1);
  });

  it("同队移动到空位或占用位不会复制个体", () => {
    let state = createExpedition(8);
    state.team.push({ instanceId: "a", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.team.push({ instanceId: "b", speciesId: "hare", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state.team.push({ instanceId: "c", speciesId: "mussel", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    state = applyCampAction(state, { type: "moveOwned", sourceArea: "team", sourceIndex: 0, targetArea: "team", targetIndex: 4 }).state;
    expect(teamIds(state.team)).toEqual(["empty", "b", "c", "empty", "a"]);
    state = applyCampAction(state, { type: "moveOwned", sourceArea: "team", sourceIndex: 2, targetArea: "team", targetIndex: 1 }).state;
    expect(teamIds(state.team)).toEqual(["empty", "c", "b", "empty", "a"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });

  it("替补交换、场上移位、替补再上场不会复制个体，并优先填补空位", () => {
    let state = createExpedition(12);
    state.team = [testMember("field", "frog"), null, testMember("anchor", "hare")];
    state.reserve = [testMember("bench", "mussel")];

    state = applyCampAction(state, { type: "moveOwned", sourceArea: "reserve", sourceIndex: 0, targetArea: "team", targetIndex: 0 }).state;
    expect(teamIds(state.team)).toEqual(["bench", "empty", "anchor"]);
    expect(state.reserve.map((member) => member.instanceId)).toEqual(["field"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);

    state = applyCampAction(state, { type: "moveOwned", sourceArea: "team", sourceIndex: 0, targetArea: "team", targetIndex: 1 }).state;
    expect(teamIds(state.team)).toEqual(["empty", "bench", "anchor"]);
    expect(state.reserve.map((member) => member.instanceId)).toEqual(["field"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);

    state = applyCampAction(state, { type: "moveOwned", sourceArea: "reserve", sourceIndex: 0, targetArea: "team", targetIndex: 0 }).state;
    expect(teamIds(state.team)).toEqual(["field", "bench", "anchor"]);
    expect(state.reserve).toHaveLength(0);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });

  it("默认替补和仓库容量都为 1", () => {
    const rules = computeCampRules(createExpedition(7));
    expect(rules.reserveCapacity).toBe(1);
    expect(rules.inventoryCapacity).toBe(1);
  });

  it("待安置满员时仍可告别战斗队或替补动物腾位", () => {
    let state = createExpedition(9);
    state.phase = "upgradeDiscovery";
    state.team = [
      testMember("t1", "frog"),
      testMember("t2", "hare"),
      testMember("t3", "mussel"),
      testMember("t4", "swallow"),
      testMember("t5", "otter"),
    ];
    state.reserve = [testMember("r1", "crow", 3)];
    state.pendingRecruit = testMember("new", "egret");
    state.camp!.supply = 10;

    state = applyCampAction(state, { type: "release", area: "team", instanceId: "t1" }).state;
    expect(teamIds(state.team)).toEqual(["empty", "t2", "t3", "t4", "t5"]);
    expect(state.pendingRecruit?.instanceId).toBe("new");
    expect(state.phase).toBe("upgradeDiscovery");
    expect(state.camp!.supply).toBe(11);

    state = applyCampAction(state, { type: "release", area: "reserve", instanceId: "r1" }).state;
    expect(state.reserve).toHaveLength(0);
    expect(state.pendingRecruit?.instanceId).toBe("new");
    expect(state.camp!.supply).toBe(14);
  });

  it("待安置动物可以被告别并回到营地或继续下一个发现", () => {
    let state = createExpedition(10);
    state.phase = "upgradeDiscovery";
    state.pendingRecruit = testMember("new", "egret");

    state = applyCampAction(state, { type: "discardPendingRecruit" }).state;
    expect(state.pendingRecruit).toBeNull();
    expect(state.phase).toBe("camp");

    state.phase = "upgradeDiscovery";
    state.pendingRecruit = testMember("new2", "weasel");
    state.pendingDiscoveries = [{ discoveryId: "d2", sourceInstanceId: "frog", targetTier: 2, candidates: ["otter", "hare", "crow"] }];
    state = applyCampAction(state, { type: "discardPendingRecruit" }).state;
    expect(state.pendingRecruit).toBeNull();
    expect(state.phase).toBe("upgradeDiscovery");
    expect(state.pendingDiscoveries).toHaveLength(1);
  });

  it("待安置满员时可以直接替换指定战斗位或替补位", () => {
    let state = createExpedition(11);
    state.phase = "upgradeDiscovery";
    state.team = [
      testMember("t1", "frog"),
      testMember("t2", "hare"),
      testMember("t3", "mussel"),
      testMember("t4", "swallow"),
      testMember("t5", "otter"),
    ];
    state.reserve = [testMember("r1", "crow")];
    state.pendingRecruit = testMember("new", "egret");

    state = applyCampAction(state, { type: "placePendingRecruit", area: "team", replaceInstanceId: "t3" }).state;
    expect(teamIds(state.team)).toEqual(["t1", "t2", "new", "t4", "t5"]);
    expect(state.pendingRecruit).toBeNull();
    expect(state.phase).toBe("camp");

    state.phase = "upgradeDiscovery";
    state.pendingRecruit = testMember("new2", "weasel");
    state = applyCampAction(state, { type: "placePendingRecruit", area: "reserve", replaceInstanceId: "r1" }).state;
    expect(state.reserve.map((member) => member.instanceId)).toEqual(["new2"]);
    expect(state.pendingRecruit).toBeNull();
    expect(state.phase).toBe("camp");
  });
});
