import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createExpedition, finishBattleReport, prepareBattle, resolvePreparedBattle } from "../domain/expeditionEngine";
import { createEmptySave } from "../domain/saveSchema";
import { createRewardChoices } from "../domain/rewardEngine";
import { allOwnedMembers, formationMembers, levelFromBondXp, reserveMembers } from "../domain/campEngine";
import type { TeamMember } from "../domain/types";
import { createAccumulator, type SimReport } from "./report";
import { createAutoStats, runAutoCamp } from "./autoPlayer";

function presentMembers(members: readonly (TeamMember | null | undefined)[]): TeamMember[] {
  return members.filter((member): member is TeamMember => Boolean(member));
}

export function runBatch(runs: number, seed: number): SimReport {
  const report = createAccumulator(runs, seed);
  let success = 0;
  let totalBadges = 0;
  let totalRounds = 0;
  let totalEvents = 0;
  let totalBattles = 0;
  let draws = 0;
  for (let i = 0; i < runs; i += 1) {
    let expedition = createExpedition(seed + i * 9973);
    const seenThisRun = new Set<string>();
    const recruitedThisRun = new Set<string>();
    const reserveThisRun = new Set<string>();
    const winsWithSpecies = new Map<string, number>();
    const battlesWithSpecies = new Map<string, number>();
    const autoStats = createAutoStats();
    while (!["successResolution", "returnResolution", "completed"].includes(expedition.phase) && expedition.round < 40) {
      for (const slot of expedition.camp?.animalOffers ?? []) if (slot.offer) seenThisRun.add(slot.offer.speciesId);
      for (const slot of expedition.camp?.itemOffers ?? []) if (slot.offer) report.items[slot.offer.itemId].appearanceRate += 1;
      expedition = runAutoCamp(expedition, autoStats);
      for (const member of presentMembers(formationMembers(expedition))) recruitedThisRun.add(member.speciesId);
      for (const member of presentMembers(reserveMembers(expedition))) reserveThisRun.add(member.speciesId);
      const prepared = prepareBattle(expedition);
      if (!prepared.ok) break;
      const resolved = resolvePreparedBattle(prepared.state);
      if (!resolved.ok) break;
      expedition = resolved.state;
      const battle = expedition.pendingBattle?.output;
      const input = expedition.pendingBattle?.input;
      if (!battle || !input) break;
      totalEvents += battle.events.length;
      totalBattles += 1;
      if (battle.result === "draw") draws += 1;
      if (battle.diagnostics.length > 0) report.safetyCapCount += 1;
      report.environments[input.environmentId].battles += 1;
      if (battle.result === "win") report.environments[input.environmentId].winRate += 1;
      for (const event of battle.events) {
        if (event.messageZh.includes("褪黑素效果解除")) report.melatonin.wakes += 1;
        if (event.messageZh.includes("强化攻击")) report.melatonin.empoweredHits += 1;
      }
      for (const member of presentMembers(formationMembers(expedition))) {
        battlesWithSpecies.set(member.speciesId, (battlesWithSpecies.get(member.speciesId) ?? 0) + 1);
        if (battle.result === "win") winsWithSpecies.set(member.speciesId, (winsWithSpecies.get(member.speciesId) ?? 0) + 1);
      }
      expedition = finishBattleReport(expedition);
    }
    if (expedition.phase === "successResolution") success += 1;
    totalBadges += expedition.badges;
    totalRounds += expedition.round;
    report.merges += expedition.stats.merges;
    report.upgradeDiscoveries += expedition.stats.upgradeDiscoveries;
    report.averageCampActions += autoStats.campActions;
    report.averageRemainingSupply += expedition.camp?.supply ?? 0;
    for (const [reason, count] of Object.entries(autoStats.invalidReasons)) report.invalidActionReasons[reason] = (report.invalidActionReasons[reason] ?? 0) + count;
    for (const [id, count] of Object.entries(autoStats.itemPurchases)) report.items[id as keyof typeof report.items].purchaseRate += count;
    for (const [id, count] of Object.entries(autoStats.itemUses)) {
      report.items[id as keyof typeof report.items].useRate += count;
      if (id === "melatonin") report.melatonin.uses += count;
      if (id === "pinecone_sling") report.items.pinecone_sling.equipRate += count;
    }
    const choices = createRewardChoices(expedition, createEmptySave(), seed + i);
    report.rewardDistribution[choices[i % choices.length].category] += 1;
    for (const species of Object.keys(report.species) as Array<keyof typeof report.species>) {
      if (seenThisRun.has(species)) report.species[species].seenRate += 1;
      if (recruitedThisRun.has(species)) report.species[species].recruitRate += 1;
      if (reserveThisRun.has(species)) report.species[species].reserveRate += 1;
      const final = allOwnedMembers(expedition).find((member) => member.speciesId === species);
      if (final) report.species[species].averageFinalLevel += levelFromBondXp(final.bondXp);
      report.species[species].averageContribution += expedition.stats.animalContribution[species] ?? 0;
      const battles = battlesWithSpecies.get(species) ?? 0;
      if (battles > 0) report.species[species].teamWinRate += (winsWithSpecies.get(species) ?? 0) / battles;
    }
  }
  report.successRate = success / runs;
  report.averageBadges = totalBadges / runs;
  report.averageRounds = totalRounds / runs;
  report.averageBattleEvents = totalEvents / Math.max(1, totalBattles);
  report.drawRate = draws / Math.max(1, totalBattles);
  report.averageCampActions /= runs;
  report.averageRemainingSupply /= runs;
  for (const species of Object.keys(report.species) as Array<keyof typeof report.species>) {
    report.species[species].seenRate /= runs;
    report.species[species].recruitRate /= runs;
    report.species[species].reserveRate /= runs;
    report.species[species].averageFinalLevel /= runs;
    report.species[species].teamWinRate /= runs;
    report.species[species].averageContribution /= runs;
  }
  for (const item of Object.keys(report.items) as Array<keyof typeof report.items>) {
    report.items[item].appearanceRate /= runs;
    report.items[item].purchaseRate /= runs;
    report.items[item].useRate /= runs;
    report.items[item].equipRate /= runs;
  }
  for (const env of Object.values(report.environments)) env.winRate = env.battles > 0 ? env.winRate / env.battles : 0;
  return report;
}

