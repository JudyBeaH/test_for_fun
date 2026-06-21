import { describe, expect, it } from "vitest";
import { createEmptySave, validateSave } from "../src/domain/saveSchema";
import { commitTransactional, loadTransactional, type StorageLike } from "../src/storage/transactionalSave";
import { completeSuccessResolution, createExpedition, finishBattleReport, prepareBattle, resolvePreparedBattle } from "../src/domain/expeditionEngine";
import { createRewardChoices } from "../src/domain/rewardEngine";

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

  it("9 胜到 10 胜后进入成功结算并完成冠军登记", () => {
    const state = createExpedition(20260620);
    state.badges = 9;
    state.team = [
      { instanceId: "closer", speciesId: "weasel", bondXp: 6, permanentAttackBonus: 100, permanentHealthBonus: 100, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 },
    ];

    const prepared = prepareBattle(state).state;
    const settled = resolvePreparedBattle(prepared).state;
    expect(settled.pendingBattle?.output?.result).toBe("win");
    expect(settled.badges).toBe(10);
    expect(settled.finalVictoryRecord).not.toBeNull();

    const terminal = finishBattleReport(settled);
    expect(terminal.phase).toBe("successResolution");
    expect(terminal.pendingBattle).toBeNull();
    expect(terminal.finalVictoryRecord).not.toBeNull();

    const save = createEmptySave();
    const rewards = createRewardChoices(terminal, save, terminal.expeditionSeed).slice(0, 2);
    const completed = completeSuccessResolution({
      save: { ...save, activeExpedition: terminal },
      expedition: terminal,
      adoptedSpeciesId: "weasel",
      rewardChoices: rewards,
      teamName: "第十胜队伍",
      createdAtIso: "2026-06-21T00:00:00.000Z",
    });

    expect(completed.ok).toBe(true);
    expect(completed.state.savePatch.activeExpedition).toBeNull();
    expect(completed.state.savePatch.registeredTeams).toHaveLength(1);
    expect(completed.state.registeredTeam.lineupSnapshot).toEqual(terminal.finalVictoryRecord!.playerPreBattleSnapshot);
    expect(completed.state.registeredTeam.name).toBe("第十胜队伍");
    expect(completed.state.savePatch.collection.weasel.adopted).toBe(true);
    expect(JSON.stringify(completed.state.registeredTeam)).not.toContain("shield");
  });
});
