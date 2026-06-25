import { ANIMALS } from "../content/animals";
import { CONTENT_VERSION } from "../content/constants";
import { ENVIRONMENTS } from "../content/environments";
import { ITEMS } from "../content/items";
import type { AnimalTier, EnvironmentId, ItemId, SpeciesId } from "../domain/types";

export interface SimReport {
  runs: number;
  seed: number;
  contentVersion: string;
  animalCount: number;
  animalTierCounts: Record<AnimalTier, number>;
  successRate: number;
  averageBadges: number;
  averageRounds: number;
  averageBattleEvents: number;
  safetyCapCount: number;
  drawRate: number;
  species: Record<SpeciesId, {
    seenRate: number;
    recruitRate: number;
    reserveRate: number;
    averageFinalLevel: number;
    teamWinRate: number;
    averageContribution: number;
  }>;
  items: Record<ItemId, {
    appearanceRate: number;
    purchaseRate: number;
    useRate: number;
    equipRate: number;
  }>;
  merges: number;
  upgradeDiscoveries: number;
  discoveryChoices: Record<string, number>;
  environments: Record<EnvironmentId, { battles: number; winRate: number }>;
  rewardDistribution: Record<string, number>;
  melatonin: { uses: number; wakes: number; empoweredHits: number };
  averageCampActions: number;
  averageRemainingSupply: number;
  invalidActionReasons: Record<string, number>;
}

export function createAccumulator(runs: number, seed: number): SimReport {
  return {
    runs,
    seed,
    contentVersion: CONTENT_VERSION,
    animalCount: ANIMALS.length,
    animalTierCounts: {
      1: ANIMALS.filter((animal) => animal.tier === 1).length,
      2: ANIMALS.filter((animal) => animal.tier === 2).length,
      3: ANIMALS.filter((animal) => animal.tier === 3).length,
      4: ANIMALS.filter((animal) => animal.tier === 4).length,
      5: ANIMALS.filter((animal) => animal.tier === 5).length,
    },
    successRate: 0,
    averageBadges: 0,
    averageRounds: 0,
    averageBattleEvents: 0,
    safetyCapCount: 0,
    drawRate: 0,
    species: Object.fromEntries(ANIMALS.map((animal) => [animal.id, { seenRate: 0, recruitRate: 0, reserveRate: 0, averageFinalLevel: 0, teamWinRate: 0, averageContribution: 0 }])) as SimReport["species"],
    items: Object.fromEntries(ITEMS.map((item) => [item.id, { appearanceRate: 0, purchaseRate: 0, useRate: 0, equipRate: 0 }])) as SimReport["items"],
    merges: 0,
    upgradeDiscoveries: 0,
    discoveryChoices: {},
    environments: Object.fromEntries(ENVIRONMENTS.map((environment) => [environment.id, { battles: 0, winRate: 0 }])) as SimReport["environments"],
    rewardDistribution: { companionMark: 0, unknownTrace: 0, habitatSeed: 0 },
    melatonin: { uses: 0, wakes: 0, empoweredHits: 0 },
    averageCampActions: 0,
    averageRemainingSupply: 0,
    invalidActionReasons: {},
  };
}