function parseArgs(argv: string[]): { runs: number; seed: number } {
  const runsIndex = argv.indexOf("--runs");
  const seedIndex = argv.indexOf("--seed");
  return {
    runs: runsIndex >= 0 ? Number(argv[runsIndex + 1]) : 1000,
    seed: seedIndex >= 0 ? Number(argv[seedIndex + 1]) : 20260620,
  };
}

if (import.meta.url.endsWith(process.argv[1] ?? "")) {
  const { runs, seed } = parseArgs(process.argv.slice(2));
  const report = runBatch(runs, seed);
  const path = "artifacts/sim-report.json";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log("Project Wildtrail v0.3 sim");
  console.log(`runs=${runs} seed=${seed} content=${report.contentVersion} animals=${report.animalCount}`);
  console.log(`tierCounts=T1:${report.animalTierCounts[1]} T2:${report.animalTierCounts[2]} T3:${report.animalTierCounts[3]} T4:${report.animalTierCounts[4]} T5:${report.animalTierCounts[5]}`);
  console.log(`successRate=${(report.successRate * 100).toFixed(1)}% averageBadges=${report.averageBadges.toFixed(2)} averageRounds=${report.averageRounds.toFixed(2)}`);
  console.log(`avgEvents=${report.averageBattleEvents.toFixed(1)} drawRate=${(report.drawRate * 100).toFixed(1)}% safetyCaps=${report.safetyCapCount}`);
  console.log(`merges=${report.merges} upgradeDiscoveries=${report.upgradeDiscoveries} melatoninWakes=${report.melatonin.wakes}`);
  console.log(`report=${path}`);
}
