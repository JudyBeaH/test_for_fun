import { ANIMALS } from "../content/animals";
import type { AppSave, ExpeditionState, Fixed2, Fixed3, Fixed5, ItemInstance, ItemInstanceId, OfferSlot, SpeciesId, TeamMember, UnitId } from "./types";

export const SAVE_SCHEMA_VERSION = 3;

export function createEmptySave(): AppSave {
  const collection = Object.fromEntries(ANIMALS.map((animal) => [animal.id, {
    seen: false,
    memory: 0,
    traceProgress: 0,
    journalUnlocked: false,
    adopted: false,
  }])) as AppSave["collection"];
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
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

function fixed5<T>(items: readonly T[], fallback: T): Fixed5<T> {
  return [items[0] ?? fallback, items[1] ?? fallback, items[2] ?? fallback, items[3] ?? fallback, items[4] ?? fallback];
}

function fixed3<T>(items: readonly T[], fallback: T): Fixed3<T> {
  return [items[0] ?? fallback, items[1] ?? fallback, items[2] ?? fallback];
}

function fixed2<T>(items: readonly T[], fallback: T): Fixed2<T> {
  return [items[0] ?? fallback, items[1] ?? fallback];
}

function migrateExpedition(value: unknown): ExpeditionState | null {
  if (!value || typeof value !== "object") return null;
  const exp = structuredClone(value) as ExpeditionState;
  const legacy = exp as unknown as {
    team?: unknown;
    reserve?: unknown;
    inventory?: unknown;
    unitsById?: Record<UnitId, TeamMember>;
    itemsById?: Record<ItemInstanceId, ItemInstance>;
  };

  if (!legacy.unitsById) {
    const unitsById: Record<UnitId, TeamMember> = {};
    const legacyTeam = Array.isArray(legacy.team) ? legacy.team as Array<TeamMember | null> : [];
    const legacyReserve = Array.isArray(legacy.reserve) ? legacy.reserve as Array<TeamMember | null> : [];
    const formationIds = legacyTeam.slice(0, 5).map((member) => {
      if (!member || typeof member !== "object") return null;
      unitsById[member.instanceId] = member;
      return member.instanceId;
    });
    const reserveIds = legacyReserve.slice(0, 3).map((member) => {
      if (!member || typeof member !== "object") return null;
      unitsById[member.instanceId] = member;
      return member.instanceId;
    });
    exp.unitsById = unitsById;
    exp.formation = fixed5(formationIds, null);
    exp.reserve = fixed3(reserveIds, null);
    delete legacy.team;
  } else {
    exp.formation = fixed5(exp.formation ?? [], null);
    exp.reserve = fixed3(exp.reserve as Fixed3<UnitId | null> ?? [], null);
  }

  if (!legacy.itemsById) {
    const itemsById: Record<ItemInstanceId, ItemInstance> = {};
    const legacyInventory = Array.isArray(legacy.inventory) ? legacy.inventory as ItemInstance[] : [];
    const inventoryIds = legacyInventory.slice(0, 3).map((item) => {
      if (!item || typeof item !== "object") return null;
      itemsById[item.instanceId] = item;
      return item.instanceId;
    });
    exp.itemsById = itemsById;
    exp.inventory = fixed3(inventoryIds, null);
  } else {
    exp.inventory = fixed3(exp.inventory as Fixed3<ItemInstanceId | null> ?? [], null);
  }

  if (exp.camp) {
    const legacyCamp = exp.camp as typeof exp.camp & {
      animalSlots?: OfferSlot<unknown>[];
      itemSlots?: OfferSlot<unknown>[];
    };
    const emptyAnimal = { slotId: "empty_animal_slot", kind: "animal" as const, unlocked: false, held: false, offer: null };
    const emptyItem = { slotId: "empty_item_slot", kind: "item" as const, unlocked: false, held: false, offer: null };
    exp.camp.animalOffers = fixed5(exp.camp.animalOffers ?? legacyCamp.animalSlots ?? [], emptyAnimal);
    exp.camp.itemOffers = fixed2(exp.camp.itemOffers ?? legacyCamp.itemSlots ?? [], emptyItem);
    delete legacyCamp.animalSlots;
    delete legacyCamp.itemSlots;
  }

  return exp;
}

export function migrateSave(value: unknown): AppSave | null {
  if (!value || typeof value !== "object") return null;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  const save = value as Partial<AppSave>;
  if ((schemaVersion !== 2 && schemaVersion !== SAVE_SCHEMA_VERSION) || typeof save.saveRevision !== "number") return null;
  if (!save.collection || typeof save.collection !== "object") return null;
  for (const animal of ANIMALS) {
    const entry = save.collection[animal.id as SpeciesId];
    if (!entry || typeof entry.memory !== "number" || typeof entry.traceProgress !== "number" || typeof entry.seen !== "boolean") return null;
  }
  if (!Array.isArray(save.registeredTeams) || !Array.isArray(save.challengeHistory) || !save.settings) return null;
  const migrated = structuredClone(save) as AppSave;
  migrated.schemaVersion = SAVE_SCHEMA_VERSION;
  migrated.activeExpedition = migrated.activeExpedition ? migrateExpedition(migrated.activeExpedition) : null;
  return migrated;
}

export function validateSave(value: unknown): value is AppSave {
  return migrateSave(value) !== null;
}
