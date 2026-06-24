import { describe, expect, it } from "vitest";
import { applyCampCommand, assertCampInvariants, computeCampRules, enterCamp, formationMembers, inventoryItems, preflightMoveUnitToEmptySlot, reserveMembers } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { CampCommand, ExpeditionState, ItemInstanceId, SpeciesId, TeamMember, UnitSlotRef } from "../src/domain/types";

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

function expectAtomicFailure(state: ExpeditionState, command: CampCommand): void {
  const before = JSON.stringify(state);
  const result = applyCampCommand(state, command);
  expect(result.ok).toBe(false);
  expect(result.state.state).toBe(state);
  expect(JSON.stringify(state)).toBe(before);
  assertCampInvariants(state);
}

function occupiedUnitIds(state: ExpeditionState): string[] {
  return [...state.formation, ...state.reserve].filter((unitId): unitId is string => Boolean(unitId));
}

function occupiedItemIds(state: ExpeditionState): ItemInstanceId[] {
  return state.inventory.filter((itemId): itemId is ItemInstanceId => Boolean(itemId));
}

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

function randomUnitSlot(nextInt: () => number): UnitSlotRef {
  const slot = nextInt() % 8;
  return slot < 5 ? { zone: "formation", slot: slot as 0 | 1 | 2 | 3 | 4 } : { zone: "reserve", slot: (slot - 5) as 0 | 1 | 2 };
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
    expect(ids(formationMembers(state))).toEqual(["empty", "empty", "empty", "a", "b"]);
    expect(new Set(ownedIds(state)).size).toBe(ownedIds(state).length);
  });

  it("inserts within occupied formation targets instead of swapping", () => {
    let state = createExpedition(22);
    for (const [index, unitId] of ["a1", "a2", "a3", "a4", "a5"].entries()) {
      placeUnit(state, testMember(unitId, unitId === "a1" ? "frog" : "hare"), { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 });
    }
    state = ok(state, { type: "moveUnit", unitId: "a1", to: { zone: "formation", slot: 4 } });
    expect(ids(formationMembers(state))).toEqual(["a2", "a3", "a4", "a5", "a1"]);

    state = createExpedition(23);
    for (const [index, unitId] of ["a1", "a2", "a3", "a4", "a5"].entries()) {
      placeUnit(state, testMember(unitId, unitId === "a1" ? "frog" : "hare"), { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 });
    }
    state = ok(state, { type: "moveUnit", unitId: "a1", to: { zone: "formation", slot: 2 } });
    expect(ids(formationMembers(state))).toEqual(["a2", "a3", "a1", "a4", "a5"]);

    state = createExpedition(24);
    for (const [index, unitId] of ["a1", "a2", "a3", "a4", "a5"].entries()) {
      placeUnit(state, testMember(unitId, unitId === "a5" ? "frog" : "hare"), { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 });
    }
    state = ok(state, { type: "moveUnit", unitId: "a5", to: { zone: "formation", slot: 1 } });
    expect(ids(formationMembers(state))).toEqual(["a1", "a5", "a2", "a3", "a4"]);

    state = createExpedition(25);
    for (const [index, unitId] of ["a1", "a2", "a3", "a4", "a5"].entries()) {
      placeUnit(state, testMember(unitId, unitId === "a5" ? "frog" : "hare"), { zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 });
    }
    state = ok(state, { type: "moveUnit", unitId: "a5", to: { zone: "formation", slot: 0 } });
    expect(ids(formationMembers(state))).toEqual(["a5", "a1", "a2", "a3", "a4"]);
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

  it("resolves upgrade discovery directly to empty slots, same-species merge, or supply", () => {
    let state = createExpedition(59);
    state.phase = "upgradeDiscovery";
    state.pendingDiscoveries = [
      { discoveryId: "discovery_1", sourceInstanceId: "source", targetTier: 2, candidates: ["frog", "hare", "otter"] },
      { discoveryId: "discovery_2", sourceInstanceId: "source", targetTier: 2, candidates: ["frog", "hare", "otter"] },
      { discoveryId: "discovery_3", sourceInstanceId: "source", targetTier: 2, candidates: ["frog", "hare", "otter"] },
    ];
    placeUnit(state, testMember("frog_target", "frog", 1), { zone: "formation", slot: 0 });

    state = ok(state, { type: "chooseDiscoveryToSlot", discoveryId: "discovery_1", speciesId: "hare", to: { zone: "reserve", slot: 2 } });
    expect(reserveMembers(state)[2]?.speciesId).toBe("hare");
    expect(state.pendingDiscoveries.map((discovery) => discovery.discoveryId)).toEqual(["discovery_2", "discovery_3"]);
    expect(state.phase).toBe("upgradeDiscovery");

    state = ok(state, { type: "chooseDiscoveryAndMerge", discoveryId: "discovery_2", speciesId: "frog", targetUnitId: "frog_target" });
    expect(state.unitsById.frog_target.bondXp).toBe(2);
    expect(state.pendingDiscoveries.map((discovery) => discovery.discoveryId)).toEqual(["discovery_3"]);

    const supplyBefore = state.camp!.supply;
    state = ok(state, { type: "chooseDiscoverySupply", discoveryId: "discovery_3" });
    expect(state.camp!.supply).toBe(supplyBefore + 1);
    expect(state.pendingDiscoveries).toEqual([]);
    expect(state.phase).toBe("camp");
  });

  it("rejects upgrade discovery placement onto occupied different-species slots atomically", () => {
    const state = createExpedition(60);
    state.phase = "upgradeDiscovery";
    state.pendingDiscoveries = [{ discoveryId: "discovery_1", sourceInstanceId: "source", targetTier: 2, candidates: ["frog", "hare", "otter"] }];
    placeUnit(state, testMember("hare_target", "hare", 1), { zone: "formation", slot: 0 });

    expectAtomicFailure(state, { type: "chooseDiscoveryToSlot", discoveryId: "discovery_1", speciesId: "frog", to: { zone: "formation", slot: 0 } });
    expectAtomicFailure(state, { type: "chooseDiscoveryAndMerge", discoveryId: "discovery_1", speciesId: "frog", targetUnitId: "hare_target" });
    expect(state.pendingDiscoveries).toHaveLength(1);
    expect(state.unitsById.hare_target.bondXp).toBe(1);
  });

  it("allows moving, merging, and releasing existing animals while upgrade discovery is pending", () => {
    let state = createExpedition(61);
    state.phase = "upgradeDiscovery";
    state.pendingDiscoveries = [{ discoveryId: "discovery_1", sourceInstanceId: "source", targetTier: 2, candidates: ["frog", "hare", "otter"] }];
    placeUnit(state, testMember("a", "frog", 1), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("b", "hare", 1), { zone: "formation", slot: 1 });
    placeUnit(state, testMember("c", "frog", 1), { zone: "reserve", slot: 0 });

    state = ok(state, { type: "moveUnit", unitId: "a", to: { zone: "formation", slot: 4 } });
    expect(ids(formationMembers(state))).toEqual(["empty", "b", "empty", "empty", "a"]);
    state = ok(state, { type: "mergeUnits", sourceUnitId: "c", targetUnitId: "a" });
    expect(state.unitsById.a.bondXp).toBe(2);
    state = ok(state, { type: "releaseUnit", unitId: "b" });
    expect(state.unitsById.b).toBeUndefined();
    expect(state.phase).toBe("upgradeDiscovery");
    expect(state.pendingDiscoveries).toHaveLength(1);
  });

  it("rejects full-level merges without changing either unit", () => {
    const state = createExpedition(55);
    placeUnit(state, testMember("source", "frog", 1), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("target", "frog", 6), { zone: "formation", slot: 1 });
    expectAtomicFailure(state, { type: "mergeUnits", sourceUnitId: "source", targetUnitId: "target" });
    expect(state.unitsById.source.bondXp).toBe(1);
    expect(state.unitsById.target.bondXp).toBe(6);
  });

  it("swaps different species instead of treating occupied targets as merges", () => {
    let state = createExpedition(56);
    placeUnit(state, testMember("frog", "frog"), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("hare", "hare"), { zone: "reserve", slot: 2 });
    state = ok(state, { type: "moveUnit", unitId: "frog", to: { zone: "reserve", slot: 2 } });
    expect(ids(formationMembers(state))).toEqual(["hare", "empty", "empty", "empty", "empty"]);
    expect(ids(reserveMembers(state))).toEqual(["empty", "empty", "frog"]);
  });

  it("preflights P3A unit moves through domain rules and rejects occupied target slots", () => {
    const state = createExpedition(58);
    placeUnit(state, testMember("frog", "frog"), { zone: "formation", slot: 0 });
    placeUnit(state, testMember("hare", "hare"), { zone: "reserve", slot: 2 });
    const empty = preflightMoveUnitToEmptySlot(state, "frog", { zone: "formation", slot: 4 });
    expect(empty.ok).toBe(true);
    expect(empty.state).toEqual({ type: "moveUnit", unitId: "frog", to: { zone: "formation", slot: 4 } });
    const occupied = preflightMoveUnitToEmptySlot(state, "frog", { zone: "reserve", slot: 2 });
    expect(occupied.ok).toBe(false);
    expect(state.reserve[2]).toBe("hare");
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

  it("purchases item offers into exact inventory slots and rejects full inventory atomically", () => {
    let state = createExpedition(57);
    state.camp!.supply = 20;
    state.camp!.itemOffers[0].offer = { offerInstanceId: "offer_sling", itemId: "pinecone_sling" };
    state = ok(state, { type: "purchaseItemToInventory", offerId: "offer_sling", to: { zone: "inventory", slot: 2 } });
    expect(inventoryItems(state).map((item) => item?.itemId ?? "empty")).toEqual(["empty", "empty", "pinecone_sling"]);
    expect(state.camp!.itemOffers[0].offer).toBeNull();

    state.itemsById.item_a = { instanceId: "item_a", itemId: "red_berry" };
    state.itemsById.item_b = { instanceId: "item_b", itemId: "river_moss" };
    state.inventory[0] = "item_a";
    state.inventory[1] = "item_b";
    state.camp!.itemOffers[1].offer = { offerInstanceId: "offer_bond", itemId: "bond_nut" };
    const supplyBefore = state.camp!.supply;
    expectAtomicFailure(state, { type: "purchaseItemToInventory", offerId: "offer_bond", to: { zone: "inventory", slot: 1 } });
    expect(state.camp!.supply).toBe(supplyBefore);
    expect(state.camp!.itemOffers[1].offer?.offerInstanceId).toBe("offer_bond");
  });

  it("moves inventory items by stable item id", () => {
    let state = createExpedition(7);
    state.itemsById.stored = { instanceId: "stored", itemId: "pinecone_sling" };
    state.inventory[0] = "stored";
    state = ok(state, { type: "moveItem", itemInstanceId: "stored", to: { zone: "inventory", slot: 2 } });
    expect(inventoryItems(state).map((item) => item?.instanceId ?? "empty")).toEqual(["empty", "empty", "stored"]);
  });

  it("preserves held offers once and clears held state across camp enter", () => {
    let state = createExpedition(8);
    state = ok(state, { type: "refresh" });
    state = ok(state, { type: "toggleHold", slotKind: "animal", offerId: state.camp!.animalOffers[0].offer!.offerInstanceId });
    state = ok(state, { type: "toggleHold", slotKind: "item", offerId: state.camp!.itemOffers[0].offer!.offerInstanceId });
    const animalOffer = state.camp!.animalOffers[0].offer;
    const itemOffer = state.camp!.itemOffers[0].offer;
    const nextCamp = enterCamp({ ...state, round: state.round + 1 }, state.camp!.supply);
    expect(nextCamp.camp!.animalOffers[0].held).toBe(false);
    expect(nextCamp.camp!.animalOffers[0].offer).toEqual(animalOffer);
    expect(nextCamp.camp!.itemOffers[0].held).toBe(false);
    expect(nextCamp.camp!.itemOffers[0].offer).toEqual(itemOffer);
  });

  it("keeps invariants through 1000 deterministic random command sequences", () => {
    const species: SpeciesId[] = ["frog", "hare", "mussel", "swallow", "otter", "crow", "egret", "weasel"];
    for (let sequence = 0; sequence < 1000; sequence += 1) {
      let state = createExpedition(9000 + sequence);
      state.camp!.supply = 60;
      for (let i = 0; i < 3; i += 1) placeUnit(state, testMember(`s${sequence}_u${i}`, species[(sequence + i) % species.length]), { zone: "formation", slot: i as 0 | 1 | 2 });
      placeUnit(state, testMember(`s${sequence}_r0`, species[(sequence + 4) % species.length]), { zone: "reserve", slot: 0 });
      state.itemsById[`s${sequence}_item0`] = { instanceId: `s${sequence}_item0`, itemId: "red_berry" };
      state.inventory[0] = `s${sequence}_item0`;
      const camp = state.camp!;
      camp.animalOffers = camp.animalOffers.map((slot, index) => ({
        ...slot,
        unlocked: true,
        offer: { offerInstanceId: `s${sequence}_animal_offer${index}`, speciesId: species[(sequence + index + 1) % species.length] },
      })) as typeof camp.animalOffers;
      camp.itemOffers = camp.itemOffers.map((slot, index) => ({
        ...slot,
        unlocked: true,
        offer: { offerInstanceId: `s${sequence}_item_offer${index}`, itemId: index === 0 ? "pinecone_sling" : "river_moss" },
      })) as typeof camp.itemOffers;

      const nextInt = makeRng(0x20260620 ^ sequence);
      for (let step = 0; step < 100; step += 1) {
        const branch = nextInt() % 6;
        const before = JSON.stringify(state);
        let command: CampCommand;
        if (branch === 0) {
          const unitIds = occupiedUnitIds(state);
          command = { type: "moveUnit", unitId: unitIds[nextInt() % unitIds.length] ?? "missing", to: randomUnitSlot(nextInt) };
        } else if (branch === 1) {
          const itemIds = occupiedItemIds(state);
          command = { type: "moveItem", itemInstanceId: itemIds[nextInt() % itemIds.length] ?? "missing", to: { zone: "inventory", slot: (nextInt() % 3) as 0 | 1 | 2 } };
        } else if (branch === 2) {
          const offer = state.camp!.animalOffers[nextInt() % 5].offer?.offerInstanceId ?? "spent_offer";
          command = { type: "recruitAnimal", offerId: offer, to: randomUnitSlot(nextInt) };
        } else if (branch === 3) {
          const offer = state.camp!.itemOffers[nextInt() % 2].offer?.offerInstanceId ?? "spent_item_offer";
          command = { type: "purchaseItemToInventory", offerId: offer, to: { zone: "inventory", slot: (nextInt() % 3) as 0 | 1 | 2 } };
        } else if (branch === 4) {
          const unitIds = occupiedUnitIds(state);
          command = { type: "mergeUnits", sourceUnitId: unitIds[nextInt() % unitIds.length] ?? "missing_source", targetUnitId: unitIds[nextInt() % unitIds.length] ?? "missing_target" };
        } else {
          const offer = state.camp!.animalOffers[nextInt() % 5].offer?.offerInstanceId ?? "spent_offer";
          const unitIds = occupiedUnitIds(state);
          command = { type: "recruitAndMerge", offerId: offer, targetUnitId: unitIds[nextInt() % unitIds.length] ?? "missing_target" };
        }
        const result = applyCampCommand(state, command);
        if (result.ok) state = result.state.state;
        else expect(JSON.stringify(state), `${sequence}:${step}:${result.messageZh}`).toBe(before);
        assertCampInvariants(state);
        expect(state.formation).toHaveLength(5);
        expect(state.reserve).toHaveLength(3);
        expect(state.inventory).toHaveLength(3);
        expect(Number.isNaN(state.camp!.supply)).toBe(false);
        expect(new Set(occupiedUnitIds(state)).size).toBe(occupiedUnitIds(state).length);
        expect(new Set(occupiedItemIds(state)).size).toBe(occupiedItemIds(state).length);
      }
    }
  }, 30000);
});
