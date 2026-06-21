import { describe, expect, it } from "vitest";
import { applyCampCommand, formationMembers, inventoryItems } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { ExpeditionState, SpeciesId, TeamMember } from "../src/domain/types";

function testMember(instanceId: string, speciesId: SpeciesId, bondXp = 1, permanentHealthBonus = 0): TeamMember {
  return { instanceId, speciesId, bondXp, permanentAttackBonus: 0, permanentHealthBonus, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

function place(state: ExpeditionState, member: TeamMember, slot = 0): void {
  state.unitsById[member.instanceId] = member;
  state.formation[slot as 0 | 1 | 2 | 3 | 4] = member.instanceId;
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
