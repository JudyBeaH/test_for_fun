import { ANIMAL_BY_ID } from "../content/animals";
import { ITEM_BY_ID } from "../content/items";
import { allOwnedMembers, applyCampCommand, computeCampRules, firstEmptyFormationSlot, firstEmptyInventorySlot, firstEmptyReserveSlot, formationMembers, inventoryItems, reserveMembers, sortTeamHeuristic } from "../domain/campEngine";
import type { CampCommand, ExpeditionState, Fixed5, SpeciesId, TeamMember, UnitId } from "../domain/types";

export interface AutoStats {
  invalidReasons: Record<string, number>;
  campActions: number;
  itemPurchases: Record<string, number>;
  itemUses: Record<string, number>;
}

export function createAutoStats(): AutoStats {
  return { invalidReasons: {}, campActions: 0, itemPurchases: {}, itemUses: {} };
}

function applyAuto(state: ExpeditionState, command: CampCommand, stats: AutoStats): ExpeditionState {
  const result = applyCampCommand(state, command);
  if (result.ok) {
    stats.campActions += 1;
    return result.state.state;
  }
  stats.invalidReasons[result.messageZh] = (stats.invalidReasons[result.messageZh] ?? 0) + 1;
  return state;
}

function presentMembers(members: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return members.filter((member): member is TeamMember => Boolean(member));
}

