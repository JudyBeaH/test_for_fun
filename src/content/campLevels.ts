import type { AnimalTier } from "../domain/types";

export interface CampLevelRow {
  tier: AnimalTier;
  minRound: number;
  animalOfferSlots: 3 | 4 | 5;
  maxAnimalTier: AnimalTier;
  animalTierWeights: Record<AnimalTier, number>;
}

export interface CampLevelState {
  currentTier: AnimalTier;
  nextUpgradeRound: number | null;
  justUpgraded: boolean;
}

export const CAMP_LEVELS: readonly CampLevelRow[] = [
  { tier: 1, minRound: 1, animalOfferSlots: 3, maxAnimalTier: 1, animalTierWeights: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } },
  { tier: 2, minRound: 2, animalOfferSlots: 3, maxAnimalTier: 2, animalTierWeights: { 1: 0.75, 2: 0.25, 3: 0, 4: 0, 5: 0 } },
  { tier: 3, minRound: 4, animalOfferSlots: 4, maxAnimalTier: 3, animalTierWeights: { 1: 0.45, 2: 0.35, 3: 0.2, 4: 0, 5: 0 } },
  { tier: 4, minRound: 6, animalOfferSlots: 4, maxAnimalTier: 4, animalTierWeights: { 1: 0.25, 2: 0.3, 3: 0.3, 4: 0.15, 5: 0 } },
  { tier: 5, minRound: 8, animalOfferSlots: 5, maxAnimalTier: 5, animalTierWeights: { 1: 0.15, 2: 0.2, 3: 0.3, 4: 0.25, 5: 0.1 } },
] as const;

export function campLevelRowForRound(round: number): CampLevelRow {
  return [...CAMP_LEVELS].reverse().find((row) => round >= row.minRound) ?? CAMP_LEVELS[0];
}

export function campLevelStateForRound(round: number): CampLevelState {
  const row = campLevelRowForRound(round);
  const next = CAMP_LEVELS.find((candidate) => candidate.minRound > round);
  return {
    currentTier: row.tier,
    nextUpgradeRound: next?.minRound ?? null,
    justUpgraded: row.minRound === round,
  };
}
