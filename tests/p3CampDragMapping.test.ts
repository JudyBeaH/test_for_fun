import { describe, expect, it } from "vitest";
import { applyCampCommand, assertCampInvariants, formationMembers, reserveMembers, inventoryItems } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import { buildCampClickCommand, buildCampDragCommand, campClickSourceAfterKey, preflightCampDragCommand } from "../src/app/interaction/campDragMapping";
import { createPointerDragController } from "../src/app/interaction/usePointerDragController";
import type { CampDragPayload, CampDropTarget, PointerDragWindowTarget } from "../src/app/interaction/gestureTypes";
import type { CampCommand, ExpeditionState, SpeciesId, TeamMember, UnitSlotRef } from "../src/domain/types";

class FakeWindow implements PointerDragWindowTarget {
  listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function pointer(x: number, y: number) {
  return { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: "mouse", preventDefault() {} };
}

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

function baseState(): ExpeditionState {
  const state = createExpedition(3030);
  state.camp!.supply = 50;
  placeUnit(state, testMember("frog_a", "frog", 1), { zone: "formation", slot: 0 });
  placeUnit(state, testMember("hare", "hare", 1), { zone: "formation", slot: 1 });
  placeUnit(state, testMember("frog_b", "frog", 1), { zone: "formation", slot: 3 });
  placeUnit(state, testMember("mussel", "mussel", 1), { zone: "reserve", slot: 0 });
  state.camp!.animalOffers[0].offer = { offerInstanceId: "offer_otter", speciesId: "otter" };
  state.camp!.animalOffers[1].offer = { offerInstanceId: "offer_frog", speciesId: "frog" };
  state.camp!.itemOffers[0].offer = { offerInstanceId: "offer_sling", itemId: "pinecone_sling" };
  state.pendingDiscoveries = [{ discoveryId: "discovery_1", sourceInstanceId: "frog_a", targetTier: 2, candidates: ["frog", "hare", "otter"] }];
  state.itemsById.item_a = { instanceId: "item_a", itemId: "red_berry" };
  state.itemsById.item_b = { instanceId: "item_b", itemId: "river_moss" };
  state.inventory[0] = "item_a";
  state.inventory[1] = "item_b";
  assertCampInvariants(state);
  return state;
}

function runGesture(state: ExpeditionState, payload: CampDragPayload, target: CampDropTarget | null) {
  const fakeWindow = new FakeWindow();
  const dispatched: CampCommand[] = [];
  const rejected: string[] = [];
  let nextState = state;
  let mappingMessage: string | null = null;
  const controller = createPointerDragController<CampDragPayload, CampDropTarget, CampCommand>({
    windowTarget: fakeWindow,
    thresholdPx: 7,
    getDropTarget: () => target,
    buildCommand: (dragPayload, dropTarget) => {
      const result = buildCampDragCommand(nextState, dragPayload, dropTarget);
      mappingMessage = result.ok ? null : result.messageZh;
      return result.ok ? result.command : null;
    },
    preflight: (command) => preflightCampDragCommand(nextState, command),
    dispatch: (command) => {
      dispatched.push(command);
      const result = applyCampCommand(nextState, command);
      expect(result.ok, result.messageZh).toBe(true);
      nextState = result.state.state;
      assertCampInvariants(nextState);
    },
    onRejected: (messageZh) => rejected.push(mappingMessage ?? messageZh),
  });

  controller.handlePointerDown(pointer(0, 0), payload);
  fakeWindow.emit("pointermove", pointer(8, 0));
  fakeWindow.emit("pointerup", pointer(8, 0));

  return { dispatched, rejected, state: nextState };
}

describe("P3B camp drag mapping", () => {
  it("maps formation reorder and swap to one moveUnit command", () => {
    const result = runGesture(baseState(), { kind: "ownedUnit", unitId: "hare" }, { kind: "unitSlot", ref: { zone: "formation", slot: 4 } });
    expect(result.dispatched).toEqual([{ type: "moveUnit", unitId: "hare", to: { zone: "formation", slot: 4 } }]);
    expect(ids(formationMembers(result.state))).toEqual(["frog_a", "empty", "empty", "frog_b", "hare"]);

    const swap = runGesture(baseState(), { kind: "ownedUnit", unitId: "hare" }, { kind: "unitSlot", ref: { zone: "reserve", slot: 0 } });
    expect(swap.dispatched).toEqual([{ type: "moveUnit", unitId: "hare", to: { zone: "reserve", slot: 0 } }]);
    expect(ids(formationMembers(swap.state))).toEqual(["frog_a", "mussel", "empty", "frog_b", "empty"]);
    expect(ids(reserveMembers(swap.state))).toEqual(["hare", "empty", "empty"]);
  });

  it("maps same-species owned-unit drops to one mergeUnits command", () => {
    const result = runGesture(baseState(), { kind: "ownedUnit", unitId: "frog_a" }, { kind: "unitSlot", ref: { zone: "formation", slot: 3 } });
    expect(result.dispatched).toEqual([{ type: "mergeUnits", sourceUnitId: "frog_a", targetUnitId: "frog_b" }]);
    expect(result.state.unitsById.frog_a).toBeUndefined();
    expect(result.state.unitsById.frog_b.bondXp).toBe(2);
  });

  it("maps animal offers to exact unit slots or recruitAndMerge on same species", () => {
    const exact = runGesture(baseState(), { kind: "animalOffer", offerId: "offer_otter" }, { kind: "unitSlot", ref: { zone: "reserve", slot: 2 } });
    expect(exact.dispatched).toEqual([{ type: "recruitAnimal", offerId: "offer_otter", to: { zone: "reserve", slot: 2 } }]);
    expect(reserveMembers(exact.state)[2]?.speciesId).toBe("otter");

    const merge = runGesture(baseState(), { kind: "animalOffer", offerId: "offer_frog" }, { kind: "unitSlot", ref: { zone: "formation", slot: 0 } });
    expect(merge.dispatched).toEqual([{ type: "recruitAndMerge", offerId: "offer_frog", targetUnitId: "frog_a" }]);
    expect(merge.state.unitsById.frog_a.bondXp).toBe(2);
  });

  it("maps item offers to exact inventory slots and inventory item reorder to moveItem", () => {
    const buy = runGesture(baseState(), { kind: "itemOffer", offerId: "offer_sling" }, { kind: "inventorySlot", ref: { zone: "inventory", slot: 2 } });
    expect(buy.dispatched).toEqual([{ type: "purchaseItemToInventory", offerId: "offer_sling", to: { zone: "inventory", slot: 2 } }]);
    expect(inventoryItems(buy.state).map((item) => item?.itemId ?? "empty")).toEqual(["red_berry", "river_moss", "pinecone_sling"]);

    const reorder = runGesture(baseState(), { kind: "inventoryItem", itemInstanceId: "item_a" }, { kind: "inventorySlot", ref: { zone: "inventory", slot: 1 } });
    expect(reorder.dispatched).toEqual([{ type: "moveItem", itemInstanceId: "item_a", to: { zone: "inventory", slot: 1 } }]);
    expect(reorder.state.inventory).toEqual(["item_b", "item_a", null]);
  });

  it("maps upgrade discovery cards to exact slots, same-species merge, or no-op reasons", () => {
    const exact = buildCampDragCommand(baseState(), { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "hare" }, { kind: "unitSlot", ref: { zone: "formation", slot: 2 } });
    expect(exact).toEqual({ ok: true, command: { type: "chooseDiscoveryToSlot", discoveryId: "discovery_1", speciesId: "hare", to: { zone: "formation", slot: 2 } } });

    const merge = buildCampDragCommand(baseState(), { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "frog" }, { kind: "unitSlot", ref: { zone: "formation", slot: 0 } });
    expect(merge).toEqual({ ok: true, command: { type: "chooseDiscoveryAndMerge", discoveryId: "discovery_1", speciesId: "frog", targetUnitId: "frog_a" } });

    const occupied = buildCampDragCommand(baseState(), { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "otter" }, { kind: "unitSlot", ref: { zone: "formation", slot: 0 } });
    expect(occupied).toEqual({ ok: false, messageZh: "目标位置已有不同物种动物。" });

    const release = buildCampDragCommand(baseState(), { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "frog" }, { kind: "releaseZone" });
    expect(release).toEqual({ ok: false, messageZh: "未加入的发现动物无需放生。" });
  });

  it("maps the release zone to release or discard commands only for owned or pending units", () => {
    const owned = runGesture(baseState(), { kind: "ownedUnit", unitId: "hare" }, { kind: "releaseZone" });
    expect(owned.dispatched).toEqual([{ type: "releaseUnit", unitId: "hare" }]);
    expect(owned.state.unitsById.hare).toBeUndefined();

    const pendingState = baseState();
    pendingState.pendingRecruit = testMember("pending", "otter");
    pendingState.phase = "upgradeDiscovery";
    const pending = runGesture(pendingState, { kind: "pendingRecruit" }, { kind: "releaseZone" });
    expect(pending.dispatched).toEqual([{ type: "discardPendingRecruit" }]);
    expect(pending.state.pendingRecruit).toBeNull();

    const offer = runGesture(baseState(), { kind: "animalOffer", offerId: "offer_otter" }, { kind: "releaseZone" });
    expect(offer.dispatched).toEqual([]);
    expect(offer.rejected).toEqual(["邂逅动物尚未加入，不能放生。"]);
  });

  it("turns invalid drops into no-op Chinese reasons", () => {
    const invalidSpecies = runGesture(baseState(), { kind: "animalOffer", offerId: "offer_otter" }, { kind: "unitSlot", ref: { zone: "formation", slot: 0 } });
    expect(invalidSpecies.dispatched).toEqual([]);
    expect(invalidSpecies.rejected).toEqual(["目标位置已有不同物种动物。"]);

    const itemToUnit = runGesture(baseState(), { kind: "itemOffer", offerId: "offer_sling" }, { kind: "unitSlot", ref: { zone: "formation", slot: 0 } });
    expect(itemToUnit.dispatched).toEqual([]);
    expect(itemToUnit.rejected).toEqual(["P3B 暂不支持拖拽道具直接使用。"]);

    const noTarget = runGesture(baseState(), { kind: "ownedUnit", unitId: "hare" }, null);
    expect(noTarget.dispatched).toEqual([]);
    expect(noTarget.rejected).toEqual(["没有可放置目标。"]);
  });
});

describe("P3C camp click parity", () => {
  const coreCases: Array<{ name: string; payload: CampDragPayload; target: CampDropTarget | null }> = [
    { name: "formation reorder", payload: { kind: "ownedUnit", unitId: "hare" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 4 } } },
    { name: "formation reserve swap", payload: { kind: "ownedUnit", unitId: "hare" }, target: { kind: "unitSlot", ref: { zone: "reserve", slot: 0 } } },
    { name: "owned same species merge", payload: { kind: "ownedUnit", unitId: "frog_a" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 3 } } },
    { name: "animal offer to exact reserve", payload: { kind: "animalOffer", offerId: "offer_otter" }, target: { kind: "unitSlot", ref: { zone: "reserve", slot: 2 } } },
    { name: "animal offer same species merge", payload: { kind: "animalOffer", offerId: "offer_frog" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 0 } } },
    { name: "item offer to exact inventory", payload: { kind: "itemOffer", offerId: "offer_sling" }, target: { kind: "inventorySlot", ref: { zone: "inventory", slot: 2 } } },
    { name: "inventory reorder", payload: { kind: "inventoryItem", itemInstanceId: "item_a" }, target: { kind: "inventorySlot", ref: { zone: "inventory", slot: 1 } } },
    { name: "upgrade discovery to exact slot", payload: { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "hare" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 2 } } },
    { name: "upgrade discovery same species merge", payload: { kind: "upgradeDiscovery", discoveryId: "discovery_1", speciesId: "frog" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 0 } } },
    { name: "owned release", payload: { kind: "ownedUnit", unitId: "hare" }, target: { kind: "releaseZone" } },
    { name: "invalid item target", payload: { kind: "itemOffer", offerId: "offer_sling" }, target: { kind: "unitSlot", ref: { zone: "formation", slot: 0 } } },
    { name: "invalid missing target", payload: { kind: "ownedUnit", unitId: "hare" }, target: null },
  ];

  it.each(coreCases)("builds structurally identical drag and click results for $name", ({ payload, target }) => {
    const state = baseState();

    expect(buildCampClickCommand(state, payload, target)).toStrictEqual(buildCampDragCommand(state, payload, target));
  });

  it("click path dispatches exactly one drag-equivalent command and preserves invariants", () => {
    const state = baseState();
    const payload: CampDragPayload = { kind: "ownedUnit", unitId: "hare" };
    const target: CampDropTarget = { kind: "unitSlot", ref: { zone: "reserve", slot: 0 } };
    const drag = buildCampDragCommand(state, payload, target);
    const click = buildCampClickCommand(state, payload, target);

    expect(click).toStrictEqual(drag);
    expect(click.ok).toBe(true);
    if (!click.ok) return;

    const result = applyCampCommand(state, click.command);
    expect(result.ok, result.messageZh).toBe(true);
    assertCampInvariants(result.state.state);
    expect(result.state.command).toStrictEqual(click.command);
  });

  it("cancels the click-source selection on Escape without changing other keys", () => {
    const source: CampDragPayload = { kind: "animalOffer", offerId: "offer_otter" };

    expect(campClickSourceAfterKey(source, "Tab")).toBe(source);
    expect(campClickSourceAfterKey(source, "Escape")).toBeNull();
    expect(campClickSourceAfterKey(null, "Escape")).toBeNull();
  });
});
