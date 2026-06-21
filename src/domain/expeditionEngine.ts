import { CONTENT_VERSION, ENGINE_VERSION, INITIAL_EXPEDITION, REGION_ID, REGION_NAME_ZH } from "../content/constants";
import { ANIMAL_BY_ID } from "../content/animals";
import type { AppSave, DomainResult, ExpeditionState, RegisteredTeam, RewardChoice, SpeciesId, TeamMember } from "./types";
import { makeRunId, makeTeamId } from "./ids";
import { enterCamp, toTeamSnapshot } from "./campEngine";
import { battleInputForState } from "../sim/opponentGenerator";
import { resolveBattle } from "./battleEngine";
import { applyRewardChoice, createRewardChoices } from "./rewardEngine";

function presentMembers(members: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return members.filter((member): member is TeamMember => Boolean(member));
}

export function createExpedition(seed: number): ExpeditionState {
  const base: ExpeditionState = {
    runId: makeRunId(seed),
    expeditionSeed: seed,
    phase: INITIAL_EXPEDITION.phase,
    round: INITIAL_EXPEDITION.round,
    badges: INITIAL_EXPEDITION.badges,
    morale: INITIAL_EXPEDITION.morale,
    camp: null,
    team: [],
    reserve: [],
    inventory: [],
    pendingRecruit: null,
    pendingDiscoveries: [],
    pendingBattle: null,
    battleHistory: [],
    finalVictoryRecord: null,
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      battlesDrawn: 0,
      animalRounds: {},
      animalContribution: {},
      maxSingleDamage: 0,
      longestSkillChain: 0,
      highlight: "新的湿地探险开始了。",
      upgradeDiscoveries: 0,
      merges: 0,
    },
  };
  return enterCamp(base);
}

export function canDepart(state: ExpeditionState): { ok: boolean; messageZh: string } {
  if (state.phase !== "camp") return { ok: false, messageZh: "请先完成当前营地事务。" };
  if (state.pendingDiscoveries.length > 0 || state.pendingRecruit) return { ok: false, messageZh: "请先完成高级发现。" };
  if (!state.team.some(Boolean)) return { ok: false, messageZh: "至少 1 只战斗队动物才能出发。" };
  return { ok: true, messageZh: "可以出发。" };
}

export function prepareBattle(state: ExpeditionState): DomainResult<ExpeditionState> {
  const check = canDepart(state);
  if (!check.ok) return { ok: false, state, messageZh: check.messageZh };
  const next = structuredClone(state) as ExpeditionState;
  const input = battleInputForState(next);
  next.pendingBattle = { battleId: input.battleId, status: "prepared", input, output: null, settlementApplied: false, playbackCursor: 0 };
  next.phase = "battlePreparing";
  return { ok: true, state: next, messageZh: "遭遇输入已固定并保存。" };
}

export function resolvePreparedBattle(state: ExpeditionState): DomainResult<ExpeditionState> {
  if (!state.pendingBattle) return { ok: false, state, messageZh: "没有已准备的遭遇。" };
  const next = structuredClone(state) as ExpeditionState;
  const pending = next.pendingBattle!;
  if (!pending.output) pending.output = resolveBattle(pending.input);
  pending.status = "resolved";
  const settled = settleResolvedBattle(next);
  return settled.ok ? { ok: true, state: settled.state, messageZh: "遭遇结果已固定并结算。" } : settled;
}

