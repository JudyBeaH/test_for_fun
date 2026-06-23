import { applyCampCommand } from "../../domain/campEngine";
import type { CampCommand, ExpeditionState, ItemSlotRef, SpeciesId, UnitSlotRef } from "../../domain/types";
import type { CampDragPayload, CampDropTarget, PointerPreflightResult } from "./gestureTypes";

export type CampDragCommandResult =
  | { ok: true; command: CampCommand }
  | { ok: false; messageZh: string };

function unitIdAt(state: ExpeditionState, ref: UnitSlotRef): string | null {
  return ref.zone === "formation" ? state.formation[ref.slot] : state.reserve[ref.slot];
}

function itemIdAt(state: ExpeditionState, ref: ItemSlotRef): string | null {
  return state.inventory[ref.slot];
}

function animalOffer(state: ExpeditionState, offerId: string) {
  return state.camp?.animalOffers.find((slot) => slot.offer?.offerInstanceId === offerId)?.offer ?? null;
}

function itemOffer(state: ExpeditionState, offerId: string) {
  return state.camp?.itemOffers.find((slot) => slot.offer?.offerInstanceId === offerId)?.offer ?? null;
}

export function buildCampDragCommand(state: ExpeditionState, payload: CampDragPayload, target: CampDropTarget | null): CampDragCommandResult {
  if (!target) return { ok: false, messageZh: "没有可放置目标。" };

  if (payload.kind === "ownedUnit") {
    if (target.kind === "releaseZone") return { ok: true, command: { type: "releaseUnit", unitId: payload.unitId } };
    if (target.kind !== "unitSlot") return { ok: false, messageZh: "动物不能放入仓库。" };
    const targetUnitId = unitIdAt(state, target.ref);
    if (!targetUnitId || targetUnitId === payload.unitId) return { ok: true, command: { type: "moveUnit", unitId: payload.unitId, to: target.ref } };
    const source = state.unitsById[payload.unitId];
    const targetUnit = state.unitsById[targetUnitId];
    if (!source || !targetUnit) return { ok: false, messageZh: "没有找到要移动的动物。" };
    if (source.speciesId === targetUnit.speciesId) return { ok: true, command: { type: "mergeUnits", sourceUnitId: payload.unitId, targetUnitId } };
    return { ok: true, command: { type: "moveUnit", unitId: payload.unitId, to: target.ref } };
  }

  if (payload.kind === "animalOffer") {
    if (target.kind === "releaseZone") return { ok: false, messageZh: "邂逅动物尚未加入，不能放生。" };
    if (target.kind !== "unitSlot") return { ok: false, messageZh: "动物邂逅不能放入仓库。" };
    const offer = animalOffer(state, payload.offerId);
    if (!offer) return { ok: false, messageZh: "这个动物位没有可招募动物。" };
    const targetUnitId = unitIdAt(state, target.ref);
    if (!targetUnitId) return { ok: true, command: { type: "recruitAnimal", offerId: payload.offerId, to: target.ref } };
    const targetUnit = state.unitsById[targetUnitId];
    if (targetUnit?.speciesId === offer.speciesId) return { ok: true, command: { type: "recruitAndMerge", offerId: payload.offerId, targetUnitId } };
    return { ok: false, messageZh: "目标位置已有不同物种动物。" };
  }

  if (payload.kind === "upgradeDiscovery") {
    if (target.kind === "releaseZone") return { ok: false, messageZh: "未加入的发现动物无需放生。" };
    if (target.kind !== "unitSlot") return { ok: false, messageZh: "升级发现动物不能放入仓库。" };
    const discovery = state.pendingDiscoveries.find((item) => item.discoveryId === payload.discoveryId);
    if (!discovery || !discovery.candidates.includes(payload.speciesId as SpeciesId)) return { ok: false, messageZh: "没有这个高级发现。" };
    const targetUnitId = unitIdAt(state, target.ref);
    if (!targetUnitId) return { ok: true, command: { type: "chooseDiscoveryToSlot", discoveryId: payload.discoveryId, speciesId: payload.speciesId as SpeciesId, to: target.ref } };
    const targetUnit = state.unitsById[targetUnitId];
    if (targetUnit?.speciesId === payload.speciesId) return { ok: true, command: { type: "chooseDiscoveryAndMerge", discoveryId: payload.discoveryId, speciesId: payload.speciesId as SpeciesId, targetUnitId } };
    return { ok: false, messageZh: "目标位置已有不同物种动物。" };
  }

  if (payload.kind === "pendingRecruit") {
    if (target.kind === "releaseZone") return { ok: true, command: { type: "discardPendingRecruit" } };
    if (target.kind !== "unitSlot") return { ok: false, messageZh: "待安置动物不能放入仓库。" };
    if (!state.pendingRecruit) return { ok: false, messageZh: "没有待安置的新伙伴。" };
    const targetUnitId = unitIdAt(state, target.ref);
    if (targetUnitId) return { ok: false, messageZh: "目标位置已有动物。" };
    return { ok: true, command: { type: "placePendingRecruit", to: target.ref } };
  }

  if (payload.kind === "itemOffer") {
    if (target.kind === "releaseZone") return { ok: false, messageZh: "道具不能放生。" };
    if (target.kind !== "inventorySlot") return { ok: false, messageZh: "P3B 暂不支持拖拽道具直接使用。" };
    if (!itemOffer(state, payload.offerId)) return { ok: false, messageZh: "这个道具位是空的。" };
    return { ok: true, command: { type: "purchaseItemToInventory", offerId: payload.offerId, to: target.ref } };
  }

  if (payload.kind === "inventoryItem") {
    if (target.kind === "releaseZone") return { ok: false, messageZh: "仓库道具不能放生。" };
    if (target.kind !== "inventorySlot") return { ok: false, messageZh: "P3B 暂不支持仓库道具拖拽使用。" };
    if (!state.itemsById[payload.itemInstanceId] || !state.inventory.includes(payload.itemInstanceId)) return { ok: false, messageZh: "没有找到仓库道具。" };
    if (itemIdAt(state, target.ref) === payload.itemInstanceId) return { ok: true, command: { type: "moveItem", itemInstanceId: payload.itemInstanceId, to: target.ref } };
    return { ok: true, command: { type: "moveItem", itemInstanceId: payload.itemInstanceId, to: target.ref } };
  }

  return { ok: false, messageZh: "未知拖拽来源。" };
}

export function preflightCampDragCommand(state: ExpeditionState, command: CampCommand): PointerPreflightResult {
  const result = applyCampCommand(state, command);
  return { ok: result.ok, messageZh: result.messageZh };
}

export function buildCampClickCommand(state: ExpeditionState, payload: CampDragPayload, target: CampDropTarget | null): CampDragCommandResult {
  return buildCampDragCommand(state, payload, target);
}

export function campClickSourceAfterKey(payload: CampDragPayload | null, key: string): CampDragPayload | null {
  return key === "Escape" ? null : payload;
}

export function preflightCampClickTarget(state: ExpeditionState, payload: CampDragPayload | null, target: CampDropTarget): PointerPreflightResult {
  if (!payload) return { ok: false, messageZh: "请先选择来源。" };
  const result = buildCampClickCommand(state, payload, target);
  if (!result.ok) return { ok: false, messageZh: result.messageZh };
  return preflightCampDragCommand(state, result.command);
}
