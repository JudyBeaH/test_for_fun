import { describe, expect, it } from "vitest";
import { ANIMALS } from "../src/content/animals";
import { CAMP_LEVELS, campLevelRowForRound, campLevelStateForRound } from "../src/content/campLevels";
import { CONTENT_VERSION } from "../src/content/constants";
import { validateContent } from "../src/content/validation";
import { applyCampCommand, computeCampRules, enterCamp } from "../src/domain/campEngine";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { TeamMember } from "../src/domain/types";

function campAtRound(round: number) {
  const state = createExpedition(6060);
  state.round = round;
  return enterCamp(state);
}

function member(instanceId: string, bondXp: number): TeamMember {
  return { instanceId, speciesId: "frog", bondXp, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

describe("P6A camp level table", () => {
  it("uses the shared boundary table for rounds, tiers, offer slots, and next upgrades", () => {
    const cases = [
      { round: 1, tier: 1, slots: 3, next: 2, just: true },
      { round: 2, tier: 2, slots: 3, next: 4, just: true },
      { round: 3, tier: 2, slots: 3, next: 4, just: false },
      { round: 4, tier: 3, slots: 4, next: 6, just: true },
      { round: 5, tier: 3, slots: 4, next: 6, just: false },
      { round: 6, tier: 4, slots: 4, next: 8, just: true },
      { round: 7, tier: 4, slots: 4, next: 8, just: false },
      { round: 8, tier: 5, slots: 5, next: null, just: true },
      { round: 9, tier: 5, slots: 5, next: null, just: false },
    ] as const;

    for (const item of cases) {
      const row = campLevelRowForRound(item.round);
      const state = campLevelStateForRound(item.round);
      const expedition = campAtRound(item.round);
      const rules = computeCampRules(expedition);
      expect(row.tier).toBe(item.tier);
      expect(row.animalOfferSlots).toBe(item.slots);
      expect(state).toEqual({ currentTier: item.tier, nextUpgradeRound: item.next, justUpgraded: item.just });
      expect(rules.currentTier).toBe(item.tier);
      expect(rules.nextUpgradeRound).toBe(item.next);
      expect(rules.justUpgraded).toBe(item.just);
      expect(expedition.camp!.campLevel).toBe(item.tier);
      expect(expedition.camp!.currentTier).toBe(item.tier);
      expect(expedition.camp!.nextUpgradeRound).toBe(item.next);
      expect(expedition.camp!.justUpgraded).toBe(item.just);
    }
  });

  it("locks animal offer slots above the current table limit without rolling offers", () => {
    for (const round of [1, 2, 4, 6, 8]) {
      const expedition = campAtRound(round);
      const slots = campLevelRowForRound(round).animalOfferSlots;
      expedition.camp!.animalOffers.forEach((slot, index) => {
        expect(slot.unlocked).toBe(index < slots);
        expect(Boolean(slot.offer)).toBe(index < slots);
        if (index >= slots) expect(slot.offer).toBeNull();
      });
    }
  });

  it("validates Tier 5 content infrastructure and contentVersion", () => {
    expect(CAMP_LEVELS.map((row) => row.tier)).toEqual([1, 2, 3, 4, 5]);
    expect(ANIMALS).toHaveLength(25);
    expect(ANIMALS.some((animal) => animal.id === "sparrow")).toBe(true);
    expect(ANIMALS.some((animal) => animal.id === "white_headed_bulbul")).toBe(true);
    expect(ANIMALS.some((animal) => animal.tier === 5)).toBe(true);
    expect(validateContent(CONTENT_VERSION)).toEqual({ ok: true, errors: [] });
    expect(validateContent("old-content").ok).toBe(false);
  });

  it("keeps upgrade discoveries selectable with shipped Tier 5 content", () => {
    const state = campAtRound(8);
    const source = member("source", 3);
    const target = member("target", 3);
    state.unitsById[source.instanceId] = source;
    state.unitsById[target.instanceId] = target;
    state.formation[0] = source.instanceId;
    state.formation[1] = target.instanceId;

    const result = applyCampCommand(state, { type: "mergeUnits", sourceUnitId: source.instanceId, targetUnitId: target.instanceId });

    expect(result.ok, result.messageZh).toBe(true);
    expect(result.state.state.pendingDiscoveries).toHaveLength(1);
    expect(result.state.state.pendingDiscoveries[0].targetTier).toBe(5);
    expect(result.state.state.pendingDiscoveries[0].candidates.length).toBeGreaterThan(0);
    expect(result.state.state.pendingDiscoveries[0].candidates).toContain("black_muntjac");
  });
});
