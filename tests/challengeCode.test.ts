import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ENGINE_VERSION, REGION_ID } from "../src/content/constants";
import { decodeChallengeCode, encodeChallengeCode } from "../src/domain/challengeCode";
import type { RegisteredTeam } from "../src/domain/types";

function team(overrides: Partial<RegisteredTeam> = {}): RegisteredTeam {
  return {
    teamId: "team_1",
    name: "测试队",
    sourceRunId: "run_1",
    sourceBattleId: "battle_1",
    createdAtIso: "2026-06-21T00:00:00.000Z",
    regionId: REGION_ID,
    badges: 10,
    lineupSnapshot: { units: [{ snapshotUnitId: "u1", speciesId: "frog", position: 0, bondXp: 1, level: 1, initialAttack: 3, initialMaxHealth: 4, equipmentEffect: null, startingStatuses: [] }] },
    finalBattleEnvironmentId: "meadow",
    finalBattleSeed: 1,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    highlight: "测试",
    ...overrides,
  };
}

describe("WT2 challenge code", () => {
  it("往返保持快照一致", () => {
    expect(decodeChallengeCode(encodeChallengeCode(team())).team).toEqual(team());
  });

  it("损坏 checksum 被拒绝", () => {
    expect(decodeChallengeCode(`${encodeChallengeCode(team())}x`).ok).toBe(false);
  });

  it("不兼容版本为博物馆队伍", () => {
    const decoded = decodeChallengeCode(encodeChallengeCode(team({ engineVersion: "old" })));
    expect(decoded.ok).toBe(true);
    expect(decoded.museumOnly).toBe(true);
  });
});
