import { ANIMAL_BY_ID } from "../content/animals";
import type { ExpeditionState, ItemDef, ItemTargetCandidate, ItemTargetPreview, ItemTargetSpec, TeamMember, UnitId, UnitSlotRef } from "./types";

function unitSlot(state: ExpeditionState, unitId: UnitId): UnitSlotRef | null {
  const formation = state.formation.findIndex((id) => id === unitId);
  if (formation >= 0) return { zone: "formation", slot: formation as 0 | 1 | 2 | 3 | 4 };
  const reserve = state.reserve.findIndex((id) => id === unitId);
  if (reserve >= 0) return { zone: "reserve", slot: reserve as 0 | 1 | 2 };
  return null;
}

function unitInAllowedZone(state: ExpeditionState, unitId: UnitId, spec: ItemTargetSpec): boolean {
  const slot = unitSlot(state, unitId);
  return Boolean(slot && spec.allowedZones.includes(slot.zone));
}

function unitsInAllowedZones(state: ExpeditionState, spec: ItemTargetSpec): TeamMember[] {
  const ids: UnitId[] = [];
  if (spec.allowedZones.includes("formation")) ids.push(...state.formation.filter((id): id is UnitId => Boolean(id)));
  if (spec.allowedZones.includes("reserve")) ids.push(...state.reserve.filter((id): id is UnitId => Boolean(id)));
  return ids.flatMap((unitId) => state.unitsById[unitId] ? [state.unitsById[unitId]] : []);
}

function habitatNameZh(habitat: string): string {
  if (habitat === "water") return "水域";
  if (habitat === "land") return "陆地";
  if (habitat === "air") return "空中";
  return habitat;
}

function okPreview(item: ItemDef, targetUnitIds: UnitId[], summaryZh: string, replacesEquipment: boolean, replacedEquipmentUnitIds: UnitId[]): ItemTargetPreview {
  return {
    ok: true,
    itemId: item.id,
    usage: item.usage,
    targetSpec: item.targetSpec,
    targetUnitIds,
    messageZh: "目标有效。",
    summaryZh,
    replacesEquipment,
    replacedEquipmentUnitIds,
  };
}

function invalidPreview(item: ItemDef, messageZh: string): ItemTargetPreview {
  return {
    ok: false,
    itemId: item.id,
    usage: item.usage,
    targetSpec: item.targetSpec,
    targetUnitIds: [],
    messageZh,
    summaryZh: messageZh,
    replacesEquipment: false,
    replacedEquipmentUnitIds: [],
  };
}

function effectSummary(item: ItemDef, targetCount: number): string {
  const parts = item.effects.map((effect) => {
    if (effect.kind === "modifyPermanentAttack") return `永久攻击 ${effect.amount > 0 ? "+" : ""}${effect.amount}`;
    if (effect.kind === "modifyPermanentHealth") return `永久体力 ${effect.amount > 0 ? "+" : ""}${effect.amount}`;
    if (effect.kind === "modifyBondXp") return `默契 ${effect.amount > 0 ? "+" : ""}${effect.amount}`;
    if (effect.kind === "attachStatus") return "附加临时状态";
    if (effect.kind === "modifyInitialAttack") return `装备初始攻击 ${effect.amount > 0 ? "+" : ""}${effect.amount}`;
    if (effect.kind === "modifyInitialHealth") return `装备初始体力 ${effect.amount > 0 ? "+" : ""}${effect.amount}`;
    if (effect.kind === "battleStartDamage") return `战斗开始伤害 ${effect.amount}`;
    if (effect.kind === "afterDurationPermanentBuff") return "持续结束后永久强化";
    return "效果预览";
  });
  return `${item.nameZh} 将影响 ${targetCount} 个目标：${parts.join("，")}。`;
}

function candidateUnit(state: ExpeditionState, item: ItemDef, candidateTarget: ItemTargetCandidate | null | undefined): TeamMember | ItemTargetPreview {
  if (!candidateTarget || candidateTarget.kind !== "unit") return invalidPreview(item, "请选择一个动物目标。");
  const unit = state.unitsById[candidateTarget.unitId];
  if (!unit || !unitSlot(state, candidateTarget.unitId)) return invalidPreview(item, "目标动物不存在。");
  return unit;
}

export function resolveItemTargets(state: ExpeditionState, item: ItemDef, candidateTarget?: ItemTargetCandidate | null): ItemTargetPreview {
  if (item.kind !== item.usage) return invalidPreview(item, "道具用途配置不一致。");
  if (item.usage === "equipment" && item.targetSpec.kind !== "singleUnit") return invalidPreview(item, "装备只能选择单个动物。");

  if (item.targetSpec.kind === "none") {
    if (candidateTarget && candidateTarget.kind !== "none") return invalidPreview(item, "这个道具不需要选择目标。");
    return okPreview(item, [], `${item.nameZh} 不需要目标。`, false, []);
  }

  if (item.targetSpec.kind === "singleUnit") {
    const target = candidateUnit(state, item, candidateTarget);
    if ("ok" in target) return target;
    if (!unitInAllowedZone(state, target.instanceId, item.targetSpec)) return invalidPreview(item, "目标不在允许区域。");
    const replacesEquipment = item.usage === "equipment" && Boolean(target.equipment);
    return okPreview(item, [target.instanceId], effectSummary(item, 1), replacesEquipment, replacesEquipment ? [target.instanceId] : []);
  }

  if (item.targetSpec.kind === "group") {
    const spec = item.targetSpec;
    if (candidateTarget?.kind === "unit") {
      const target = candidateUnit(state, item, candidateTarget);
      if ("ok" in target) return target;
      if (!unitInAllowedZone(state, target.instanceId, spec)) return invalidPreview(item, "目标不在允许区域。");
      if (!ANIMAL_BY_ID[target.speciesId].habitats.includes(spec.selector.habitat)) return invalidPreview(item, `目标动物不属于${habitatNameZh(spec.selector.habitat)}族群。`);
    }
    const targets = unitsInAllowedZones(state, spec).filter((unit) => ANIMAL_BY_ID[unit.speciesId].habitats.includes(spec.selector.habitat));
    if (targets.length === 0) return invalidPreview(item, `没有符合${habitatNameZh(spec.selector.habitat)}族群的目标。`);
    return okPreview(item, targets.map((unit) => unit.instanceId), effectSummary(item, targets.length), false, []);
  }

  if (item.targetSpec.kind === "allOwned") {
    if (candidateTarget?.kind === "unit") return invalidPreview(item, "请投放到整队目标区域。");
    const targets = unitsInAllowedZones(state, item.targetSpec);
    if (targets.length === 0) return invalidPreview(item, "没有符合允许区域的目标。");
    return okPreview(item, targets.map((unit) => unit.instanceId), effectSummary(item, targets.length), false, []);
  }

  return invalidPreview(item, "未知目标规则。");
}