export function settleResolvedBattle(state: ExpeditionState): DomainResult<ExpeditionState> {
  if (!state.pendingBattle?.output) return { ok: false, state, messageZh: "遭遇尚未求解。" };
  const next = structuredClone(state) as ExpeditionState;
  const pending = next.pendingBattle!;
  if (pending.settlementApplied) {
    next.phase = "battlePlayback";
    return { ok: true, state: next, messageZh: "遭遇已结算，继续回放。" };
  }
  const beforeBadges = next.badges;
  const output = pending.output;
  if (!output) return { ok: false, state, messageZh: "遭遇尚未求解。" };
  if (output.result === "win") {
    next.badges += 1;
    next.stats.battlesWon += 1;
  } else if (output.result === "loss") {
    next.morale -= 1;
    next.stats.battlesLost += 1;
  } else {
    next.stats.battlesDrawn += 1;
  }
  for (const member of presentMembers(next.team)) {
    member.participatedRounds += 1;
    next.stats.animalRounds[member.speciesId] = (next.stats.animalRounds[member.speciesId] ?? 0) + 1;
    member.timedStatuses = member.timedStatuses.filter((status) => {
      if (status.def.kind === "sleepThenEmpower") return false;
      if (status.def.kind === "participationDebuffThenBuff") {
        status.def.remainingParticipatingBattles -= 1;
        if (status.def.remainingParticipatingBattles <= 0) {
          member.permanentAttackBonus += status.def.afterDurationPermanentBuff.attack ?? 0;
          member.permanentHealthBonus += status.def.afterDurationPermanentBuff.health ?? 0;
          return false;
        }
      }
      return true;
    });
  }
  for (const row of Object.values(output.contribution.byUnitId)) {
    if (row.side === "player") next.stats.animalContribution[row.speciesId] = (next.stats.animalContribution[row.speciesId] ?? 0) + row.total;
  }
  next.stats.maxSingleDamage = Math.max(next.stats.maxSingleDamage, output.contribution.maxSingleDamage);
  next.stats.longestSkillChain = Math.max(next.stats.longestSkillChain, output.contribution.longestSkillChain);
  next.stats.mvpSpeciesId = output.contribution.mvpUnitId ? output.contribution.byUnitId[output.contribution.mvpUnitId]?.speciesId : next.stats.mvpSpeciesId;
  next.stats.highlight = output.contribution.highlight;
  next.battleHistory.push({ battleId: pending.battleId, input: pending.input, output });
  next.battleHistory = next.battleHistory.slice(-3);
  if (beforeBadges === 9 && next.badges === 10) {
    next.finalVictoryRecord = {
      battleId: pending.battleId,
      input: pending.input,
      output,
      playerPreBattleSnapshot: pending.input.playerTeam,
    };
  }
  pending.settlementApplied = true;
  next.phase = "battlePlayback";
  return { ok: true, state: next, messageZh: "遭遇已结算。" };
}

export function finishBattleReport(state: ExpeditionState): ExpeditionState {
  const next = structuredClone(state) as ExpeditionState;
  if (next.badges >= 10) {
    next.pendingBattle = null;
    next.phase = "successResolution";
  } else if (next.morale <= 0) {
    next.pendingBattle = null;
    next.phase = "returnResolution";
  } else {
    const leftover = next.camp?.supply ?? 0;
    next.round += 1;
    next.pendingBattle = null;
    return enterCamp(next, leftover);
  }
  return next;
}

export interface SuccessResolutionInput {
  save: AppSave;
  expedition: ExpeditionState;
  adoptedSpeciesId: SpeciesId;
  rewardChoices: readonly RewardChoice[];
  teamName: string;
  createdAtIso: string;
  maxRegisteredTeams?: number;
}

export type SuccessResolutionSavePatch = Pick<AppSave, "activeExpedition" | "collection" | "habitatSeeds" | "unlockedCosmetics" | "registeredTeams">;

