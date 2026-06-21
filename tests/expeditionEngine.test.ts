import { describe, expect, it } from "vitest";
import { createEmptySave, validateSave } from "../src/domain/saveSchema";
import { commitTransactional, loadTransactional, type StorageLike } from "../src/storage/transactionalSave";
import { createExpedition, prepareBattle, resolvePreparedBattle } from "../src/domain/expeditionEngine";

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  return {
    data: { ...seed },
    getItem(key: string) { return this.data[key] ?? null; },
    setItem(key: string, value: string) { this.data[key] = value; },
    removeItem(key: string) { delete this.data[key]; },
  };
}

describe("save schema and battle resume", () => {
  it("校验 v2 存档并拒绝旧形状", () => {
    expect(validateSave(createEmptySave())).toBe(true);
    expect(validateSave({ schemaVersion: 1 })).toBe(false);
  });

  it("事务提交使 saveRevision +1，staging 新时可恢复", () => {
    const storage = memoryStorage();
    const saved = commitTransactional(storage, createEmptySave());
    expect(saved.saveRevision).toBe(1);
    const newer = { ...saved, saveRevision: 2 };
    storage.setItem("wildtrail_save_staging", JSON.stringify(newer));
    expect(loadTransactional(storage).saveRevision).toBe(2);
  });

  it("prepared 战斗恢复后同一结果，已结算不重复加章", () => {
    const state = createExpedition(99);
    state.team.push({ instanceId: "frog", speciesId: "frog", bondXp: 1, permanentAttackBonus: 20, permanentHealthBonus: 20, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    const prepared = prepareBattle(state).state;
    const first = resolvePreparedBattle(prepared).state;
    const badges = first.badges;
    const second = resolvePreparedBattle(first).state;
    expect(second.pendingBattle?.output).toEqual(first.pendingBattle?.output);
    expect(second.badges).toBe(badges);
  });
});
