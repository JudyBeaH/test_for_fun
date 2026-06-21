import { createEmptySave, validateSave } from "../domain/saveSchema";
import type { AppSave } from "../domain/types";

export const SAVE_KEY = "wildtrail_save";
export const STAGING_KEY = "wildtrail_save_staging";
export const BACKUP_KEY = "wildtrail_corrupt_backup";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parse(raw: string | null): AppSave | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return validateSave(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadTransactional(storage: StorageLike): AppSave {
  const mainRaw = storage.getItem(SAVE_KEY);
  const stagingRaw = storage.getItem(STAGING_KEY);
  const main = parse(mainRaw);
  const staging = parse(stagingRaw);
  if (!main && mainRaw) storage.setItem(BACKUP_KEY, mainRaw);
  if (!staging && stagingRaw) storage.setItem(BACKUP_KEY, stagingRaw);
  const picked = staging && (!main || staging.saveRevision > main.saveRevision) ? staging : main;
  if (picked && picked === staging) {
    storage.setItem(SAVE_KEY, JSON.stringify(staging));
    storage.removeItem(STAGING_KEY);
  }
  return picked ?? createEmptySave();
}

export function commitTransactional(storage: StorageLike, save: AppSave): AppSave {
  const next = structuredClone(save) as AppSave;
  next.saveRevision += 1;
  const raw = JSON.stringify(next);
  storage.setItem(STAGING_KEY, raw);
  const staged = parse(storage.getItem(STAGING_KEY));
  if (!staged) throw new Error("staging save validation failed");
  storage.setItem(SAVE_KEY, JSON.stringify(staged));
  storage.removeItem(STAGING_KEY);
  return staged;
}