export function runAutoCamp(state: ExpeditionState, stats: AutoStats = createAutoStats()): ExpeditionState {
  let current = structuredClone(state) as ExpeditionState;
  let guard = 0;
  while ((current.pendingDiscoveries.length || current.pendingRecruit) && guard < 30) {
    guard += 1;
    if (current.pendingDiscoveries[0]) {
      const discovery = current.pendingDiscoveries[0];
      const best = [...discovery.candidates].sort((a, b) => speciesValue(b) - speciesValue(a))[0];
      current = applyAuto(current, { type: "chooseDiscovery", discoveryId: discovery.discoveryId, speciesId: best }, stats);
    }
    if (current.pendingRecruit) {
      const rules = computeCampRules(current);
      const formationSlot = firstEmptyFormationSlot(current);
      const reserveSlot = firstEmptyReserveSlot(current);
      if (formationSlot >= 0) current = applyAuto(current, { type: "placePendingRecruit", to: { zone: "formation", slot: formationSlot as 0 | 1 | 2 | 3 | 4 } }, stats);
      else if (reserveSlot >= 0 && reserveSlot < rules.reserveCapacity) current = applyAuto(current, { type: "placePendingRecruit", to: { zone: "reserve", slot: reserveSlot as 0 | 1 | 2 } }, stats);
      else current = applyAuto(current, { type: "discardPendingRecruit" }, stats);
    }
  }
  guard = 0;
  while (current.phase === "camp" && current.camp && guard < 40) {
    guard += 1;
    const rules = computeCampRules(current);
    const mergeable = findMergeable(current);
    if (mergeable) {
      current = applyAuto(current, { type: "mergeUnits", sourceUnitId: mergeable[0], targetUnitId: mergeable[1] }, stats);
      continue;
    }
    const bondNut = current.camp.itemOffers.find((slot) => slot.offer?.itemId === "bond_nut");
    const nearLevel = allOwnedMembers(current).find((member) => member.bondXp === 2 || member.bondXp === 5);
    if (bondNut && nearLevel && current.camp.supply >= ITEM_BY_ID.bond_nut.price) {
      current = applyAuto(current, { type: "purchaseAndApplyItem", offerId: bondNut.offer!.offerInstanceId, target: { kind: "units", unitIds: [nearLevel.instanceId] } }, stats);
      stats.itemPurchases.bond_nut = (stats.itemPurchases.bond_nut ?? 0) + 1;
      stats.itemUses.bond_nut = (stats.itemUses.bond_nut ?? 0) + 1;
      continue;
    }
    const usefulItem = current.camp.itemOffers.find((slot) => slot.offer && current.camp!.supply >= ITEM_BY_ID[slot.offer.itemId].price);
    const target = presentMembers(formationMembers(current))[0] ?? presentMembers(reserveMembers(current))[0];
    if (usefulItem?.offer && target && ["red_berry", "melatonin", "pinecone_sling"].includes(usefulItem.offer.itemId)) {
      const inventorySlot = firstEmptyInventorySlot(current);
      if (usefulItem.offer.itemId === "pinecone_sling" && inventorySlot >= 0 && inventorySlot < rules.inventoryCapacity) {
        current = applyAuto(current, { type: "purchaseItemToInventory", offerId: usefulItem.offer.offerInstanceId, to: { zone: "inventory", slot: inventorySlot as 0 | 1 | 2 } }, stats);
        const item = inventoryItems(current)[inventorySlot];
        if (item) current = applyAuto(current, { type: "applyInventoryItem", itemInstanceId: item.instanceId, target: { kind: "units", unitIds: [target.instanceId] } }, stats);
      } else {
        current = applyAuto(current, { type: "purchaseAndApplyItem", offerId: usefulItem.offer.offerInstanceId, target: { kind: "units", unitIds: [target.instanceId] } }, stats);
      }
      stats.itemPurchases[usefulItem.offer.itemId] = (stats.itemPurchases[usefulItem.offer.itemId] ?? 0) + 1;
      stats.itemUses[usefulItem.offer.itemId] = (stats.itemUses[usefulItem.offer.itemId] ?? 0) + 1;
      continue;
    }
    if (current.camp.supply >= rules.recruitCost) {
      const bestOffer = current.camp.animalOffers.filter((slot) => slot.offer).sort((a, b) => speciesValue(b.offer!.speciesId) - speciesValue(a.offer!.speciesId))[0];
      if (bestOffer) {
        const formationSlot = firstEmptyFormationSlot(current);
        const reserveSlot = firstEmptyReserveSlot(current);
        const to = formationSlot >= 0 ? { zone: "formation" as const, slot: formationSlot as 0 | 1 | 2 | 3 | 4 } : reserveSlot >= 0 ? { zone: "reserve" as const, slot: reserveSlot as 0 | 1 | 2 } : null;
        if (to) current = applyAuto(current, { type: "recruitAnimal", offerId: bestOffer.offer!.offerInstanceId, to }, stats);
        continue;
      }
    }
    if (current.camp.supply >= rules.refreshCost || current.camp.freeRefreshes > 0) {
      current = applyAuto(current, { type: "refresh" }, stats);
      continue;
    }
    break;
  }
  const sorted = sortTeamHeuristic(presentMembers(formationMembers(current))).map((member) => member.instanceId);
  current.formation = [sorted[0] ?? null, sorted[1] ?? null, sorted[2] ?? null, sorted[3] ?? null, sorted[4] ?? null] as Fixed5<UnitId | null>;
  return current;
}

function speciesValue(speciesId: SpeciesId): number {
  const animal = ANIMAL_BY_ID[speciesId];
  const triggerWeight = animal.ability.levels[0].trigger === "battleStart" ? 0.4 : animal.ability.levels[0].trigger === "onHurt" ? 0.3 : 0.2;
  return animal.baseAttack + animal.baseHealth + animal.tier * 0.5 + triggerWeight;
}

function findMergeable(state: ExpeditionState): [string, string] | null {
  const owned = allOwnedMembers(state);
  for (let i = 0; i < owned.length; i += 1) {
    for (let j = i + 1; j < owned.length; j += 1) {
      if (owned[i].speciesId === owned[j].speciesId && owned[i].bondXp < 6 && owned[j].bondXp < 6 && owned[i].bondXp + owned[j].bondXp <= 6) {
        const before = owned[j].bondXp >= 3 ? 2 : 1;
        const after = owned[i].bondXp + owned[j].bondXp >= 6 ? 3 : owned[i].bondXp + owned[j].bondXp >= 3 ? 2 : 1;
        if (after > before) return [owned[i].instanceId, owned[j].instanceId];
      }
    }
  }
  return null;
}
