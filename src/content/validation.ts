import { ANIMALS } from "./animals";
import { CAMP_LEVELS } from "./campLevels";
import { CONTENT_VERSION } from "./constants";
import { ITEMS } from "./items";
import type { AnimalTier, EffectDef, TargetSelector } from "../domain/types";

const TIERS = [1, 2, 3, 4, 5] as const satisfies readonly AnimalTier[];
const TARGET_SELECTORS = [
  "self",
  "allyFront",
  "allyBack",
  "allyBehindSelf",
  "allyAheadSelf",
  "allyLowestHealth",
  "allAllies",
  "randomAlly",
  "enemyFront",
  "enemyBack",
  "enemyLowestHealth",
  "randomEnemy",
  "attacker",
] as const satisfies readonly TargetSelector[];

export interface ContentValidationResult {
  ok: boolean;
  errors: string[];
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function validateEffect(effect: EffectDef, animalIds: ReadonlySet<string>, errors: string[], path: string): void {
  if ("target" in effect && !TARGET_SELECTORS.includes(effect.target)) errors.push(`${path} has unknown target selector ${effect.target}`);
  if ("amount" in effect && !Number.isFinite(effect.amount)) errors.push(`${path} has invalid amount`);
  if (effect.kind === "swapSelfWithNearestAlly") {
    if (!["ahead", "behind"].includes(effect.direction)) errors.push(`${path} has invalid swap direction ${effect.direction}`);
    if ((effect.buffSwappedAllyAttack ?? 0) < 0) errors.push(`${path} has invalid swapped ally attack buff`);
  }
  if ((effect.kind === "pushTarget" || effect.kind === "pullTarget") && (!Number.isInteger(effect.offset) || effect.offset < 1 || effect.offset > 4)) errors.push(`${path} has invalid movement offset`);
  if (effect.kind === "dealDamageAndGainOnRetreat") {
    if (!Number.isFinite(effect.damage) || effect.damage < 0) errors.push(`${path} has invalid conditional damage`);
    if ((effect.attackGain ?? 0) < 0 || (effect.healthGain ?? 0) < 0) errors.push(`${path} has invalid conditional gains`);
    if (!effect.attackGain && !effect.healthGain) errors.push(`${path} must define a conditional gain`);
  }
  if (effect.kind === "summonUnit") {
    if (!animalIds.has(effect.speciesId)) errors.push(`${path} summons unknown species ${effect.speciesId}`);
    if (![1, 2, 3].includes(effect.level)) errors.push(`${path} has invalid summoned level ${effect.level}`);
    if (!Number.isFinite(effect.attack) || effect.attack < 0) errors.push(`${path} has invalid summoned attack`);
    if (!Number.isFinite(effect.health) || effect.health < 1) errors.push(`${path} has invalid summoned health`);
    if (!["sourceThenBack", "frontmostEmpty", "backmostEmpty"].includes(effect.placement)) errors.push(`${path} has invalid summon placement ${effect.placement}`);
  }
}

export function validateContent(contentVersion = CONTENT_VERSION): ContentValidationResult {
  const errors: string[] = [];
  if (!contentVersion || contentVersion !== CONTENT_VERSION) errors.push(`contentVersion mismatch: ${contentVersion}`);
  if (!/^0\.\d+\.\d+-prototype$/.test(CONTENT_VERSION)) errors.push(`invalid CONTENT_VERSION ${CONTENT_VERSION}`);

  const expectedRounds = [1, 2, 4, 6, 8];
  const expectedSlots = [3, 3, 4, 4, 5];
  if (CAMP_LEVELS.length !== 5) errors.push("camp level table must cover exactly five tiers");
  for (const [index, tier] of TIERS.entries()) {
    const row = CAMP_LEVELS[index];
    if (!row) continue;
    if (row.tier !== tier) errors.push(`camp tier row ${index} must be T${tier}`);
    if (row.minRound !== expectedRounds[index]) errors.push(`T${tier} must start at round ${expectedRounds[index]}`);
    if (row.animalOfferSlots !== expectedSlots[index]) errors.push(`T${tier} must expose ${expectedSlots[index]} animal offer slots`);
    if (row.maxAnimalTier !== tier) errors.push(`T${tier} maxAnimalTier must be ${tier}`);
    const weightTotal = TIERS.reduce((sum, item) => sum + row.animalTierWeights[item], 0);
    if (Math.abs(weightTotal - 1) > 0.000001) errors.push(`T${tier} animalTierWeights must sum to 1`);
    for (const item of TIERS) {
      if (row.animalTierWeights[item] < 0) errors.push(`T${tier} has negative weight for animal tier ${item}`);
      if (item > tier && row.animalTierWeights[item] !== 0) errors.push(`T${tier} must not roll locked animal tier ${item}`);
    }
  }

  const animalIds = new Set(ANIMALS.map((animal) => animal.id));
  for (const duplicate of duplicateIds(ANIMALS.map((animal) => animal.id))) errors.push(`duplicate animal id ${duplicate}`);
  for (const duplicate of duplicateIds(ANIMALS.map((animal) => animal.nameZh))) errors.push(`duplicate animal name ${duplicate}`);
  for (const animal of ANIMALS) {
    if (!TIERS.includes(animal.tier)) errors.push(`${animal.id} has invalid tier ${animal.tier}`);
    if (animal.baseHealth < 1) errors.push(`${animal.id} must have positive base health`);
    if (animal.baseAttack < 0) errors.push(`${animal.id} must not have negative base attack`);
    if (!animal.ability.nameZh.trim()) errors.push(`${animal.id} must have ability name text`);
    if (animal.levelAttackBonus.length !== 3 || animal.levelHealthBonus.length !== 3 || animal.ability.levels.length !== 3) errors.push(`${animal.id} must define exactly three bond levels`);
    for (const [index, level] of animal.ability.levels.entries()) {
      for (const [effectIndex, effect] of level.effects.entries()) validateEffect(effect, animalIds, errors, `${animal.id}.ability.levels[${index}].effects[${effectIndex}]`);
    }
  }
  for (const duplicate of duplicateIds(ITEMS.map((item) => item.id))) errors.push(`duplicate item id ${duplicate}`);

  return { ok: errors.length === 0, errors };
}
