import { describe, expect, it } from "vitest";
import { applyCampCommand, assertCampInvariants, computeCampRules, enterCamp, formationMembers, inventoryItems, reserveMembers } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { CampCommand, ExpeditionState, SpeciesId, TeamMember, UnitSlotRef } from "../src/domain/types";

function testMember(instanceId: string, speciesId: SpeciesId, bondXp = 1): TeamMember {
  return { instanceId, speciesId, bondXp, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

function placeUnit(state: ExpeditionState, member: TeamMember, ref: UnitSlotRef): void {
  state.unitsById[member.instanceId] = member;
  if (ref.zone === "formation") state.formation[ref.slot] = member.instanceId;
  else state.reserve[ref.slot] = member.instanceId;
}

function ids(members: Array<TeamMember | null>): string[] {
  return members.map((member) => member?.instanceId ?? "empty");
}

function ownedIds(state: ExpeditionState): string[] {
  return [...state.formation, ...state.reserve].filter((id): id is string => Boolean(id));
}

function ok(state: ExpeditionState, command: CampCommand): ExpeditionState {
  const result = applyCampCommand(state, command);
  expect(result.ok, result.messageZh).toBe(true);
  assertCampInvariants(result.state.state);
  return result.state.state;
}

describe("P2 fixed camp slots and atomic commands", () => {
  it("uses fixed formation, reserve, inventory, and offer slots", () => {
    const state = createExpedition(1);
    expect(state.formation).toHaveLength(5);
    expect(state.reserve).toHaveLength(3);
    expect(state.inventory).toHaveLength(3);
    expect(state.camp!.animalOffers).toHaveLength(5);
    expect(state.camp!.itemOffers).toHaveLength(2);
    expect(computeCampRules(state).reserveCapacity).toBe(3);
    expect(computeCampRules(state).inventoryCapacity).toBe(3);
    assertCampInvariants(state);
  });

  it("moves within formation to empty slots and occupied slots without duplication", () => {
    let state = createExpedition(2);
    placeUnit(state, testMember("a", "frog"), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("b", "hare"), { zone: "formation", slot: 2 });
    state = ok(state, { type: "moveUnit", unitId: "a", to: { zone: "formation", slot: 4 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "empty", "b", "empty", "a"]);
    state = ok(state, { type: "moveUnit", unitId: "b", to: { zone: "formation", slot: 4 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "empty", "a", "empty", "b"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });

  it("moves between formation and reserve, swaps occupied slots, and fills arbitrary reserve slots", () => {
    let state = createExpedition(3);
    placeUnit(state, testMember("field", "frog"), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("anchor", "hare"), { zone: "formation", slot: 2 });
    placeUnit(state, testMember("bench", "mussel"), { zone: "reserve", slot: 0 });
    state = ok(state, { type: "moveUnit", unitId: "field", to: { zone: "reserve", slot: 2 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "empty", "anchor", "empty", "empty"]);
    expect(ids(reserveMembers(state))).toEqual(["bench", "empty", "field"]);
    state = ok(state, { type: "moveUnit", unitId: "bench", to: { zone: "formation", slot: 2 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "empty", "bench", "empty", "empty"]);
    expect(ids(reserveMembers(state))).toEqual(["anchor", "empty", "field"]);
    state = ok(state, { type: "moveUnit", unitId: "field", to: { zone: "formation", slot: 1 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "field", "bench", "empty", "empty"]);
    expect(ids(reserveMembers(state))).toEqual(["anchor", "empty", "empty"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });

  it("moves reserve slot 1 to reserve slot 3 without compacting", () => {
    let state = createExpedition(33);
    placeUnit(state, testMember("bench", "mussel"), { zone: "reserve", slot: 0 });
    state = ok(state, { type: "moveUnit", unitId: "bench", to: { zone: "reserve", slot: 2 } });
    expect(ids(reserveMembers(state))).toEqual(["empty", "empty", "bench"]);
  });

  it("recruits animal offers to specified formation and reserve slots", () => {
    let state = createExpedition(4);
    state.camp!.animalOffers[0].offer = { offerInstanceId: "offer_frog", speciesId: "frog" };
    state = ok(state, { type: "recruitAnimal", offerId: "offer_frog", to: { zone: "formation", slot: 3 } });
    expect(formationMembers(state)[3]?.speciesId).toBe("frog");
    expect(state.camp!.animalOffers[0].offer).toBeNull();
    state.camp!.supply = 10;
    state.camp!.animalOffers[1].offer = { offerInstanceId: "offer_hare", speciesId: "hare" };
    state = ok(state, { type: "recruitAnimal", offerId: "offer_hare", to: { zone: "reserve", slot: 2 } });
    expect(reserveMembers(state)[2]?.speciesId).toBe("hare");
    expect(state.camp!.animalOffers[1].offer).toBeNull();
  });

  it("merges same species manually, deletes source, keeps target id, and sums xp", () => {
    let state = createExpedition(5);
    placeUnit(state, testMember("source", "frog", 2), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("target", "frog", 1), { zone: "formation", slot: 1 });
    state = ok(state, { type: "mergeUnits", sourceUnitId: "source", targetUnitId: "target" });
    expect(state.unitsById.source).toBeUndefined();
    expect(state.unitsById.target.bondXp).toBe(3);
    expect(ids(formationMembers(state))).toEqual(["empty", "target", "empty", "empty", "empty"]);
  });

  it("rejects invalid commands atomically without spending supply or consuming offers", () => {
    const state = createExpedition(6);
    const before = structuredClone(state);
    state.camp!.animalOffers[0].offer = { offerInstanceId: "offer_frog", speciesId: "frog" };
    placeUnit(state, testMember("occupied", "hare"), { zone: "formation", slot: 0 });
    state.camp!.supply = 10;
    const result = applyCampCommand(state, { type: "recruitAnimal", offerId: "offer_frog", to: { zone: "formation", slot: 0 } });
    expect(result.ok).toBe(false);
    expect(result.state.state).toBe(state);
    expect(state.camp!.supply).toBe(10);
    expect(state.camp!.animalOffers[0].offer?.offerInstanceId).toBe("offer_frog");
    expect(before.formation.every((slot) => slot === null)).toBe(true);
  });

  it("moves inventory items by stable item id", () => {
    let state = createExpedition(7);
    state.itemsById.stored = { instanceId: "stored", itemId: "pinecone_sling" };
    state.inventory[0] = "stored";
    state = ok(state, { type: "moveItem", itemInstanceId: "stored", to: { zone: "inventory", slot: 2 } });
    expect(inventoryItems(state).map((item) => item?.instanceId ?? "empty")).toEqual(["empty", "empty", "stored"]);
  });

  it("preserves held offers by fixed slot across camp enter after refresh", () => {
    let state = createExpedition(8);
    state = ok(state, { type: "refresh" });
    state = ok(state, { type: "toggleHold", slotKind: "animal", offerId: state.camp!.animalOffers[0].offer!.offerInstanceId });
    state = ok(state, { type: "toggleHold", slotKind: "item", offerId: state.camp!.itemOffers[0].offer!.offerInstanceId });
    const animalOffer = state.camp!.animalOffers[0].offer;
    const itemOffer = state.camp!.itemOffers[0].offer;
    const nextCamp = enterCamp({ ...state, round: state.round + 1 }, state.camp!.supply);
    expect(nextCamp.camp!.animalOffers[0].held).toBe(true);
    expect(nextCamp.camp!.animalOffers[0].offer).toEqual(animalOffer);
    expect(nextCamp.camp!.itemOffers[0].held).toBe(true);
    expect(nextCamp.camp!.itemOffers[0].offer).toEqual(itemOffer);
  });

  it("keeps invariants through 100 random legal move commands", () => {
    let state = createExpedition(9);
    for (let i = 0; i < 5; i += 1) placeUnit(state, testMember(`u${i}`, ["frog", "hare", "mussel", "swallow", "otter"][i] as SpeciesId), { zone: "formation", slot: i as 0 | 1 | 2 | 3 | 4 });
    for (let i = 0; i < 3; i += 1) placeUnit(state, testMember(`r${i}`, ["crow", "egret", "weasel"][i] as SpeciesId), { zone: "reserve", slot: i as 0 | 1 | 2 });
    for (let step = 0; step < 100; step += 1) {
      const unitIds = ownedIds(state);
      const unitId = unitIds[(step * 7) % unitIds.length];
      const targetSlot = step % 8;
      const to: UnitSlotRef = targetSlot < 5 ? { zone: "formation", slot: targetSlot as 0 | 1 | 2 | 3 | 4 } : { zone: "reserve", slot: (targetSlot - 5) as 0 | 1 | 2 };
      state = ok(state, { type: "moveUnit", unitId, to });
    }
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });
});
