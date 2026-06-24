import { ANIMALS, ANIMAL_BY_ID } from "../content/animals";
import { CAMP_LEVELS } from "../content/campLevels";
import { DEFAULT_CAMP_ECONOMY } from "../content/constants";
import { ITEMS, ITEM_BY_ID } from "../content/items";
import { resolveItemTargets } from "./itemTargeting";
import type {
  AnimalOffer,
  CampCommand,
  CampModifier,
  CampTransition,
  ComputedCampRules,
  DomainResult,
  ExpeditionState,
  Fixed2,
  Fixed3,
  Fixed5,
  ItemInstance,
  ItemInstanceId,
  ItemOffer,
  ItemSlotRef,
  ItemTarget,
  ItemTargetCandidate,
  ItemTargetPreview,
  OfferId,
  OfferSlot,
  SpeciesId,
  TeamMember,
  TeamSnapshot,
  TeamSnapshotUnit,
  UnitId,
  UnitSlotRef,
  UpgradeDiscovery,
} from "./types";
import { makeId } from "./ids";
import { createRng, type Rng } from "./rng";

export function levelFromBondXp(bondXp: number): 1 | 2 | 3 {
  if (bondXp >= 6) return 3;
  if (bondXp >= 3) return 2;
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function emptyFormation(): Fixed5<UnitId | null> {
  return [null, null, null, null, null];
}

export function emptyReserve(): Fixed3<UnitId | null> {
  return [null, null, null];
}

export function emptyInventory(): Fixed3<ItemInstanceId | null> {
  return [null, null, null];
}

function fixed5<T>(items: readonly T[], fallback: T): Fixed5<T> {
  return [items[0] ?? fallback, items[1] ?? fallback, items[2] ?? fallback, items[3] ?? fallback, items[4] ?? fallback];
}

function fixed2<T>(items: readonly T[], fallback: T): Fixed2<T> {
  return [items[0] ?? fallback, items[1] ?? fallback];
}

export function memberLevel(member: TeamMember): 1 | 2 | 3 {
  return levelFromBondXp(member.bondXp);
}

export function createMember(speciesId: SpeciesId, seed: number, round: number, index: number): TeamMember {
  return {
    instanceId: makeId("member", seed + round * 4099, index),
    speciesId,
    bondXp: 1,
    permanentAttackBonus: 0,
    permanentHealthBonus: 0,
    equipment: null,
    timedStatuses: [],
    acquiredAtRound: round,
    participatedRounds: 0,
  };
}

function createUniqueMember(state: ExpeditionState, speciesId: SpeciesId, seed: number): TeamMember {
  let index = Object.keys(state.unitsById).length + 1;
  let member = createMember(speciesId, seed, state.round, index);
  while (state.unitsById[member.instanceId] || state.pendingRecruit?.instanceId === member.instanceId) {
    index += 1;
    member = createMember(speciesId, seed, state.round, index);
  }
  return member;
}

export function formationMembers(state: ExpeditionState): Array<TeamMember | null> {
  return state.formation.map((unitId) => unitId ? state.unitsById[unitId] ?? null : null);
}

export function reserveMembers(state: ExpeditionState): Array<TeamMember | null> {
  return state.reserve.map((unitId) => unitId ? state.unitsById[unitId] ?? null : null);
}

export function inventoryItems(state: ExpeditionState): Array<ItemInstance | null> {
  return state.inventory.map((itemId) => itemId ? state.itemsById[itemId] ?? null : null);
}

export function presentMembers(members: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return members.filter((member): member is TeamMember => Boolean(member));
}

export function allOwnedMembers(state: ExpeditionState): TeamMember[] {
  return [...presentMembers(formationMembers(state)), ...presentMembers(reserveMembers(state))];
}

export function campLevelForRound(round: number): 1 | 2 | 3 {
  const row = CAMP_LEVELS.find((level) => round >= level.minRound && (level.maxRound === null || round <= level.maxRound));
  return (row?.level ?? 3) as 1 | 2 | 3;
}

export function computeCampRules(state: ExpeditionState, extraModifiers: readonly CampModifier[] = []): ComputedCampRules {
  const level = CAMP_LEVELS.find((row) => row.level === campLevelForRound(state.round)) ?? CAMP_LEVELS[0];
  const rules: ComputedCampRules = {
    campLevel: level.level,
    animalOfferSlots: level.animalOfferSlots,
    itemOfferSlots: DEFAULT_CAMP_ECONOMY.itemOfferSlots,
    maxAnimalTier: level.maxAnimalTier,
    animalTierWeights: { ...level.animalTierWeights },
    baseSupply: DEFAULT_CAMP_ECONOMY.baseSupply,
    supplyCap: DEFAULT_CAMP_ECONOMY.supplyCap,
    recruitCost: DEFAULT_CAMP_ECONOMY.recruitCost,
    refreshCost: DEFAULT_CAMP_ECONOMY.refreshCost,
    releaseRefund: DEFAULT_CAMP_ECONOMY.releaseRefund,
    carrySupplyLimit: DEFAULT_CAMP_ECONOMY.carrySupplyLimit,
    freeRefreshes: DEFAULT_CAMP_ECONOMY.freeRefreshes,
    reserveCapacity: DEFAULT_CAMP_ECONOMY.reserveCapacity,
    inventoryCapacity: DEFAULT_CAMP_ECONOMY.inventoryCapacity,
  };
  const modifiers = [...presentMembers(formationMembers(state)).flatMap((member) => ANIMAL_BY_ID[member.speciesId].campModifiers ?? []), ...extraModifiers];
  for (const modifier of modifiers) applyCampModifier(rules, modifier);
  rules.refreshCost = Math.max(0, rules.refreshCost);
  rules.baseSupply = Math.max(0, rules.baseSupply);
  rules.supplyCap = Math.max(1, rules.supplyCap);
  rules.animalOfferSlots = clamp(rules.animalOfferSlots, 0, 5);
  rules.itemOfferSlots = clamp(rules.itemOfferSlots, 0, 2);
  return rules;
}

function applyCampModifier(rules: ComputedCampRules, modifier: CampModifier): void {
  if (modifier.kind === "modifyBaseSupply") rules.baseSupply += modifier.amount;
  if (modifier.kind === "modifySupplyCap") rules.supplyCap += modifier.amount;
  if (modifier.kind === "modifyCarryLimit") rules.carrySupplyLimit += modifier.amount;
  if (modifier.kind === "modifyRefreshCost") rules.refreshCost += modifier.amount;
  if (modifier.kind === "grantFreeRefreshes") rules.freeRefreshes += modifier.amount;
  if (modifier.kind === "modifyAnimalOfferSlots") rules.animalOfferSlots = Math.min(modifier.max ?? 5, rules.animalOfferSlots + modifier.amount);
  if (modifier.kind === "modifyItemOfferSlots") rules.itemOfferSlots = Math.min(modifier.max ?? 2, rules.itemOfferSlots + modifier.amount);
  if (modifier.kind === "grantSupplyOnCampEnter") rules.baseSupply += modifier.amount;
  if (modifier.kind === "grantSupplyOnLevelUp") {
    // Applied by level-up actions, not by passive camp enter.
  }
}

function pickTier(rng: Rng, weights: Record<1 | 2 | 3, number>): 1 | 2 | 3 {
  const total = weights[1] + weights[2] + weights[3];
  let roll = rng.next() * total;
  for (const tier of [1, 2, 3] as const) {
    roll -= weights[tier];
    if (roll <= 0) return tier;
  }
  return 1;
}

function rollAnimal(rng: Rng, rules: ComputedCampRules): SpeciesId {
  const tier = pickTier(rng, rules.animalTierWeights);
  const pool = ANIMALS.filter((animal) => animal.tier === tier && animal.tier <= rules.maxAnimalTier);
  return rng.pick(pool.length ? pool : ANIMALS.filter((animal) => animal.tier <= rules.maxAnimalTier)).id;
}

function rollAnimalSlot(seed: number, round: number, index: number, unlocked: boolean, rules: ComputedCampRules): OfferSlot<AnimalOffer> {
  const rng = createRng(seed ^ (round * 1009) ^ (index * 9176));
  return {
    slotId: makeId("animal_slot", seed + round, index),
    kind: "animal",
    unlocked,
    held: false,
    offer: unlocked ? { offerInstanceId: makeId("animal_offer", seed + round, index), speciesId: rollAnimal(rng, rules) } : null,
  };
}

function rollItemSlot(seed: number, round: number, index: number): OfferSlot<ItemOffer> {
  const rng = createRng(seed ^ (round * 2017) ^ (index * 4567));
  const item = rng.pick(ITEMS);
  return {
    slotId: makeId("item_slot", seed + round, index),
    kind: "item",
    unlocked: true,
    held: false,
    offer: { offerInstanceId: makeId("item_offer", seed + round, index), itemId: item.id },
  };
}

export function enterCamp(state: ExpeditionState, previousLeftover = 0): ExpeditionState {
  const next = structuredClone(state) as ExpeditionState;
  const rules = computeCampRules(next);
  const heldAnimal = new Map(next.camp?.animalOffers.flatMap((slot, index) => slot.held && slot.offer ? [[index, slot] as const] : []));
  const heldItems = new Map(next.camp?.itemOffers.flatMap((slot, index) => slot.held && slot.offer ? [[index, slot] as const] : []));
  const supply = clamp(rules.baseSupply + Math.min(previousLeftover, rules.carrySupplyLimit), 0, rules.supplyCap);
  next.phase = "camp";
  next.camp = {
    campId: makeId("camp", next.expeditionSeed, next.round),
    campLevel: rules.campLevel,
    supply,
    freeRefreshes: rules.freeRefreshes,
    animalOffers: fixed5(Array.from({ length: 5 }, (_, index) => {
      const unlocked = index < rules.animalOfferSlots;
      const old = heldAnimal.get(index);
      return old && unlocked ? { ...old, slotId: makeId("animal_slot", next.expeditionSeed + next.round, index), held: false } : rollAnimalSlot(next.expeditionSeed, next.round, index, unlocked, rules);
    }), rollAnimalSlot(next.expeditionSeed, next.round, 0, false, rules)),
    itemOffers: fixed2(Array.from({ length: 2 }, (_, index) => {
      const old = heldItems.get(index);
      return index < rules.itemOfferSlots ? old ? { ...old, slotId: makeId("item_slot", next.expeditionSeed + next.round, index), held: false } : rollItemSlot(next.expeditionSeed, next.round, index) : { ...rollItemSlot(next.expeditionSeed, next.round, index), unlocked: false, offer: null };
    }), { ...rollItemSlot(next.expeditionSeed, next.round, 0), unlocked: false, offer: null }),
  };
  return next;
}

export function firstEmptyFormationSlot(state: ExpeditionState): 0 | 1 | 2 | 3 | 4 | -1 {
  const index = state.formation.findIndex((unitId) => !unitId);
  return index === -1 ? -1 : index as 0 | 1 | 2 | 3 | 4;
}

export function firstEmptyReserveSlot(state: ExpeditionState): 0 | 1 | 2 | -1 {
  const index = state.reserve.findIndex((unitId) => !unitId);
  return index === -1 ? -1 : index as 0 | 1 | 2;
}

export function firstEmptyInventorySlot(state: ExpeditionState): 0 | 1 | 2 | -1 {
  const index = state.inventory.findIndex((itemId) => !itemId);
  return index === -1 ? -1 : index as 0 | 1 | 2;
}

function getUnitSlotArray(state: ExpeditionState, zone: UnitSlotRef["zone"]): Fixed5<UnitId | null> | Fixed3<UnitId | null> {
  return zone === "formation" ? state.formation : state.reserve;
}

function findUnitSlot(state: ExpeditionState, unitId: UnitId): UnitSlotRef | undefined {
  const formationSlot = state.formation.findIndex((id) => id === unitId);
  if (formationSlot >= 0) return { zone: "formation", slot: formationSlot as UnitSlotRef["slot"] };
  const reserveSlot = state.reserve.findIndex((id) => id === unitId);
  if (reserveSlot >= 0) return { zone: "reserve", slot: reserveSlot as 0 | 1 | 2 };
  return undefined;
}

function findItemSlot(state: ExpeditionState, itemInstanceId: ItemInstanceId): ItemSlotRef | undefined {
  const slot = state.inventory.findIndex((id) => id === itemInstanceId);
  return slot >= 0 ? { zone: "inventory", slot: slot as 0 | 1 | 2 } : undefined;
}

function unitAt(state: ExpeditionState, ref: UnitSlotRef): UnitId | null {
  return getUnitSlotArray(state, ref.zone)[ref.slot] ?? null;
}

function setUnitAt(state: ExpeditionState, ref: UnitSlotRef, unitId: UnitId | null): void {
  if (ref.zone === "formation") state.formation[ref.slot as 0 | 1 | 2 | 3 | 4] = unitId;
  else state.reserve[ref.slot as 0 | 1 | 2] = unitId;
}

function setItemAt(state: ExpeditionState, ref: ItemSlotRef, itemId: ItemInstanceId | null): void {
  state.inventory[ref.slot] = itemId;
}

function addInventoryItemToFirstEmptySlot(state: ExpeditionState, item: ItemInstance): boolean {
  const slot = firstEmptyInventorySlot(state);
  if (slot < 0) return false;
  state.itemsById[item.instanceId] = item;
  state.inventory[slot as 0 | 1 | 2] = item.instanceId;
  return true;
}

function nextItemInstanceId(state: ExpeditionState): ItemInstanceId {
  let index = Object.keys(state.itemsById).length + 1;
  let id = makeId("item", state.expeditionSeed + state.round, index);
  while (state.itemsById[id]) {
    index += 1;
    id = makeId("item", state.expeditionSeed + state.round, index);
  }
  return id;
}

function getOwnedUnit(state: ExpeditionState, unitId: UnitId): TeamMember | undefined {
  return findUnitSlot(state, unitId) ? state.unitsById[unitId] : undefined;
}

function itemTargetCandidate(item: keyof typeof ITEM_BY_ID, target: ItemTarget): ItemTargetCandidate | null {
  if (target.kind === "unit" || target.kind === "allOwned" || target.kind === "none") return target;
  const spec = ITEM_BY_ID[item].targetSpec;
  if (spec.kind === "singleUnit") return target.unitIds[0] ? { kind: "unit", unitId: target.unitIds[0] } : null;
  if (spec.kind === "group") return target.unitIds[0] ? { kind: "unit", unitId: target.unitIds[0] } : null;
  if (spec.kind === "allOwned") return { kind: "allOwned" };
  return { kind: "none" };
}

function removeUnitFromSlot(state: ExpeditionState, unitId: UnitId): UnitSlotRef {
  const slot = findUnitSlot(state, unitId);
  if (!slot) throw new Error("unit slot missing");
  setUnitAt(state, slot, null);
  return slot;
}

function insertUnit(state: ExpeditionState, unit: TeamMember, to: UnitSlotRef): void {
  state.unitsById[unit.instanceId] = unit;
  setUnitAt(state, to, unit.instanceId);
}

function insertFormationUnit(state: ExpeditionState, unitId: UnitId, toSlot: 0 | 1 | 2 | 3 | 4): void {
  const sourceIndex = state.formation.findIndex((id) => id === unitId);
  if (sourceIndex < 0) throw new Error("来源位置无效。");
  if (sourceIndex === toSlot) return;
  if (sourceIndex < toSlot) {
    for (let index = sourceIndex; index < toSlot; index += 1) state.formation[index as 0 | 1 | 2 | 3] = state.formation[index + 1 as 1 | 2 | 3 | 4];
    state.formation[toSlot] = unitId;
    return;
  }
  for (let index = sourceIndex; index > toSlot; index -= 1) state.formation[index as 1 | 2 | 3 | 4] = state.formation[index - 1 as 0 | 1 | 2 | 3];
  state.formation[toSlot] = unitId;
}

function generateDiscoveries(state: ExpeditionState, source: TeamMember, beforeLevel: 1 | 2 | 3, afterLevel: 1 | 2 | 3): UpgradeDiscovery[] {
  const rules = computeCampRules(state);
  const discoveries: UpgradeDiscovery[] = [];
  for (let level = beforeLevel + 1; level <= afterLevel; level += 1) {
    const targetTier = Math.min(rules.maxAnimalTier + 1, 3) as 1 | 2 | 3;
    const pool = ANIMALS.filter((animal) => animal.tier === targetTier).map((animal) => animal.id);
    const rng = createRng(state.expeditionSeed ^ (state.round * 1777) ^ (discoveries.length * 31) ^ source.instanceId.length);
    const candidates: SpeciesId[] = [];
    while (pool.length && candidates.length < 3) {
      const pick = rng.pick(pool);
      candidates.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    discoveries.push({ discoveryId: makeId("discovery", state.expeditionSeed + state.round, state.pendingDiscoveries.length + discoveries.length), sourceInstanceId: source.instanceId, targetTier, candidates });
  }
  return discoveries;
}

function clearOffer(slot: OfferSlot<AnimalOffer | ItemOffer>): void {
  slot.offer = null;
  slot.held = false;
}

function slotKey(ref: UnitSlotRef): string {
  return `${ref.zone}:${ref.slot}`;
}

function itemSlotKey(ref: ItemSlotRef): string {
  return `${ref.zone}:${ref.slot}`;
}

export function assertCampInvariants(state: ExpeditionState): void {
  if (state.formation.length !== 5) throw new Error("formation must have exactly 5 slots");
  if (state.reserve.length !== 3) throw new Error("reserve must have exactly 3 slots");
  if (state.inventory.length !== 3) throw new Error("inventory must have exactly 3 slots");
  if (state.camp) {
    if (state.camp.animalOffers.length !== 5) throw new Error("animal offers must have exactly 5 slots");
    if (state.camp.itemOffers.length !== 2) throw new Error("item offers must have exactly 2 slots");
  }

  const unitSlotById = new Map<UnitId, string>();
  for (const [index, unitId] of state.formation.entries()) {
    if (!unitId) continue;
    if (!state.unitsById[unitId]) throw new Error(`formation has dangling unit ${unitId}`);
    if (unitSlotById.has(unitId)) throw new Error(`unit ${unitId} occupies multiple slots`);
    unitSlotById.set(unitId, slotKey({ zone: "formation", slot: index as 0 | 1 | 2 | 3 | 4 }));
  }
  for (const [index, unitId] of state.reserve.entries()) {
    if (!unitId) continue;
    if (!state.unitsById[unitId]) throw new Error(`reserve has dangling unit ${unitId}`);
    if (unitSlotById.has(unitId)) throw new Error(`unit ${unitId} occupies multiple slots`);
    unitSlotById.set(unitId, slotKey({ zone: "reserve", slot: index as 0 | 1 | 2 }));
  }
  for (const unitId of Object.keys(state.unitsById)) {
    if (!unitSlotById.has(unitId)) throw new Error(`unit ${unitId} has no slot`);
    if (state.unitsById[unitId].instanceId !== unitId) throw new Error(`unit ${unitId} id mismatch`);
  }

  const itemSlotById = new Map<ItemInstanceId, string>();
  for (const [index, itemId] of state.inventory.entries()) {
    if (!itemId) continue;
    if (!state.itemsById[itemId]) throw new Error(`inventory has dangling item ${itemId}`);
    if (itemSlotById.has(itemId)) throw new Error(`item ${itemId} occupies multiple slots`);
    itemSlotById.set(itemId, itemSlotKey({ zone: "inventory", slot: index as 0 | 1 | 2 }));
  }
  for (const itemId of Object.keys(state.itemsById)) {
    if (!itemSlotById.has(itemId)) throw new Error(`item ${itemId} has no slot`);
    if (state.itemsById[itemId].instanceId !== itemId) throw new Error(`item ${itemId} id mismatch`);
  }

  const offerIds = new Set<OfferId>();
  for (const slot of state.camp?.animalOffers ?? []) {
    if (!slot.unlocked && slot.offer) throw new Error("locked animal offer slot has offer");
    if (!slot.offer) continue;
    if (offerIds.has(slot.offer.offerInstanceId)) throw new Error(`duplicate offer ${slot.offer.offerInstanceId}`);
    offerIds.add(slot.offer.offerInstanceId);
  }
  for (const slot of state.camp?.itemOffers ?? []) {
    if (!slot.unlocked && slot.offer) throw new Error("locked item offer slot has offer");
    if (!slot.offer) continue;
    if (offerIds.has(slot.offer.offerInstanceId)) throw new Error(`duplicate offer ${slot.offer.offerInstanceId}`);
    offerIds.add(slot.offer.offerInstanceId);
  }
}

function findAnimalOfferSlot(state: ExpeditionState, offerId: OfferId): OfferSlot<AnimalOffer> | undefined {
  return state.camp?.animalOffers.find((slot) => slot.offer?.offerInstanceId === offerId || slot.slotId === offerId);
}

function findItemOfferSlot(state: ExpeditionState, offerId: OfferId): OfferSlot<ItemOffer> | undefined {
  return state.camp?.itemOffers.find((slot) => slot.offer?.offerInstanceId === offerId || slot.slotId === offerId);
}

function validateUnitSlot(ref: UnitSlotRef, rules: ComputedCampRules): string | null {
  if (ref.zone === "formation" && (ref.slot < 0 || ref.slot > 4)) return "目标战斗位无效。";
  if (ref.zone === "reserve" && (ref.slot < 0 || ref.slot > rules.reserveCapacity - 1)) return `替补区最多 ${rules.reserveCapacity} 只。`;
  return null;
}

function takeDiscovery(state: ExpeditionState, discoveryId: string, speciesId?: SpeciesId): UpgradeDiscovery {
  const index = state.pendingDiscoveries.findIndex((discovery) => discovery.discoveryId === discoveryId);
  if (index < 0) throw new Error("没有这个高级发现。");
  const discovery = state.pendingDiscoveries[index];
  if (speciesId && !discovery.candidates.includes(speciesId)) throw new Error("候选动物无效。");
  state.pendingDiscoveries.splice(index, 1);
  return discovery;
}

function phaseAfterDiscoveryChoice(state: ExpeditionState): ExpeditionState["phase"] {
  return state.pendingDiscoveries.length || state.pendingRecruit ? "upgradeDiscovery" : "camp";
}

function applyCampCommandUnchecked(next: ExpeditionState, command: CampCommand): string {
  const rules = computeCampRules(next);
  const camp = next.camp;
  const upgradeDiscoveryCommands = new Set<CampCommand["type"]>(["chooseDiscovery", "chooseDiscoveryToSlot", "chooseDiscoveryAndMerge", "chooseDiscoverySupply", "placePendingRecruit", "discardPendingRecruit", "releaseUnit", "moveUnit", "mergeUnits"]);
  if (next.phase !== "camp" && (next.phase !== "upgradeDiscovery" || !upgradeDiscoveryCommands.has(command.type))) throw new Error("当前阶段不能执行营地操作。");
  if (!camp && command.type !== "placePendingRecruit" && command.type !== "discardPendingRecruit") throw new Error("尚未进入营地。");

  if (command.type === "toggleHold") {
    const slot = command.slotKind === "animal" ? findAnimalOfferSlot(next, command.offerId) : findItemOfferSlot(next, command.offerId);
    if (!slot || !slot.unlocked || !slot.offer) throw new Error("空格或未开放格不能留意。");
    slot.held = !slot.held;
    return slot.held ? "已留意。" : "已取消留意。";
  }

  if (command.type === "refresh") {
    if (!camp) throw new Error("没有营地可刷新。");
    const refreshable = [...camp.animalOffers, ...camp.itemOffers].some((slot) => slot.unlocked && !slot.held);
    if (!refreshable) throw new Error("所有开放格都已留意，无法刷新。");
    if (camp.freeRefreshes > 0) camp.freeRefreshes -= 1;
    else {
      if (camp.supply < rules.refreshCost) throw new Error("补给不足，无法刷新。");
      camp.supply -= rules.refreshCost;
    }
    camp.animalOffers = fixed5(camp.animalOffers.map((slot, index) => slot.unlocked && !slot.held ? rollAnimalSlot(next.expeditionSeed + camp.supply, next.round, index, slot.unlocked, rules) : slot), camp.animalOffers[0]);
    camp.itemOffers = fixed2(camp.itemOffers.map((slot, index) => slot.unlocked && !slot.held ? rollItemSlot(next.expeditionSeed + camp.supply, next.round, index) : slot), camp.itemOffers[0]);
    return "市场已刷新。";
  }

  if (command.type === "moveUnit") {
    const invalid = validateUnitSlot(command.to, rules);
    if (invalid) throw new Error(invalid);
    const sourceSlot = findUnitSlot(next, command.unitId);
    if (!sourceSlot || !next.unitsById[command.unitId]) throw new Error("来源位置无效。");
    if (sourceSlot.zone === command.to.zone && sourceSlot.slot === command.to.slot) return "队列未变化。";
    const targetUnitId = unitAt(next, command.to);
    if (sourceSlot.zone === "formation" && command.to.zone === "formation" && targetUnitId) {
      insertFormationUnit(next, command.unitId, command.to.slot);
      return "队列已调整。";
    }
    setUnitAt(next, sourceSlot, targetUnitId);
    setUnitAt(next, command.to, command.unitId);
    return "队列已调整。";
  }

  if (command.type === "mergeUnits") {
    const source = getOwnedUnit(next, command.sourceUnitId);
    const target = getOwnedUnit(next, command.targetUnitId);
    if (!source || !target) throw new Error("没有找到要合成的动物。");
    const merge = mergeMembers(next, source, target);
    if (!merge.ok) throw new Error(merge.messageZh);
    removeUnitFromSlot(next, source.instanceId);
    delete next.unitsById[source.instanceId];
    next.stats.merges += 1;
    return "合成完成，若升级会进入高级发现。";
  }

  if (command.type === "recruitAnimal" || command.type === "recruitAndMerge") {
    if (!camp) throw new Error("没有营地可招募。");
    if (camp.supply < rules.recruitCost) throw new Error("补给不足，无法招募。");
    const slot = findAnimalOfferSlot(next, command.offerId);
    if (!slot?.offer || !slot.unlocked) throw new Error("这个动物位没有可招募动物。");
    const member = createUniqueMember(next, slot.offer.speciesId, next.expeditionSeed);
    if (command.type === "recruitAnimal") {
      const invalid = validateUnitSlot(command.to, rules);
      if (invalid) throw new Error(invalid);
      if (unitAt(next, command.to)) throw new Error(command.to.zone === "formation" ? "目标战斗位已有动物。" : "目标替补位已有动物。");
      insertUnit(next, member, command.to);
    } else {
      const target = getOwnedUnit(next, command.targetUnitId);
      if (!target) throw new Error("没有找到合成目标。");
      if (target.speciesId !== member.speciesId) throw new Error("只能拖到同物种单位上合成。");
      const merge = mergeMembers(next, member, target);
      if (!merge.ok) throw new Error(merge.messageZh);
    }
    camp.supply -= rules.recruitCost;
    clearOffer(slot);
    return `${ANIMAL_BY_ID[member.speciesId].nameZh}已加入。`;
  }

  if (command.type === "releaseUnit") {
    if (!camp) throw new Error("没有营地。");
    const member = getOwnedUnit(next, command.unitId);
    if (!member) throw new Error("没有找到要告别的动物。");
    removeUnitFromSlot(next, command.unitId);
    delete next.unitsById[command.unitId];
    const refund = releaseRefundForLevel(memberLevel(member));
    camp.supply += refund;
    return `已告别并返还 ${refund} 点补给。`;
  }

  if (command.type === "moveItem") {
    const sourceSlot = findItemSlot(next, command.itemInstanceId);
    if (!sourceSlot || !next.itemsById[command.itemInstanceId]) throw new Error("没有找到仓库道具。");
    if (sourceSlot.slot === command.to.slot) return "仓库未变化。";
    const targetItemId = next.inventory[command.to.slot];
    setItemAt(next, sourceSlot, targetItemId);
    setItemAt(next, command.to, command.itemInstanceId);
    return "仓库已调整。";
  }

  if (command.type === "purchaseItemToInventory" || command.type === "purchaseAndApplyItem") {
    if (!camp) throw new Error("没有营地可购买道具。");
    const slot = findItemOfferSlot(next, command.offerId);
    if (!slot?.offer || !slot.unlocked) throw new Error("这个道具位是空的。");
    const item = ITEM_BY_ID[slot.offer.itemId];
    if (camp.supply < item.price) throw new Error("补给不足，无法购买道具。");
    if (command.type === "purchaseItemToInventory") {
      if (next.inventory[command.to.slot]) throw new Error("目标仓库位已有道具。");
      const instance: ItemInstance = { instanceId: nextItemInstanceId(next), itemId: item.id };
      next.itemsById[instance.instanceId] = instance;
      setItemAt(next, command.to, instance.instanceId);
    } else {
      const preview = resolveItemTargets(next, item, itemTargetCandidate(item.id, command.target));
      if (!preview.ok) throw new Error(preview.messageZh);
      if (item.usage === "equipment") {
        const equip = equipPurchasedItem(next, item.id, preview);
        if (!equip.ok) throw new Error(equip.messageZh);
      } else {
        const use = applyResolvedItemEffects(next, item.id, preview.targetUnitIds);
        if (!use.ok) throw new Error(use.messageZh);
      }
    }
    camp.supply -= item.price;
    clearOffer(slot);
    return `${item.nameZh}已${command.type === "purchaseItemToInventory" ? "放入仓库" : item.kind === "equipment" ? "装备" : "使用"}。`;
  }

  if (command.type === "applyInventoryItem") {
    const sourceSlot = findItemSlot(next, command.itemInstanceId);
    const item = next.itemsById[command.itemInstanceId];
    if (!sourceSlot || !item) throw new Error("没有找到仓库道具。");
    const def = ITEM_BY_ID[item.itemId];
    const preview = resolveItemTargets(next, def, itemTargetCandidate(item.itemId, command.target));
    if (!preview.ok) throw new Error(preview.messageZh);
    if (def.usage === "equipment") {
      const equip = equipInventoryItem(next, sourceSlot, item, preview, command.discardOld);
      if (!equip.ok) throw new Error(equip.messageZh);
    } else {
      const use = applyResolvedItemEffects(next, item.itemId, preview.targetUnitIds);
      if (!use.ok) throw new Error(use.messageZh);
      setItemAt(next, sourceSlot, null);
      delete next.itemsById[item.instanceId];
    }
    return def.kind === "equipment" ? "装备已更新。" : `${def.nameZh}已使用。`;
  }

  if (command.type === "chooseDiscovery") {
    const discovery = takeDiscovery(next, command.discoveryId, command.speciesId);
    next.pendingRecruit = createUniqueMember(next, command.speciesId, next.expeditionSeed + discovery.discoveryId.length);
    next.phase = "upgradeDiscovery";
    return "请选择把新伙伴放入战斗队或替补。";
  }

  if (command.type === "chooseDiscoveryToSlot") {
    const invalid = validateUnitSlot(command.to, rules);
    if (invalid) throw new Error(invalid);
    if (unitAt(next, command.to)) throw new Error(command.to.zone === "formation" ? "目标战斗位已有动物。" : "目标替补位已有动物。");
    const discovery = takeDiscovery(next, command.discoveryId, command.speciesId);
    const member = createUniqueMember(next, command.speciesId, next.expeditionSeed + discovery.discoveryId.length);
    insertUnit(next, member, command.to);
    next.phase = phaseAfterDiscoveryChoice(next);
    return "高级发现伙伴已加入。";
  }

  if (command.type === "chooseDiscoveryAndMerge") {
    const target = getOwnedUnit(next, command.targetUnitId);
    if (!target) throw new Error("没有找到合成目标。");
    if (target.speciesId !== command.speciesId) throw new Error("只能拖到同物种单位上合成。");
    const discovery = takeDiscovery(next, command.discoveryId, command.speciesId);
    const member = createUniqueMember(next, command.speciesId, next.expeditionSeed + discovery.discoveryId.length);
    const merge = mergeMembers(next, member, target);
    if (!merge.ok) throw new Error(merge.messageZh);
    next.stats.merges += 1;
    next.phase = phaseAfterDiscoveryChoice(next);
    return "高级发现伙伴已合成。";
  }

  if (command.type === "chooseDiscoverySupply") {
    takeDiscovery(next, command.discoveryId);
    if (!camp) throw new Error("没有营地。");
    camp.supply += 1;
    next.phase = phaseAfterDiscoveryChoice(next);
    return "已获得 1 点补给。";
  }

  if (command.type === "discardPendingRecruit") {
    if (!next.pendingRecruit) throw new Error("没有待安置的新伙伴。");
    next.pendingRecruit = null;
    next.phase = phaseAfterDiscoveryChoice(next);
    return "已告别待安置伙伴。";
  }

  if (command.type === "placePendingRecruit") {
    if (!next.pendingRecruit) throw new Error("没有待安置的新伙伴。");
    const target = command.replaceUnitId ? findUnitSlot(next, command.replaceUnitId) : command.to;
    if (!target) throw new Error("没有找到要替换的单位。");
    const invalid = validateUnitSlot(target, rules);
    if (invalid) throw new Error(invalid);
    if (!command.replaceUnitId && unitAt(next, target)) throw new Error(target.zone === "formation" ? "目标战斗位已有动物。" : "目标替补位已有动物。");
    if (command.replaceUnitId) delete next.unitsById[command.replaceUnitId];
    insertUnit(next, next.pendingRecruit, target);
    next.pendingRecruit = null;
    next.phase = phaseAfterDiscoveryChoice(next);
    return "高级发现伙伴已安置。";
  }

  throw new Error("未知营地操作。");
}

export function applyCampCommand(state: ExpeditionState, command: CampCommand): DomainResult<CampTransition> {
  const next = structuredClone(state) as ExpeditionState;
  try {
    const messageZh = applyCampCommandUnchecked(next, command);
    assertCampInvariants(next);
    return { ok: true, state: { state: next, command }, messageZh };
  } catch (error) {
    return { ok: false, state: { state, command }, messageZh: error instanceof Error ? error.message : "营地操作失败。" };
  }
}

export function preflightMoveUnitToEmptySlot(state: ExpeditionState, unitId: UnitId, to: UnitSlotRef): DomainResult<CampCommand> {
  if (unitAt(state, to)) return { ok: false, state: { type: "moveUnit", unitId, to }, messageZh: to.zone === "formation" ? "目标战斗位已有动物。" : "目标替补位已有动物。" };
  const command: CampCommand = { type: "moveUnit", unitId, to };
  const result = applyCampCommand(state, command);
  return result.ok ? { ok: true, state: command, messageZh: result.messageZh } : { ok: false, state: command, messageZh: result.messageZh };
}

function releaseRefundForLevel(level: 1 | 2 | 3): number {
  if (level === 3) return 5;
  if (level === 2) return 3;
  return 1;
}

function mergeMembers(state: ExpeditionState, source: TeamMember, target: TeamMember): { ok: boolean; messageZh: string } {
  if (source.instanceId === target.instanceId) return { ok: false, messageZh: "不能和自己合成。" };
  if (source.speciesId !== target.speciesId) return { ok: false, messageZh: "必须是同物种才能合成。" };
  if (source.bondXp >= 6 || target.bondXp >= 6) return { ok: false, messageZh: "满级单位不能继续合成。" };
  if (source.bondXp + target.bondXp > 6) return { ok: false, messageZh: "默契会溢出，请调整合成顺序。" };
  const before = levelFromBondXp(target.bondXp);
  target.bondXp += source.bondXp;
  target.permanentAttackBonus += source.permanentAttackBonus;
  target.permanentHealthBonus += source.permanentHealthBonus;
  target.timedStatuses = [...target.timedStatuses, ...source.timedStatuses].sort((a, b) => a.statusId.localeCompare(b.statusId));
  if (!target.equipment && source.equipment) target.equipment = source.equipment;
  if (target.equipment && source.equipment && target.equipment.instanceId !== source.equipment.instanceId) {
    if (!addInventoryItemToFirstEmptySlot(state, { instanceId: source.equipment.instanceId, itemId: source.equipment.itemId })) return { ok: false, messageZh: "仓库已满，无法保留源单位装备。" };
  }
  const after = levelFromBondXp(target.bondXp);
  if (after > before) {
    const discoveries = generateDiscoveries(state, target, before, after);
    state.pendingDiscoveries.push(...discoveries);
    state.stats.upgradeDiscoveries += discoveries.length;
    state.phase = "upgradeDiscovery";
  }
  return { ok: true, messageZh: "合成完成。" };
}

function initialStats(member: TeamMember): { attack: number; health: number } {
  const animal = ANIMAL_BY_ID[member.speciesId];
  const level = memberLevel(member);
  let attack = animal.baseAttack + animal.levelAttackBonus[level - 1] + member.permanentAttackBonus;
  let health = animal.baseHealth + animal.levelHealthBonus[level - 1] + member.permanentHealthBonus;
  if (member.equipment) {
    for (const effect of ITEM_BY_ID[member.equipment.itemId].effects) {
      if (effect.kind === "modifyInitialAttack") attack += effect.amount;
      if (effect.kind === "modifyInitialHealth") health += effect.amount;
    }
  }
  return { attack, health: Math.max(1, health) };
}

export function toTeamSnapshot(team: readonly (TeamMember | null | undefined)[]): TeamSnapshot {
  return {
    units: team.flatMap((member, position): TeamSnapshotUnit[] => {
      if (!member) return [];
      const stats = initialStats(member);
      return [{
        snapshotUnitId: `${member.instanceId}_snap_${position}`,
        speciesId: member.speciesId,
        position,
        bondXp: member.bondXp,
        level: memberLevel(member),
        initialAttack: stats.attack,
        initialMaxHealth: stats.health,
        equipmentEffect: member.equipment ? normalizeEquipment(member.equipment.itemId) : null,
        startingStatuses: member.timedStatuses.map((status) => ({ statusId: status.statusId, def: status.def })),
      }];
    }),
  };
}

function normalizeEquipment(itemId: string) {
  const item = ITEM_BY_ID[itemId as keyof typeof ITEM_BY_ID];
  let initialAttackBonus = 0;
  let initialHealthBonus = 0;
  let battleStartDamage: number | undefined;
  for (const effect of item.effects) {
    if (effect.kind === "modifyInitialAttack") initialAttackBonus += effect.amount;
    if (effect.kind === "modifyInitialHealth") initialHealthBonus += effect.amount;
    if (effect.kind === "battleStartDamage") battleStartDamage = effect.amount;
  }
  return { itemId: item.id, initialAttackBonus, initialHealthBonus, battleStartDamage };
}

function applyResolvedItemEffects(state: ExpeditionState, itemId: keyof typeof ITEM_BY_ID, targetInstanceIds: string[]): { ok: boolean; messageZh: string } {
  const item = ITEM_BY_ID[itemId];
  const targets = targetInstanceIds.flatMap((unitId) => getOwnedUnit(state, unitId) ?? []);
  if (targets.length === 0) return { ok: false, messageZh: "没有合法目标，道具未消耗。" };
  for (const target of targets) {
    const before = memberLevel(target);
    for (const effect of item.effects) {
      if (effect.kind === "modifyPermanentAttack") target.permanentAttackBonus += effect.amount;
      if (effect.kind === "modifyPermanentHealth") {
        const stats = initialStats(target);
        if (stats.health + effect.amount < 1) return { ok: false, messageZh: "苦根会使初始最大体力低于 1，不能使用。" };
        target.permanentHealthBonus += effect.amount;
      }
      if (effect.kind === "modifyBondXp") target.bondXp = Math.min(6, target.bondXp + effect.amount);
      if (effect.kind === "attachStatus") {
        target.timedStatuses.push({ statusId: makeId("status", state.expeditionSeed + state.round, target.timedStatuses.length + 1), def: effect.status });
      }
    }
    const after = memberLevel(target);
    if (after > before) {
      const discoveries = generateDiscoveries(state, target, before, after);
      state.pendingDiscoveries.push(...discoveries);
      state.stats.upgradeDiscoveries += discoveries.length;
      state.phase = "upgradeDiscovery";
    }
  }
  return { ok: true, messageZh: `${item.nameZh}已生效。` };
}

function equipPurchasedItem(state: ExpeditionState, itemId: keyof typeof ITEM_BY_ID, preview: ItemTargetPreview): { ok: boolean; messageZh: string } {
  if (!preview.ok) return { ok: false, messageZh: preview.messageZh };
  const target = preview.targetUnitIds[0] ? getOwnedUnit(state, preview.targetUnitIds[0]) : undefined;
  if (!target) return { ok: false, messageZh: "装备目标不存在。" };
  const old = target.equipment;
  if (old && firstEmptyInventorySlot(state) < 0) return { ok: false, messageZh: "仓库已满，请先处理旧装备。" };
  if (old) addInventoryItemToFirstEmptySlot(state, { instanceId: old.instanceId, itemId: old.itemId });
  target.equipment = { instanceId: nextItemInstanceId(state), itemId };
  return { ok: true, messageZh: "装备已更新。" };
}

function equipInventoryItem(state: ExpeditionState, sourceSlot: ItemSlotRef, item: ItemInstance, preview: ItemTargetPreview, discardOld?: boolean): { ok: boolean; messageZh: string } {
  if (!preview.ok) return { ok: false, messageZh: preview.messageZh };
  const target = preview.targetUnitIds[0] ? getOwnedUnit(state, preview.targetUnitIds[0]) : undefined;
  if (!target) return { ok: false, messageZh: "装备目标不存在。" };
  const def = ITEM_BY_ID[item.itemId];
  if (def.kind !== "equipment") return { ok: false, messageZh: "这个道具不是装备。" };
  const old = target.equipment;
  setItemAt(state, sourceSlot, null);
  delete state.itemsById[item.instanceId];
  target.equipment = { instanceId: item.instanceId, itemId: item.itemId };
  if (old && !discardOld) {
    state.itemsById[old.instanceId] = { instanceId: old.instanceId, itemId: old.itemId };
    setItemAt(state, sourceSlot, old.instanceId);
  }
  return { ok: true, messageZh: "装备已更新。" };
}

export function sortTeamHeuristic(team: readonly TeamMember[]): TeamMember[] {
  return [...team].sort((a, b) => roleScore(a.speciesId) - roleScore(b.speciesId));
}

function roleScore(speciesId: SpeciesId): number {
  if (["pangolin", "mussel", "hedgehog", "carp"].includes(speciesId)) return 0;
  if (speciesId === "frog") return 1;
  if (["swallow", "kingfisher", "crow"].includes(speciesId)) return 4;
  return 3;
}
