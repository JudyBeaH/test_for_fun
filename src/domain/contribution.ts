import type { BattleEvent, BattleUnit, ContributionSummary, Side } from "./types";

export function emptyContribution(units: readonly BattleUnit[]): ContributionSummary {
  const byUnitId: ContributionSummary["byUnitId"] = {};
  for (const unit of units) {
    byUnitId[unit.unitId] = {
      speciesId: unit.speciesId,
      side: unit.side,
      damageDealt: 0,
      damageBlocked: 0,
      positiveStatsGranted: 0,
      enemyAttackReduced: 0,
      abilityTriggers: 0,
      usefulMoves: 0,
      total: 0,
    };
  }
  return { byUnitId, maxSingleDamage: 0, longestSkillChain: 0, highlight: "这场遭遇留下了新的观察记录。" };
}

export function recomputeTotals(summary: ContributionSummary): ContributionSummary {
  let bestId: string | undefined;
  let best = -1;
  for (const [unitId, row] of Object.entries(summary.byUnitId)) {
    row.total = row.damageDealt + row.damageBlocked + 0.5 * row.positiveStatsGranted + 0.5 * row.enemyAttackReduced + row.abilityTriggers + 0.25 * row.usefulMoves;
    if (row.side === "player" && row.total > best) {
      best = row.total;
      bestId = unitId;
    }
  }
  summary.mvpUnitId = bestId;
  return summary;
}

export function longestAbilityChain(events: readonly BattleEvent[]): number {
  let longest = 0;
  let current = 0;
  for (const event of events) {
    if (event.type === "abilityTriggered" || event.type === "equipmentTriggered" || event.type === "statusConsumed") {
      current += 1;
      longest = Math.max(longest, current);
    } else if (event.type === "attackExchange") {
      current = 0;
    }
  }
  return longest;
}

export function sideResult(result: "win" | "loss" | "draw", side: Side): string {
  if (result === "draw") return "平局";
  return (result === "win" && side === "player") || (result === "loss" && side === "opponent") ? "胜利" : "失利";
}
