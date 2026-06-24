import { describe, expect, it } from "vitest";
import { ITEM_BY_ID } from "../src/content/items";
import { resolveItemTargets } from "../src/domain/itemTargeting";
import { createExpedition } from "../src/domain/expeditionEngine";
import type { ExpeditionState, ItemDef, SpeciesId, TeamMember, UnitSlotRef } from "../src/domain/types";

function testMember(instanceId: string, speciesId: SpeciesId): TeamMember {
  return { instanceId, speciesId, bondXp: 1, permanentAttackBonus: 0, permanentHealthBonus: 0, equipment: null, timedStatuses: [], acquiredAtRound: 1, participatedRounds: 0 };
}

function placeUnit(state: ExpeditionState, member: TeamMember, ref: UnitSlotRef): void {
  state.unitsById[member.instanceId] = member;
  if (ref.zone === "formation") state.formation[ref.slot] = member.instanceId;
  else state.reserve[ref.slot] = member.instanceId;
}

function targetState(): ExpeditionState {
  const state = createExpedition(7401);
  state.camp!.supply = 9;
  placeUnit(state, testMember("frog_f", "frog"), { zone: "formation", slot: 0 });
  placeUnit(state, testMember("hare_f", "hare"), { zone: "formation", slot: 1 });
  placeUnit(state, testMember("mussel_r", "mussel"), { zone: "reserve", slot: 0 });
  placeUnit(state, testMember("otter_r", "otter"), { zone: "reserve", slot: 1 });
  state.unitsById.hare_f.equipment = { instanceId: "old_sling", itemId: "pinecone_sling" };
  state.itemsById.stored = { instanceId: "stored", itemId: "red_berry" };
  state.inventory[0] = "stored";
  return state;
}

describe("P4A item target preview", () => {
  it("previews single-unit food without mutating resources or units", () => {
    const state = targetState();
    const before = JSON.stringify(state);

    const preview = resolveItemTargets(state, ITEM_BY_ID.red_berry, { kind: "unit", unitId: "frog_f" });

    expect(preview.ok).toBe(true);
    expect(preview.targetUnitIds).toEqual(["frog_f"]);
    expect(preview.summaryZh).toContain("永久攻击 +1");
    expect(preview.summaryZh).toContain("永久体力 +1");
    expect(JSON.stringify(state)).toBe(before);
    expect(state.camp!.supply).toBe(9);
    expect(state.inventory[0]).toBe("stored");
  });

  it("previews habitat-group food by allowed zones and reports readable invalid reasons", () => {
    const state = targetState();

    const preview = resolveItemTargets(state, ITEM_BY_ID.river_moss, { kind: "unit", unitId: "frog_f" });
    expect(preview.ok).toBe(true);
    expect(preview.targetUnitIds).toEqual(["frog_f", "mussel_r", "otter_r"]);

    const invalid = resolveItemTargets(state, ITEM_BY_ID.river_moss, { kind: "unit", unitId: "hare_f" });
    expect(invalid.ok).toBe(false);
    expect(invalid.targetUnitIds).toEqual([]);
    expect(invalid.messageZh).toBe("目标动物不属于水域族群。");
  });

  it("previews all-formation food without affecting reserve units", () => {
    const state = targetState();

    const preview = resolveItemTargets(state, ITEM_BY_ID.team_lotus_seed, { kind: "allOwned" });

    expect(preview.ok).toBe(true);
    expect(preview.targetUnitIds).toEqual(["frog_f", "hare_f"]);
    expect(preview.summaryZh).toContain("影响 2 个目标");

    const invalid = resolveItemTargets(state, ITEM_BY_ID.team_lotus_seed, { kind: "unit", unitId: "frog_f" });
    expect(invalid.ok).toBe(false);
    expect(invalid.messageZh).toBe("请投放到整队目标区域。");
  });

  it("previews equipment replacement explicitly", () => {
    const state = targetState();

    const replacing = resolveItemTargets(state, ITEM_BY_ID.pinecone_sling, { kind: "unit", unitId: "hare_f" });
    expect(replacing.ok).toBe(true);
    expect(replacing.usage).toBe("equipment");
    expect(replacing.targetUnitIds).toEqual(["hare_f"]);
    expect(replacing.replacesEquipment).toBe(true);
    expect(replacing.replacedEquipmentUnitIds).toEqual(["hare_f"]);

    const fresh = resolveItemTargets(state, ITEM_BY_ID.pinecone_sling, { kind: "unit", unitId: "frog_f" });
    expect(fresh.ok).toBe(true);
    expect(fresh.replacesEquipment).toBe(false);
    expect(fresh.replacedEquipmentUnitIds).toEqual([]);
  });

  it("previews melatonin as a single target status item", () => {
    const state = targetState();

    const preview = resolveItemTargets(state, ITEM_BY_ID.melatonin, { kind: "unit", unitId: "otter_r" });

    expect(preview.ok).toBe(true);
    expect(preview.usage).toBe("food");
    expect(preview.targetUnitIds).toEqual(["otter_r"]);
    expect(preview.summaryZh).toContain("附加临时状态");
  });

  it("supports explicit none-target specs", () => {
    const state = targetState();
    const noneItem: ItemDef = {
      id: "red_berry",
      nameZh: "测试无目标物品",
      kind: "food",
      usage: "food",
      price: 0,
      visual: { emoji: "", fallbackGlyph: "测" },
      targetSpec: { kind: "none", allowedZones: [] },
      targetScope: { kind: "singleUnit" },
      descriptionZh: "测试用。",
      effects: [],
    };

    const preview = resolveItemTargets(state, noneItem, { kind: "none" });
    expect(preview.ok).toBe(true);
    expect(preview.targetUnitIds).toEqual([]);

    const invalid = resolveItemTargets(state, noneItem, { kind: "unit", unitId: "frog_f" });
    expect(invalid.ok).toBe(false);
    expect(invalid.messageZh).toBe("这个道具不需要选择目标。");
  });
});