export function completeSuccessResolution(input: SuccessResolutionInput): DomainResult<{ savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }> {
  const { save, expedition, adoptedSpeciesId, rewardChoices, teamName, createdAtIso, maxRegisteredTeams = 20 } = input;
  if (expedition.phase !== "successResolution") {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "当前不在成功结算阶段。" };
  }
  if (expedition.badges < 10) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "远征章不足，无法登记成功队伍。" };
  }
  if (expedition.pendingBattle) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "最终战尚未归档，请先完成战斗报告。" };
  }
  const record = expedition.finalVictoryRecord;
  if (!record) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "没有最终胜利战前快照，无法登记。" };
  }
  if (!record.playerPreBattleSnapshot.units.some((unit) => unit.speciesId === adoptedSpeciesId)) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "只能领养最终战前队伍中的动物。" };
  }
  if (rewardChoices.length !== 2) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "请选择两项成功纪念。" };
  }
  const legalRewards = createRewardChoices(expedition, save, expedition.expeditionSeed);
  const legalIds = new Set(legalRewards.map((choice) => choice.id));
  const chosenIds = rewardChoices.map((choice) => choice.id);
  if (new Set(chosenIds).size !== 2) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "两项成功纪念不能重复。" };
  }
  if (!chosenIds.every((id) => legalIds.has(id))) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: "成功纪念选项无效。" };
  }
  const created = createRegisteredTeam(expedition, teamName, save.registeredTeams.length, createdAtIso);
  if (!created.ok) {
    return { ok: false, state: undefined as unknown as { savePatch: SuccessResolutionSavePatch; registeredTeam: RegisteredTeam }, messageZh: created.messageZh };
  }

  let next = structuredClone(save) as AppSave;
  for (const reward of rewardChoices) next = applyRewardChoice(next, reward);
  next.collection[adoptedSpeciesId].seen = true;
  next.collection[adoptedSpeciesId].adopted = true;
  next.registeredTeams = [created.state, ...next.registeredTeams].slice(0, maxRegisteredTeams);
  next.activeExpedition = null;

  return {
    ok: true,
    state: {
      savePatch: {
        activeExpedition: next.activeExpedition,
        collection: next.collection,
        habitatSeeds: next.habitatSeeds,
        unlockedCosmetics: next.unlockedCosmetics,
        registeredTeams: next.registeredTeams,
      },
      registeredTeam: created.state,
    },
    messageZh: "成功队伍已登记。",
  };
}

export function createRegisteredTeam(state: ExpeditionState, name: string, existingCount: number, createdAtIso: string): DomainResult<RegisteredTeam> {
  const record = state.finalVictoryRecord;
  if (!record) return { ok: false, state: undefined as unknown as RegisteredTeam, messageZh: "没有最终胜利战前快照，无法登记。" };
  const fallback = `${REGION_NAME_ZH}探险队 #${existingCount + 1}`;
  return {
    ok: true,
    state: {
      teamId: makeTeamId(state.expeditionSeed, `${state.runId}:${record.battleId}:${existingCount}`),
      name: name.trim() || fallback,
      sourceRunId: state.runId,
      sourceBattleId: record.battleId,
      createdAtIso,
      regionId: REGION_ID,
      badges: 10,
      lineupSnapshot: structuredClone(record.playerPreBattleSnapshot) as typeof record.playerPreBattleSnapshot,
      finalBattleEnvironmentId: record.input.environmentId,
      finalBattleSeed: record.input.seed,
      engineVersion: ENGINE_VERSION,
      contentVersion: CONTENT_VERSION,
      highlight: state.stats.highlight,
    },
    messageZh: "登记队伍已创建。",
  };
}

export function registerTeamFromExpedition(state: ExpeditionState, name: string, existingCount: number, createdAtIso: string): RegisteredTeam {
  const result = createRegisteredTeam(state, name, existingCount, createdAtIso);
  if (!result.ok) throw new Error(result.messageZh);
  return result.state;
}

export function applyAdoption(save: AppSave, speciesId: SpeciesId): AppSave {
  const next = structuredClone(save) as AppSave;
  next.collection[speciesId].seen = true;
  next.collection[speciesId].adopted = true;
  return next;
}

export function teamSummary(state: ExpeditionState): string {
  return presentMembers(state.team).map((member) => `${ANIMAL_BY_ID[member.speciesId].nameZh} L${member.bondXp >= 6 ? 3 : member.bondXp >= 3 ? 2 : 1}`).join(" / ") || "暂无队伍";
}

export function cloneExpeditionWithSeen(save: AppSave, state: ExpeditionState): AppSave {
  const next = structuredClone(save) as AppSave;
  for (const member of [...presentMembers(state.team), ...state.reserve]) next.collection[member.speciesId].seen = true;
  for (const slot of state.camp?.animalSlots ?? []) if (slot.offer) next.collection[slot.offer.speciesId].seen = true;
  return next;
}

export function snapshotForCurrentTeam(state: ExpeditionState) {
  return toTeamSnapshot(state.team);
}
