import { describe, expect, it } from "vitest";
import { createExpedition, createRegisteredTeam } from "../src/domain/expeditionEngine";
import { createEmptySave } from "../src/domain/saveSchema";
import { applyChallengeReward, applyRewardChoice, createRewardChoices } from "../src/domain/rewardEngine";
import { battleInputForState } from "../src/sim/opponentGenerator";
import { resolveBattle } from "../src/domain/battleEngine";

describe("rewards and final victory registration", () => {
  it("返程选择始终包含三类", () => {
    const choices = createRewardChoices(createExpedition(1), createEmptySave(), 2);
    expect(new Set(choices.map((choice) => choice.category))).toEqual(new Set(["companionMark", "unknownTrace", "habitatSeed"]));
  });

  it("首次挑战给野果，重复不给", () => {
    let save = createEmptySave();
    save = applyChallengeReward(save, "team_a", "loss", "2026-06-21T00:00:00.000Z");
    save = applyChallengeReward(save, "team_a", "win", "2026-06-21T00:00:01.000Z");
    expect(save.wildFruit).toBe(1);
    expect(save.challengeHistory[0].honorStamp).toBe(true);
  });

  it("登记队伍复制最终胜利战前快照", () => {
    const state = createExpedition(6);
    state.team.push({ instanceId: "frog", speciesId: "frog", bondXp: 6, permanentAttackBonus: 1, permanentHealthBonus: 1, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 });
    const input = battleInputForState(state);
    const output = resolveBattle(input);
    state.finalVictoryRecord = { battleId: input.battleId, input, output, playerPreBattleSnapshot: input.playerTeam };
    const registered = createRegisteredTeam(state, "", 0, "2026-06-21T00:00:00.000Z").state;
    expect(registered.lineupSnapshot).toEqual(input.playerTeam);
    expect(JSON.stringify(registered)).not.toContain("shield");
  });

  it("局外奖励不改变战斗数值", () => {
    const save = applyRewardChoice(createEmptySave(), { id: "x", category: "habitatSeed", titleZh: "", descriptionZh: "" });
    expect(save.habitatSeeds).toBe(1);
  });
});
