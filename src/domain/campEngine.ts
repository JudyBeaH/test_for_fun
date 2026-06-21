import { ANIMALS, ANIMAL_BY_ID } from "../content/animals";
import { CAMP_LEVELS } from "../content/campLevels";
import { DEFAULT_CAMP_ECONOMY } from "../content/constants";
import { ITEMS, ITEM_BY_ID } from "../content/items";
import type {
  AnimalOffer,
  CampAction,
  CampModifier,
  ComputedCampRules,
  DomainResult,
  ExpeditionState,
  Habitat,
  ItemOffer,
  OfferSlot,
  SpeciesId,
  TeamMember,
  TeamSnapshot,
  TeamSnapshotUnit,
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
  const modifiers = [...teamMembers(state.team).flatMap((member) => ANIMAL_BY_ID[member.speciesId].campModifiers ?? []), ...extraModifiers];
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
  const heldAnimal = new Map(next.camp?.animalSlots.filter((slot) => slot.held && slot.offer).map((slot) => [slot.slotId, slot]));
  const heldItems = new Map(next.camp?.itemSlots.filter((slot) => slot.held && slot.offer).map((slot) => [slot.slotId, slot]));
  const supply = clamp(rules.baseSupply + Math.min(previousLeftover, rules.carrySupplyLimit), 0, rules.supplyCap);
  next.phase = "camp";
  next.camp = {
    campId: makeId("camp", next.expeditionSeed, next.round),
    campLevel: rules.campLevel,
    supply,
    freeRefreshes: rules.freeRefreshes,
    animalSlots: Array.from({ length: 5 }, (_, index) => {
      const unlocked = index < rules.animalOfferSlots;
      const old = heldAnimal.get(makeId("animal_slot", next.expeditionSeed + next.round - 1, index));
      return old && unlocked ? { ...old, slotId: makeId("animal_slot", next.expeditionSeed + next.round, index) } : rollAnimalSlot(next.expeditionSeed, next.round, index, unlocked, rules);
    }),
    itemSlots: Array.from({ length: rules.itemOfferSlots }, (_, index) => {
      const old = heldItems.get(makeId("item_slot", next.expeditionSeed + next.round - 1, index));
      return old ?? rollItemSlot(next.expeditionSeed, next.round, index);
    }),
  };
  return next;
}

function isMember(member: TeamMember | null | undefined): member is TeamMember {
  return Boolean(member);
}

function teamMembers(team: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return team.filter(isMember);
}

function teamOccupancy(team: readonly (TeamMember | null | undefined)[]): number {
  return teamMembers(team).length;
}

function firstOpenTeamSlot(team: readonly (TeamMember | null | undefined)[]): number {
  for (let index = 0; index < 5; index += 1) {
    if (!team[index]) return index;
  }
  return -1;
}

function setTeamSlot(team: Array<TeamMember | null>, index: number, member: TeamMember | null): void {
  for (let i = 0; i < index; i += 1) {
    if (!(i in team)) team[i] = null;
  }
  team[index] = member;
}

function allOwned(state: ExpeditionState): TeamMember[] {
  return [...teamMembers(state.team), ...state.reserve];
}

function hasDuplicateOwnedIds(state: ExpeditionState): boolean {
  const ids = allOwned(state).map((member) => member.instanceId);
  return new Set(ids).size !== ids.length;
}

function findOwned(state: ExpeditionState, instanceId: string): { member: TeamMember; area: "team" | "reserve"; index: number } | undefined {
  const ti = state.team.findIndex((member) => member?.instanceId === instanceId);
  if (ti >= 0 && state.team[ti]) return { member: state.team[ti], area: "team", index: ti };
  const ri = state.reserve.findIndex((member) => member.instanceId === instanceId);
  if (ri >= 0) return { member: state.reserve[ri], area: "reserve", index: ri };
  return undefined;
}

function removeOwned(state: ExpeditionState, area: "team" | "reserve", index: number): TeamMember {
  if (area === "team") {
    const member = state.team[index];
    if (!member) throw new Error("invalid team slot removal");
    setTeamSlot(state.team, index, null);
    return member;
  }
  return state.reserve.splice(index, 1)[0];
}

