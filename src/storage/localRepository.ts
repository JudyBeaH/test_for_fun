import { createEmptySave, validateSave } from "../domain/saveSchema";
import type { AppSave } from "../domain/types";
import { BACKUP_KEY, commitTransactional, loadTransactional, SAVE_KEY, STAGING_KEY } from "./transactionalSave";

export function loadSave(): AppSave {
  return loadTransactional(localStorage);
}

export function saveAppSave(save: AppSave): AppSave {
  return commitTransactional(localStorage, save);
}

export function exportSave(save: AppSave): string {
  return JSON.stringify(save, null, 2);
}

export function importSaveJson(json: string): { ok: boolean; save: AppSave; messageZh: string } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!validateSave(parsed)) return { ok: false, save: createEmptySave(), messageZh: "导入内容不是 v0.2 有效存档。" };
    return { ok: true, save: parsed, messageZh: "存档已导入，保存前请确认摘要。" };
  } catch {
    return { ok: false, save: createEmptySave(), messageZh: "JSON 无法解析。" };
  }
}

export function resetSave(): AppSave {
  const save = createEmptySave();
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  localStorage.removeItem(STAGING_KEY);
  return save;
}

export function stagingInfo(): string {
  return localStorage.getItem(STAGING_KEY) ?? "无 staging";
}

export function clearStaging(): void {
  localStorage.removeItem(STAGING_KEY);
}

export { BACKUP_KEY, SAVE_KEY, STAGING_KEY };
