import { describe, expect, it } from "vitest";
import { applyCampCommand, formationMembers, inventoryItems } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import { createEmptySave, migrateSave } from "../src/domain/saveSchema";
import type { AppSave, ExpeditionState, SpeciesId, TeamMember } from "../src/domain/types";

function testMember(instanceId: string, speciesId: SpeciesId, bondXp = 1, permanentHealthBonus = 0): TeamMember {
  return { instanceId, speciesId, bondXp, permanentAttackBonus: 0, permanentHealthBonus, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

function place(state: ExpeditionState, member: TeamMember, slot = 0): void {
  state.unitsById[member.instanceId] = member;
  state.formation[slot as 0 | 1 | 2 | 3 | 4] = member.instanceId;
}

function placeReserve(state: ExpeditionState, member: TeamMember, slot = 0): void {
  state.unitsById[member.instanceId] = member;
  state.reserve[slot as 0 | 1 | 2] = member.instanceId;
}

function ok(state: ExpeditionState, command: Parameters<typeof applyCampCommand>[1]): ExpeditionState {
  const result = applyCampCommand(state, command);
  expect(result.ok, result.messageZh).toBe(true);
  return result.state.state;
}

describe("P2 item commands", () => {
  it("single and habitat food apply through purchaseAndApplyItem atomically", () => {
    let state = createExpedition(12);
    place(state, testMember("frog", "frog"), 0);
    place(state, testMember("hare", "hare"), 1);
    state.camp!.itemOffers[0].offer = { offerInstanceId: "red", itemId: "red_berry" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "units", unitIds: ["frog"] } });
    expect(state.unitsById.frog.permanentAttackBonus).toBe(1);
    state.camp!.supply = 10;
    state.camp!.itemOffers[1].offer = { offerInstanceId: "moss", itemId: "river_moss" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "moss", target: { kind: "units", unitIds: [] } });
    expect(state.unitsById.frog.permanentHealthBonus).toBe(3);
    expect(state.unitsById.hare.permanentHealthBonus).toBe(0);
  });

  it("empty or illegal target does not spend supply or consume offer", () => {
    const state = createExpedition(13);
    state.camp!.supply = 10;
    state.camp!.itemOffers[0].offer = { offerInstanceId: "red", itemId: "red_berry" };
    const result = applyCampCommand(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "units", unitIds: ["missing"] } });
    expect(result.ok).toBe(false);
    expect(state.camp!.supply).toBe(10);
    expect(state.camp!.itemOffers[0].offer?.offerInstanceId).toBe("red");
  });

  it("inventory equipment can be applied to a unit", () => {
    let state = createExpedition(14);
    place(state, testMember("hare", "hare"));
    state.itemsById.s1 = { instanceId: "s1", itemId: "pinecone_sling" };
    state.inventory[0] = "s1";
    state = ok(state, { type: "applyInventoryItem", itemInstanceId: "s1", target: { kind: "units", unitIds: ["hare"] } });
    expect(state.unitsById.hare.equipment?.itemId).toBe("pinecone_sling");
    expect(inventoryItems(state)).toEqual([null, null, null]);
  });

  it("market item can be purchased into a specified inventory slot", () => {
    let state = createExpedition(15);
    state.camp!.itemOffers[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };
    state = ok(state, { type: "purchaseItemToInventory", offerId: "sling", to: { zone: "inventory", slot: 2 } });
    expect(inventoryItems(state)[2]?.itemId).toBe("pinecone_sling");
    expect(state.camp!.itemOffers[0].offer).toBeNull();
  });

  it("market equipment replacement returns old equipment to empty inventory slot", () => {
    let state = createExpedition(16);
    const frog = testMember("frog", "frog");
    frog.equipment = { instanceId: "old", itemId: "pinecone_sling" };
    place(state, frog);
    state.camp!.itemOffers[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "sling", target: { kind: "units", unitIds: ["frog"] } });
    expect(formationMembers(state)[0]?.equipment?.itemId).toBe("pinecone_sling");
    expect(inventoryItems(state).some((item) => item?.instanceId === "old")).toBe(true);
  });

  it("replacement is blocked when inventory is full and discard is not confirmed", () => {
    const state = createExpedition(17);
    const frog = testMember("frog", "frog");
    frog.equipment = { instanceId: "old", itemId: "pinecone_sling" };
    place(state, frog);
    state.itemsById.i0 = { instanceId: "i0", itemId: "pinecone_sling" };
    state.itemsById.i1 = { instanceId: "i1", itemId: "pinecone_sling" };
    state.itemsById.i2 = { instanceId: "i2", itemId: "pinecone_sling" };
    state.inventory = ["i0", "i1", "i2"];
    state.camp!.itemOffers[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };
    const result = applyCampCommand(state, { type: "purchaseAndApplyItem", offerId: "sling", target: { kind: "units", unitIds: ["frog"] } });
    expect(result.ok).toBe(false);
    expect(state.unitsById.frog.equipment?.instanceId).toBe("old");
    expect(state.camp!.itemOffers[0].offer?.offerInstanceId).toBe("sling");
  });
});

