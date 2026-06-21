export const CAMP_LEVELS = [
  {
    level: 1,
    minRound: 1,
    maxRound: 3,
    animalOfferSlots: 3,
    maxAnimalTier: 1,
    animalTierWeights: { 1: 1, 2: 0, 3: 0 },
  },
  {
    level: 2,
    minRound: 4,
    maxRound: 6,
    animalOfferSlots: 4,
    maxAnimalTier: 2,
    animalTierWeights: { 1: 0.7, 2: 0.3, 3: 0 },
  },
  {
    level: 3,
    minRound: 7,
    maxRound: null,
    animalOfferSlots: 5,
    maxAnimalTier: 3,
    animalTierWeights: { 1: 0.45, 2: 0.35, 3: 0.2 },
  },
] as const;
