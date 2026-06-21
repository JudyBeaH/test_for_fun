import { ANIMAL_BY_ID } from "../content/animals";
import { ITEM_BY_ID } from "../content/items";
import { applyCampAction, computeCampRules, sortTeamHeuristic } from "../domain/campEngine";
import type { ExpeditionState, SpeciesId, TeamMember } from "../domain/types";

export interface AutoStats {
  invalidReasons: Record<string, number>;
  campActions: number;
  itemPurchases: Record<string, number>;
  itemUses: Record<string, number>;
}

export function createAutoStats(): AutoStats {
  return { invalidReasons: {}, campActions: 0, itemPurchases: {}, itemUses: {} };
}

function applyAuto(state: ExpeditionState, action: Parameters<typeof applyCampAction>[1], stats: AutoStats): ExpeditionState {
  const result = applyCampAction(state, action);
  if (result.ok) {
    stats.campActions += 1;
    return result.state;
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
      if (presentMembers(current.team).length < 5) current = applyAuto(current, { type: "placePendingRecruit", area: "team" }, stats);
      else if (current.reserve.length < rules.reserveCapacity) current = applyAuto(current, { type: "placePendingRecruit", area: "reserve" }, stats);
      else current = applyAuto(current, { type: "discardPendingRecruit" }, stats);
    }
  }
  guard = 0;
  while (current.phase === "camp" && current.camp && guard < 40) {
    guard += 1;
    const rules = computeCampRules(current);
    const mergeable = findMergeable(current);
    if (mergeable) {
      current = applyAuto(current, { type: "mergeOwned", sourceInstanceId: mergeable[0], targetInstanceId: mergeable[1] }, stats);
      continue;
    }
    const bondNut = current.camp.itemSlots.find((slot) => slot.offer?.itemId === "bond_nut");
    const nearLevel = [...presentMembers(current.team), ...current.reserve].find((member) => member.bondXp === 2 || member.bondXp === 5);
    if (bondNut && nearLevel && current.camp.supply >= ITEM_BY_ID.bond_nut.price) {
      current = applyAuto(current, { type: "buyAndUseItem", slotId: bondNut.slotId, targetInstanceIds: [nearLevel.instanceId] }, stats);
      stats.itemPurchases.bond_nut = (stats.itemPurchases.bond_nut ?? 0) + 1;
      stats.itemUses.bond_nut = (stats.itemUses.bond_nut ?? 0) + 1;
      continue;
    }
    const usefulItem = current.camp.itemSlots.find((slot) => slot.offer && current.camp!.supply >= ITEM_BY_ID[slot.offer.itemId].price);
    const target = presentMembers(current.team)[0] ?? current.reserve[0];
    if (usefulItem?.offer && target && ["red_berry", "melatonin", "pinecone_sling"].includes(usefulItem.offer.itemId)) {
      if (usefulItem.offer.itemId === "pinecone_sling" && current.inventory.length < rules.inventoryCapacity) {
        current = applyAuto(current, { type: "buyItemToInventory", slotId: usefulItem.slotId }, stats);
        const item = current.inventory[current.inventory.length - 1];
        if (item) current = applyAuto(current, { type: "equipInventoryItem", itemInstanceId: item.instanceId, targetInstanceId: target.instanceId }, stats);
      } else {
        current = applyAuto(current, { type: "buyAndUseItem", slotId: usefulItem.slotId, targetInstanceIds: [target.instanceId] }, stats);
      }
      stats.itemPurchases[usefulItem.offer.itemId] = (stats.itemPurchases[usefulItem.offer.itemId] ?? 0) + 1;
      stats.itemUses[usefulItem.offer.itemId] = (stats.itemUses[usefulItem.offer.itemId] ?? 0) + 1;
      continue;
    }
    if (current.camp.supply >= rules.recruitCost) {
      const bestOffer = current.camp.animalSlots.filter((slot) => slot.offer).sort((a, b) => speciesValue(b.offer!.speciesId) - speciesValue(a.offer!.speciesId))[0];
      if (bestOffer) {
        current = applyAuto(current, { type: presentMembers(current.team).length < 5 ? "recruitToTeam" : "recruitToReserve", slotId: bestOffer.slotId }, stats);
        continue;
      }
    }
    if (current.camp.supply >= rules.refreshCost || current.camp.freeRefreshes > 0) {
      current = applyAuto(current, { type: "refresh" }, stats);
      continue;
    }
    break;
  }
  current.team = sortTeamHeuristic(presentMembers(current.team));
  return current;
}

function speciesValue(speciesId: SpeciesId): number {
  const animal = ANIMAL_BY_ID[speciesId];
  const triggerWeight = animal.ability.levels[0].trigger === "battleStart" ? 0.4 : animal.ability.levels[0].trigger === "onHurt" ? 0.3 : 0.2;
  return animal.baseAttack + animal.baseHealth + animal.tier * 0.5 + triggerWeight;
}

function findMergeable(state: ExpeditionState): [string, string] | null {
  const owned = [...presentMembers(state.team), ...state.reserve];
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
