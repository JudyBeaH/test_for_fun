import { describe, expect, it } from "vitest";
import { createEmptySave, migrateSave, validateSave } from "../src/domain/saveSchema";
import { commitTransactional, loadTransactional, type StorageLike } from "../src/storage/transactionalSave";
import { completeSuccessResolution, createExpedition, finishBattleReport, prepareBattle, resolvePreparedBattle } from "../src/domain/expeditionEngine";
import { createRewardChoices } from "../src/domain/rewardEngine";
import type { ExpeditionState, TeamMember } from "../src/domain/types";

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  return {
    data: { ...seed },
    getItem(key: string) { return this.data[key] ?? null; },
    setItem(key: string, value: string) { this.data[key] = value; },
    removeItem(key: string) { delete this.data[key]; },
  };
}

function place(state: ExpeditionState, member: TeamMember, slot = 0): void {
  state.unitsById[member.instanceId] = member;
  state.formation[slot as 0 | 1 | 2 | 3 | 4] = member.instanceId;
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

  it("v2 dense expedition save migrates to v3 fixed slots", () => {
    const legacy = createEmptySave() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 2;
    legacy.activeExpedition = {
      ...createExpedition(77),
      team: [
        { instanceId: "t1", speciesId: "frog", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 },
        null,
        { instanceId: "t3", speciesId: "hare", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 },
      ],
      reserve: [
        { instanceId: "r1", speciesId: "crow", bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 },
      ],
      inventory: [{ instanceId: "i1", itemId: "pinecone_sling" }],
      unitsById: undefined,
      itemsById: undefined,
      formation: undefined,
    };

    const migrated = migrateSave(legacy);

    expect(migrated?.schemaVersion).toBe(3);
    expect(migrated?.activeExpedition?.formation).toEqual(["t1", null, "t3", null, null]);
    expect(migrated?.activeExpedition?.reserve).toEqual(["r1", null, null]);
    expect(migrated?.activeExpedition?.inventory).toEqual(["i1", null, null]);
    expect(migrated?.activeExpedition?.unitsById.t1.speciesId).toBe("frog");
    expect(migrated?.activeExpedition?.itemsById.i1.itemId).toBe("pinecone_sling");
  });

  it("prepared 战斗恢复后同一结果，已结算不重复加章", () => {
    const state = createExpedition(99);
    place(state, { instanceId: "frog", speciesId: "frog", bondXp: 1, permanentAttackBonus: 20, permanentHealthBonus: 20, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
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
    place(state, { instanceId: "closer", speciesId: "weasel", bondXp: 6, permanentAttackBonus: 100, permanentHealthBonus: 100, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });

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
