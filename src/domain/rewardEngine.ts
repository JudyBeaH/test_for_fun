import { ANIMALS, ANIMAL_BY_ID } from "../content/animals";
import type { AppSave, ExpeditionState, RewardChoice } from "./types";
import { createRng } from "./rng";
import { allOwnedMembers } from "./campEngine";

export function createRewardChoices(state: ExpeditionState, save: AppSave, seed: number): RewardChoice[] {
  const rng = createRng(seed ^ state.expeditionSeed ^ state.round);
  const owned = allOwnedMembers(state);
  const companion = owned.length > 0 ? rng.pick(owned).speciesId : "hedgehog";
  const unfinished = ANIMALS.map((animal) => animal.id).filter((id) => !save.collection[id].journalUnlocked);
  const trace = unfinished.length > 0 ? rng.pick(unfinished) : rng.pick(ANIMALS).id;
  return [
    { id: `mark_${companion}`, category: "companionMark", speciesId: companion, titleZh: "同行印记", descriptionZh: `为${ANIMAL_BY_ID[companion].nameZh}留下一枚同行印记。` },
    { id: `trace_${trace}`, category: "unknownTrace", speciesId: trace, titleZh: "未知踪迹", descriptionZh: `记录${ANIMAL_BY_ID[trace].nameZh}的踪迹进度。` },
    { id: "habitat_seed", category: "habitatSeed", titleZh: "栖息地种子", descriptionZh: "收下一枚只用于主题与贴纸的栖息地种子。" },
  ];
}

export function applyRewardChoice(save: AppSave, choice: RewardChoice): AppSave {
  const next = structuredClone(save) as AppSave;
  if (choice.category === "companionMark" && choice.speciesId) {
    const entry = next.collection[choice.speciesId];
    entry.seen = true;
    entry.memory += 1;
  }
  if (choice.category === "unknownTrace" && choice.speciesId) {
    const entry = next.collection[choice.speciesId];
    entry.traceProgress += 1;
    if (entry.traceProgress >= 3) entry.journalUnlocked = true;
  }
  if (choice.category === "habitatSeed") {
    next.habitatSeeds += 1;
    if (next.habitatSeeds >= 5 && !next.unlockedCosmetics.includes("seed_sticker_5")) next.unlockedCosmetics.push("seed_sticker_5");
    if (next.habitatSeeds >= 10 && !next.unlockedCosmetics.includes("seed_theme_10")) next.unlockedCosmetics.push("seed_theme_10");
  }
  return next;
}

export function applyChallengeReward(save: AppSave, teamId: string, result: "win" | "loss" | "draw", challengedAtIso: string): AppSave {
  const next = structuredClone(save) as AppSave;
  const first = !next.challengedTeamIds.includes(teamId);
  if (first) {
    next.challengedTeamIds.push(teamId);
    next.wildFruit += 1;
    if (next.wildFruit >= 5 && !next.unlockedCosmetics.includes("fruit_sticker_5")) next.unlockedCosmetics.push("fruit_sticker_5");
    if (next.wildFruit >= 10 && !next.unlockedCosmetics.includes("fruit_sticker_10")) next.unlockedCosmetics.push("fruit_sticker_10");
  }
  next.challengeHistory.unshift({ teamId, challengedAtIso, result, earnedWildFruit: first, honorStamp: result === "win" });
  return next;
}
