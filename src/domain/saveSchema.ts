import { ANIMALS } from "../content/animals";
import type { AppSave, SpeciesId } from "./types";

export function createEmptySave(): AppSave {
  const collection = Object.fromEntries(ANIMALS.map((animal) => [animal.id, {
    seen: false,
    memory: 0,
    traceProgress: 0,
    journalUnlocked: false,
    adopted: false,
  }])) as AppSave["collection"];
  return {
    schemaVersion: 2,
    saveRevision: 0,
    activeExpedition: null,
    collection,
    habitatSeeds: 0,
    wildFruit: 0,
    unlockedCosmetics: [],
    registeredTeams: [],
    challengedTeamIds: [],
    challengeHistory: [],
    settings: { battleSpeed: 1, reduceMotion: false, soundEnabled: false },
  };
}

export function validateSave(value: unknown): value is AppSave {
  if (!value || typeof value !== "object") return false;
  const save = value as Partial<AppSave>;
  if (save.schemaVersion !== 2 || typeof save.saveRevision !== "number") return false;
  if (!save.collection || typeof save.collection !== "object") return false;
  for (const animal of ANIMALS) {
    const entry = save.collection[animal.id as SpeciesId];
    if (!entry || typeof entry.memory !== "number" || typeof entry.traceProgress !== "number" || typeof entry.seen !== "boolean") return false;
  }
  return Array.isArray(save.registeredTeams) && Array.isArray(save.challengeHistory) && !!save.settings;
}