function insertOwned(state: ExpeditionState, area: "team" | "reserve", member: TeamMember, index?: number): void {
  if (area === "team") {
    const slot = index ?? firstOpenTeamSlot(state.team);
    if (slot < 0 || slot > 4) return;
    setTeamSlot(state.team, slot, member);
    return;
  }
  state.reserve.splice(index ?? state.reserve.length, 0, member);
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

export function applyCampAction(state: ExpeditionState, action: CampAction): DomainResult<ExpeditionState> {
  const next = structuredClone(state) as ExpeditionState;
  const rules = computeCampRules(next);
  const upgradeDiscoveryActions = new Set<CampAction["type"]>(["chooseDiscovery", "placePendingRecruit", "discardPendingRecruit", "release"]);
  if (next.phase !== "camp" && (next.phase !== "upgradeDiscovery" || !upgradeDiscoveryActions.has(action.type))) return { ok: false, state, messageZh: "当前阶段不能执行营地操作。" };
  if (!next.camp && action.type !== "placePendingRecruit" && action.type !== "discardPendingRecruit") return { ok: false, state, messageZh: "尚未进入营地。" };
  const camp = next.camp;
  if (action.type === "toggleHold") {
    const slots = action.slotKind === "animal" ? camp?.animalSlots : camp?.itemSlots;
    const slot = slots?.find((item) => item.slotId === action.slotId);
    if (!slot || !slot.unlocked || !slot.offer) return { ok: false, state, messageZh: "空格或未开放格不能留意。" };
    slot.held = !slot.held;
    return { ok: true, state: next, messageZh: slot.held ? "已留意。" : "已取消留意。" };
  }
  if (action.type === "refresh") {
    if (!camp) return { ok: false, state, messageZh: "没有营地可刷新。" };
    const refreshable = [...camp.animalSlots, ...camp.itemSlots].some((slot) => slot.unlocked && !slot.held);
    if (!refreshable) return { ok: false, state, messageZh: "所有开放格都已留意，无法刷新。" };
    if (camp.freeRefreshes > 0) camp.freeRefreshes -= 1;
    else {
      if (camp.supply < rules.refreshCost) return { ok: false, state, messageZh: "补给不足，无法刷新。" };
      camp.supply -= rules.refreshCost;
    }
    camp.animalSlots = camp.animalSlots.map((slot, index) => slot.unlocked && !slot.held ? rollAnimalSlot(next.expeditionSeed + camp.supply, next.round, index, slot.unlocked, rules) : slot);
    camp.itemSlots = camp.itemSlots.map((slot, index) => slot.unlocked && !slot.held ? rollItemSlot(next.expeditionSeed + camp.supply, next.round, index) : slot);
    return { ok: true, state: next, messageZh: "市场已刷新。" };
  }
  if (action.type === "recruitToTeam" || action.type === "recruitToReserve" || action.type === "recruitMerge") {
    if (!camp) return { ok: false, state, messageZh: "没有营地可招募。" };
    if (camp.supply < rules.recruitCost) return { ok: false, state, messageZh: "补给不足，无法招募。" };
    const slot = camp.animalSlots.find((item) => item.slotId === action.slotId);
    if (!slot?.offer || !slot.unlocked) return { ok: false, state, messageZh: "这个动物位没有可招募动物。" };
    const member = createMember(slot.offer.speciesId, next.expeditionSeed, next.round, allOwned(next).length + 1);
    if (action.type === "recruitToTeam") {
      if (teamOccupancy(next.team) >= 5) return { ok: false, state, messageZh: "战斗队已满。" };
      insertOwned(next, "team", member);
    } else if (action.type === "recruitToReserve") {
      if (next.reserve.length >= rules.reserveCapacity) return { ok: false, state, messageZh: "替补区已满。" };
      next.reserve.push(member);
    } else {
      const target = findOwned(next, action.targetInstanceId);
      if (!target) return { ok: false, state, messageZh: "没有找到合成目标。" };
      if (target.member.speciesId !== member.speciesId) return { ok: false, state, messageZh: "只能拖到同物种单位上合成。" };
      const merge = mergeMembers(next, member, target.member);
      if (!merge.ok) return { ok: false, state, messageZh: merge.messageZh };
    }
    camp.supply -= rules.recruitCost;
    clearOffer(slot);
    return { ok: true, state: next, messageZh: `${ANIMAL_BY_ID[member.speciesId].nameZh}已加入。` };
  }
  if (action.type === "moveOwned") {
    const source = action.sourceArea === "team" ? next.team[action.sourceIndex] : next.reserve[action.sourceIndex];
    if (action.sourceIndex < 0 || !source) return { ok: false, state, messageZh: "来源位置无效。" };
    if (action.targetIndex < 0) return { ok: false, state, messageZh: "目标位置无效。" };
    if (action.targetArea === "team" && action.targetIndex > 4) return { ok: false, state, messageZh: "战斗队最多 5 只。" };
    if (action.targetArea === "reserve" && action.targetIndex > rules.reserveCapacity - 1) return { ok: false, state, messageZh: `替补区最多 ${rules.reserveCapacity} 只。` };
    if (action.sourceArea === action.targetArea) {
      if (action.sourceIndex === action.targetIndex) return { ok: true, state: next, messageZh: "队列未变化。" };
      if (action.sourceArea === "team") {
        const target = next.team[action.targetIndex] ?? null;
        setTeamSlot(next.team, action.sourceIndex, target);
        setTeamSlot(next.team, action.targetIndex, source);
      } else {
        const target = next.reserve[action.targetIndex];
        if (target) {
          [next.reserve[action.sourceIndex], next.reserve[action.targetIndex]] = [next.reserve[action.targetIndex], next.reserve[action.sourceIndex]];
        } else {
          const [moved] = next.reserve.splice(action.sourceIndex, 1);
          const adjustedTarget = action.targetIndex > action.sourceIndex ? action.targetIndex - 1 : action.targetIndex;
          next.reserve.splice(Math.min(adjustedTarget, next.reserve.length), 0, moved);
        }
      }
      if (hasDuplicateOwnedIds(next)) return { ok: false, state, messageZh: "移动被取消：检测到重复个体。" };
      return { ok: true, state: next, messageZh: "队列已调整。" };
    }
    const target = action.targetArea === "team" ? next.team[action.targetIndex] : next.reserve[action.targetIndex];
    if (!target) {
      if (action.targetArea === "team" && teamOccupancy(next.team) >= 5) return { ok: false, state, messageZh: "战斗队已满。" };
      if (action.targetArea === "reserve" && next.reserve.length >= rules.reserveCapacity) return { ok: false, state, messageZh: "替补区已满。" };
    }
    if (action.sourceArea === "team" && action.targetArea === "reserve") {
      if (target) {
        setTeamSlot(next.team, action.sourceIndex, target);
        next.reserve[action.targetIndex] = source;
      } else {
        setTeamSlot(next.team, action.sourceIndex, null);
        next.reserve.splice(Math.min(action.targetIndex, next.reserve.length), 0, source);
      }
    } else {
      if (target) {
        next.reserve[action.sourceIndex] = target;
        setTeamSlot(next.team, action.targetIndex, source);
      } else {
        next.reserve.splice(action.sourceIndex, 1);
        setTeamSlot(next.team, action.targetIndex, source);
      }
    }
    if (hasDuplicateOwnedIds(next)) return { ok: false, state, messageZh: "移动被取消：检测到重复个体。" };
    return { ok: true, state: next, messageZh: "队列已调整。" };
  }
  if (action.type === "mergeOwned") {
    const source = findOwned(next, action.sourceInstanceId);
    const target = findOwned(next, action.targetInstanceId);
    if (!source || !target) return { ok: false, state, messageZh: "没有找到要合成的动物。" };
    const merge = mergeMembers(next, source.member, target.member);
    if (!merge.ok) return { ok: false, state, messageZh: merge.messageZh };
    removeOwned(next, source.area, source.index);
    next.stats.merges += 1;
    return { ok: true, state: next, messageZh: "合成完成，若升级会进入高级发现。" };
  }
  if (action.type === "release") {
    if (!camp) return { ok: false, state, messageZh: "没有营地。" };
    const found = findOwned(next, action.instanceId);
    if (!found || found.area !== action.area) return { ok: false, state, messageZh: "没有找到要告别的动物。" };
    removeOwned(next, found.area, found.index);
    const refund = releaseRefundForLevel(memberLevel(found.member));
    camp.supply += refund;
    return { ok: true, state: next, messageZh: `已告别并返还 ${refund} 点补给。` };
  }
  if (action.type === "buyItemToInventory" || action.type === "buyAndUseItem") {
    if (!camp) return { ok: false, state, messageZh: "没有营地可购买道具。" };
    const slot = camp.itemSlots.find((item) => item.slotId === action.slotId);
    if (!slot?.offer) return { ok: false, state, messageZh: "这个道具位是空的。" };
    const item = ITEM_BY_ID[slot.offer.itemId];
    if (camp.supply < item.price) return { ok: false, state, messageZh: "补给不足，无法购买道具。" };
    if (action.type === "buyItemToInventory") {
      if (next.inventory.length >= rules.inventoryCapacity) return { ok: false, state, messageZh: "仓库已满。" };
      next.inventory.push({ instanceId: makeId("item", next.expeditionSeed + next.round, next.inventory.length + 1), itemId: item.id });
    } else {
      if (item.kind === "equipment") {
        const equip = equipPurchasedItem(next, item.id, action.targetInstanceIds, rules.inventoryCapacity);
        if (!equip.ok) return { ok: false, state, messageZh: equip.messageZh };
      } else {
        const use = applyItemEffects(next, item.id, action.targetInstanceIds);
        if (!use.ok) return { ok: false, state, messageZh: use.messageZh };
      }
    }
    camp.supply -= item.price;
    clearOffer(slot);
    return { ok: true, state: next, messageZh: `${item.nameZh}已${action.type === "buyItemToInventory" ? "放入仓库" : item.kind === "equipment" ? "装备" : "使用"}。` };
  }
  if (action.type === "useInventoryItem") {
    const index = next.inventory.findIndex((item) => item.instanceId === action.itemInstanceId);
    if (index < 0) return { ok: false, state, messageZh: "没有找到仓库道具。" };
    const item = next.inventory[index];
    const def = ITEM_BY_ID[item.itemId];
    if (def.kind === "equipment") return { ok: false, state, messageZh: "装备需要选择装备操作。" };
    const use = applyItemEffects(next, item.itemId, action.targetInstanceIds);
    if (!use.ok) return { ok: false, state, messageZh: use.messageZh };
    next.inventory.splice(index, 1);
    return { ok: true, state: next, messageZh: `${def.nameZh}已使用。` };
  }
  if (action.type === "equipInventoryItem") {
    const itemIndex = next.inventory.findIndex((item) => item.instanceId === action.itemInstanceId);
    const target = findOwned(next, action.targetInstanceId);
    if (itemIndex < 0 || !target) return { ok: false, state, messageZh: "装备或目标不存在。" };
    const item = next.inventory[itemIndex];
    const def = ITEM_BY_ID[item.itemId];
    if (def.kind !== "equipment") return { ok: false, state, messageZh: "这个道具不是装备。" };
    const old = target.member.equipment;
    if (old && next.inventory.length >= rules.inventoryCapacity && !action.discardOld) return { ok: false, state, messageZh: "仓库已满，请确认丢弃旧装备。" };
    next.inventory.splice(itemIndex, 1);
    if (old && !action.discardOld) next.inventory.push({ instanceId: old.instanceId, itemId: old.itemId });
    target.member.equipment = { instanceId: item.instanceId, itemId: item.itemId };
    return { ok: true, state: next, messageZh: "装备已更新。" };
  }
  if (action.type === "chooseDiscovery") {
    const index = next.pendingDiscoveries.findIndex((discovery) => discovery.discoveryId === action.discoveryId);
    if (index < 0) return { ok: false, state, messageZh: "没有这个高级发现。" };
    const discovery = next.pendingDiscoveries[index];
    if (!discovery.candidates.includes(action.speciesId)) return { ok: false, state, messageZh: "候选动物无效。" };
    next.pendingRecruit = createMember(action.speciesId, next.expeditionSeed + discovery.discoveryId.length, next.round, allOwned(next).length + 1);
    next.pendingDiscoveries.splice(index, 1);
    next.phase = "upgradeDiscovery";
    return { ok: true, state: next, messageZh: "请选择把新伙伴放入战斗队或替补。" };
  }
  if (action.type === "discardPendingRecruit") {
    if (!next.pendingRecruit) return { ok: false, state, messageZh: "没有待安置的新伙伴。" };
    next.pendingRecruit = null;
    next.phase = next.pendingDiscoveries.length ? "upgradeDiscovery" : "camp";
    return { ok: true, state: next, messageZh: "已告别待安置伙伴。" };
  }
  if (action.type === "placePendingRecruit") {
    if (!next.pendingRecruit) return { ok: false, state, messageZh: "没有待安置的新伙伴。" };
    if (action.replaceInstanceId) {
      const found = findOwned(next, action.replaceInstanceId);
      if (!found) return { ok: false, state, messageZh: "没有找到要替换的单位。" };
      const list = found.area === "team" ? next.team : next.reserve;
      if (found.area === "team") setTeamSlot(next.team, found.index, next.pendingRecruit);
      else list[found.index] = next.pendingRecruit;
    } else {
      if (action.area === "team" && teamOccupancy(next.team) >= 5) return { ok: false, state, messageZh: "战斗队已满。" };
      if (action.area === "reserve" && next.reserve.length >= rules.reserveCapacity) return { ok: false, state, messageZh: "替补区已满。" };
      insertOwned(next, action.area, next.pendingRecruit, action.index);
    }
    next.pendingRecruit = null;
    next.phase = next.pendingDiscoveries.length ? "upgradeDiscovery" : "camp";
    return { ok: true, state: next, messageZh: "高级发现伙伴已安置。" };
  }
  return { ok: false, state, messageZh: "未知营地操作。" };
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
    state.inventory.push({ instanceId: source.equipment.instanceId, itemId: source.equipment.itemId });
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

function applyItemEffects(state: ExpeditionState, itemId: keyof typeof ITEM_BY_ID, targetInstanceIds: string[]): { ok: boolean; messageZh: string } {
  const item = ITEM_BY_ID[itemId];
  const targets = selectItemTargets(state, item.targetScope, targetInstanceIds);
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

function equipPurchasedItem(state: ExpeditionState, itemId: keyof typeof ITEM_BY_ID, targetInstanceIds: string[], inventoryCapacity: number): { ok: boolean; messageZh: string } {
  const targetId = targetInstanceIds[0];
  if (!targetId) return { ok: false, messageZh: "请选择要装备的动物。" };
  const target = findOwned(state, targetId);
  if (!target) return { ok: false, messageZh: "装备目标不存在。" };
  const old = target.member.equipment;
  if (old && state.inventory.length >= inventoryCapacity) return { ok: false, messageZh: "仓库已满，请先处理旧装备。" };
  if (old) state.inventory.push({ instanceId: old.instanceId, itemId: old.itemId });
  target.member.equipment = { instanceId: makeId("item", state.expeditionSeed + state.round, state.inventory.length + 1), itemId };
  return { ok: true, messageZh: "装备已更新。" };
}

function selectItemTargets(state: ExpeditionState, scope: { kind: string; habitat?: Habitat }, ids: string[]): TeamMember[] {
  const owned = allOwned(state);
  if (scope.kind === "singleUnit") return owned.filter((member) => ids.includes(member.instanceId)).slice(0, 1);
  if (scope.kind === "allOwned") return owned;
  if (scope.kind === "habitat" && scope.habitat) return owned.filter((member) => ANIMAL_BY_ID[member.speciesId].habitats.includes(scope.habitat as Habitat));
  return [];
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