describe("P4B atomic item use", () => {
  it("validates supply before consuming market offers or mutating targets", () => {
    const state = createExpedition(180);
    state.camp!.supply = 0;
    place(state, testMember("frog", "frog"));
    state.camp!.itemOffers[0].offer = { offerInstanceId: "red", itemId: "red_berry" };

    const result = applyCampCommand(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "unit", unitId: "frog" } });

    expect(result.ok).toBe(false);
    expect(result.messageZh).toBe("补给不足，无法购买道具。");
    expect(state.camp!.itemOffers[0].offer?.offerInstanceId).toBe("red");
    expect(state.unitsById.frog.permanentAttackBonus).toBe(0);
  });

  it("stores market items into exact inventory slots and rejects occupied slots without side effects", () => {
    let state = createExpedition(181);
    state.camp!.supply = 10;
    state.camp!.itemOffers[0].offer = { offerInstanceId: "berry", itemId: "red_berry" };
    state.itemsById.old = { instanceId: "old", itemId: "melatonin" };
    state.inventory[1] = "old";

    const invalid = applyCampCommand(state, { type: "purchaseItemToInventory", offerId: "berry", to: { zone: "inventory", slot: 1 } });
    expect(invalid.ok).toBe(false);
    expect(state.camp!.supply).toBe(10);
    expect(state.camp!.itemOffers[0].offer?.offerInstanceId).toBe("berry");
    expect(state.inventory).toEqual([null, "old", null]);

    state = ok(state, { type: "purchaseItemToInventory", offerId: "berry", to: { zone: "inventory", slot: 2 } });
    expect(state.inventory[2]).toBeTruthy();
    expect(inventoryItems(state)[2]?.itemId).toBe("red_berry");
    expect(state.camp!.itemOffers[0].offer).toBeNull();
  });

  it("applies direct market targets atomically for single, group, and all-formation food", () => {
    let state = createExpedition(182);
    state.camp!.supply = 20;
    place(state, testMember("frog", "frog"), 0);
    place(state, testMember("hare", "hare"), 1);
    placeReserve(state, testMember("mussel", "mussel"), 0);

    state.camp!.itemOffers[0].offer = { offerInstanceId: "red", itemId: "red_berry" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "unit", unitId: "frog" } });
    expect(state.unitsById.frog.permanentAttackBonus).toBe(1);

    state.camp!.itemOffers[0].offer = { offerInstanceId: "moss", itemId: "river_moss" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "moss", target: { kind: "unit", unitId: "frog" } });
    expect(state.unitsById.frog.permanentHealthBonus).toBe(3);
    expect(state.unitsById.mussel.permanentHealthBonus).toBe(2);
    expect(state.unitsById.hare.permanentHealthBonus).toBe(0);

    state.camp!.itemOffers[0].offer = { offerInstanceId: "lotus", itemId: "team_lotus_seed" };
    state = ok(state, { type: "purchaseAndApplyItem", offerId: "lotus", target: { kind: "allOwned" } });
    expect(state.unitsById.frog.permanentHealthBonus).toBe(4);
    expect(state.unitsById.hare.permanentHealthBonus).toBe(1);
    expect(state.unitsById.mussel.permanentHealthBonus).toBe(2);
  });

  it("rejects empty group targets before charging supply or consuming offers", () => {
    const state = createExpedition(183);
    state.camp!.supply = 10;
    place(state, testMember("hare", "hare"));
    state.camp!.itemOffers[0].offer = { offerInstanceId: "moss", itemId: "river_moss" };

    const result = applyCampCommand(state, { type: "purchaseAndApplyItem", offerId: "moss", target: { kind: "allOwned" } });

    expect(result.ok).toBe(false);
    expect(result.messageZh).toBe("没有符合水域族群的目标。");
    expect(state.camp!.supply).toBe(10);
    expect(state.camp!.itemOffers[0].offer?.offerInstanceId).toBe("moss");
  });

  it("consumes inventory food exactly once and rejects duplicate submissions", () => {
    let state = createExpedition(184);
    place(state, testMember("frog", "frog"));
    state.itemsById.berry = { instanceId: "berry", itemId: "red_berry" };
    state.inventory[0] = "berry";

    state = ok(state, { type: "applyInventoryItem", itemInstanceId: "berry", target: { kind: "unit", unitId: "frog" } });
    expect(state.unitsById.frog.permanentAttackBonus).toBe(1);
    expect(state.itemsById.berry).toBeUndefined();
    expect(state.inventory[0]).toBeNull();

    const before = JSON.stringify(state);
    const duplicate = applyCampCommand(state, { type: "applyInventoryItem", itemInstanceId: "berry", target: { kind: "unit", unitId: "frog" } });
    expect(duplicate.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.unitsById.frog.permanentAttackBonus).toBe(1);
  });

  it("rejects duplicate market submissions without charging twice", () => {
    let state = createExpedition(185);
    state.camp!.supply = 10;
    place(state, testMember("frog", "frog"));
    state.camp!.itemOffers[0].offer = { offerInstanceId: "red", itemId: "red_berry" };

    state = ok(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "unit", unitId: "frog" } });
    const supplyAfterFirst = state.camp!.supply;
    const before = JSON.stringify(state);
    const duplicate = applyCampCommand(state, { type: "purchaseAndApplyItem", offerId: "red", target: { kind: "unit", unitId: "frog" } });

    expect(duplicate.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.camp!.supply).toBe(supplyAfterFirst);
    expect(state.unitsById.frog.permanentAttackBonus).toBe(1);
  });

  it("handles equipment replacement from market and blocks market replacement when inventory is full", () => {
    let state = createExpedition(186);
    state.camp!.supply = 10;
    const frog = testMember("frog", "frog");
    frog.equipment = { instanceId: "old", itemId: "pinecone_sling" };
    place(state, frog);
    state.camp!.itemOffers[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };

    state = ok(state, { type: "purchaseAndApplyItem", offerId: "sling", target: { kind: "unit", unitId: "frog" } });
    expect(state.unitsById.frog.equipment?.instanceId).not.toBe("old");
    expect(inventoryItems(state).some((item) => item?.instanceId === "old")).toBe(true);

    const full = createExpedition(187);
    full.camp!.supply = 10;
    const hare = testMember("hare", "hare");
    hare.equipment = { instanceId: "old_hare", itemId: "pinecone_sling" };
    place(full, hare);
    full.inventory = ["i0", "i1", "i2"];
    full.itemsById.i0 = { instanceId: "i0", itemId: "red_berry" };
    full.itemsById.i1 = { instanceId: "i1", itemId: "red_berry" };
    full.itemsById.i2 = { instanceId: "i2", itemId: "red_berry" };
    full.camp!.itemOffers[0].offer = { offerInstanceId: "sling", itemId: "pinecone_sling" };
    const result = applyCampCommand(full, { type: "purchaseAndApplyItem", offerId: "sling", target: { kind: "unit", unitId: "hare" } });
    expect(result.ok).toBe(false);
    expect(full.camp!.supply).toBe(10);
    expect(full.camp!.itemOffers[0].offer?.offerInstanceId).toBe("sling");
    expect(full.unitsById.hare.equipment?.instanceId).toBe("old_hare");
  });

  it("replaces equipment from a full inventory by using the consumed item slot for the old equipment", () => {
    let state = createExpedition(188);
    const frog = testMember("frog", "frog");
    frog.equipment = { instanceId: "old", itemId: "pinecone_sling" };
    place(state, frog);
    state.inventory = ["new", "i1", "i2"];
    state.itemsById.new = { instanceId: "new", itemId: "pinecone_sling" };
    state.itemsById.i1 = { instanceId: "i1", itemId: "red_berry" };
    state.itemsById.i2 = { instanceId: "i2", itemId: "melatonin" };

    state = ok(state, { type: "applyInventoryItem", itemInstanceId: "new", target: { kind: "unit", unitId: "frog" } });

    expect(state.unitsById.frog.equipment?.instanceId).toBe("new");
    expect(state.inventory[0]).toBe("old");
    expect(state.itemsById.old?.itemId).toBe("pinecone_sling");
  });

  it("persists melatonin temporary status through save reload", () => {
    let state = createExpedition(189);
    place(state, testMember("otter", "otter"));
    state.itemsById.sleep = { instanceId: "sleep", itemId: "melatonin" };
    state.inventory[0] = "sleep";
    state = ok(state, { type: "applyInventoryItem", itemInstanceId: "sleep", target: { kind: "unit", unitId: "otter" } });
    expect(state.unitsById.otter.timedStatuses[0]?.def.kind).toBe("sleepThenEmpower");

    const save: AppSave = { ...createEmptySave(), saveRevision: 9, activeExpedition: state };
    const reloaded = migrateSave(JSON.parse(JSON.stringify(save)));

    expect(reloaded?.activeExpedition?.unitsById.otter.timedStatuses[0]?.def).toEqual({
      kind: "sleepThenEmpower",
      remainingParticipatingBattles: 1,
      sleeping: true,
      bonusDamagePerAttack: 5,
      bonusAttackChargesAfterWake: 3,
    });
  });
});
