import type { BattleSlot, BattleUnit, Side } from "./types";

export const BATTLE_SLOTS = ["L4", "L3", "L2", "L1", "L0", "R0", "R1", "R2", "R3", "R4"] as const satisfies readonly BattleSlot[];
const PLAYER_SLOTS = ["L0", "L1", "L2", "L3", "L4"] as const satisfies readonly BattleSlot[];
const OPPONENT_SLOTS = ["R0", "R1", "R2", "R3", "R4"] as const satisfies readonly BattleSlot[];

export interface BoardMoveRecord {
  unit: BattleUnit;
  beforeSlot: BattleSlot;
  afterSlot: BattleSlot;
  beforePosition: number;
  afterPosition: number;
  fromOrder: number;
  toOrder: number;
}

export interface BoardMutationResult {
  ok: boolean;
  message: string;
  moved: BoardMoveRecord[];
}

export interface BoardMutationOptions {
  experimentalCrossSideSwap?: boolean;
}

export function slotForSidePosition(side: Side, position: number): BattleSlot {
  const clamped = Math.max(0, Math.min(4, position));
  return side === "player" ? PLAYER_SLOTS[clamped] : OPPONENT_SLOTS[clamped];
}

export function combatSideForSlot(slot: BattleSlot): Side {
  return slot.startsWith("L") ? "player" : "opponent";
}

export function positionForSlot(slot: BattleSlot): number {
  return Number(slot.slice(1));
}

function sideSlots(side: Side): readonly BattleSlot[] {
  return side === "player" ? PLAYER_SLOTS : OPPONENT_SLOTS;
}

function syncDerivedPosition(unit: BattleUnit): void {
  unit.side = combatSideForSlot(unit.slot);
  unit.position = positionForSlot(unit.slot);
}

function active(units: readonly BattleUnit[]): BattleUnit[] {
  return units.filter((unit) => !unit.retreated).sort((a, b) => positionForSlot(a.slot) - positionForSlot(b.slot));
}

export class BoardMutationService {
  constructor(private readonly units: BattleUnit[], private readonly options: BoardMutationOptions = {}) {}

  validateOccupancy(): BoardMutationResult {
    const occupied = new Map<BattleSlot, BattleUnit>();
    for (const unit of this.units) {
      syncDerivedPosition(unit);
      if (unit.retreated) continue;
      const current = occupied.get(unit.slot);
      if (current) return { ok: false, message: `${unit.unitId} and ${current.unitId} both occupy ${unit.slot}`, moved: [] };
      occupied.set(unit.slot, unit);
    }
    return { ok: true, message: "ok", moved: [] };
  }

  activeSideUnits(side: Side): BattleUnit[] {
    return active(this.units.filter((unit) => combatSideForSlot(unit.slot) === side));
  }

  activeSideSlots(side: Side): BattleSlot[] {
    return this.activeSideUnits(side).map((unit) => unit.slot);
  }

  moveWithinSide(unitId: string, offset: number): BoardMutationResult {
    const source = this.units.find((unit) => unit.unitId === unitId);
    if (!source || source.retreated) return { ok: false, message: "source unavailable", moved: [] };
    const side = combatSideForSlot(source.slot);
    const beforeOrder = this.activeSideUnits(side);
    const from = beforeOrder.findIndex((unit) => unit.unitId === unitId);
    const to = Math.max(0, Math.min(beforeOrder.length - 1, from + offset));
    if (from < 0 || to === from) return { ok: false, message: "order unchanged", moved: [] };

    const afterIds = beforeOrder.map((unit) => unit.unitId);
    const [sourceId] = afterIds.splice(from, 1);
    afterIds.splice(to, 0, sourceId);

    const beforeSlots = beforeOrder.map((unit) => unit.slot);
    const beforeById = new Map(beforeOrder.map((unit, index) => [unit.unitId, { unit, index, slot: unit.slot, position: unit.position }]));
    for (const [index, movedUnitId] of afterIds.entries()) {
      const unit = beforeById.get(movedUnitId)?.unit;
      if (unit) {
        unit.slot = beforeSlots[index];
        syncDerivedPosition(unit);
      }
    }

    const moved = afterIds.flatMap((unitId, index): BoardMoveRecord[] => {
      const before = beforeById.get(unitId);
      if (!before || before.slot === before.unit.slot) return [];
      return [{
        unit: before.unit,
        beforeSlot: before.slot,
        afterSlot: before.unit.slot,
        beforePosition: before.position,
        afterPosition: before.unit.position,
        fromOrder: before.index,
        toOrder: index,
      }];
    });
    const validation = this.validateOccupancy();
    if (!validation.ok) return validation;
    return { ok: true, message: "ok", moved };
  }

  swap(a: BattleSlot, b: BattleSlot): BoardMutationResult {
    if (!this.options.experimentalCrossSideSwap && combatSideForSlot(a) !== combatSideForSlot(b)) return { ok: false, message: "cross-side swap disabled", moved: [] };
    const first = this.units.find((unit) => !unit.retreated && unit.slot === a);
    const second = this.units.find((unit) => !unit.retreated && unit.slot === b);
    if (!first || !second) return { ok: false, message: "swap requires two occupied slots", moved: [] };
    const moved = [first, second].map((unit, index): BoardMoveRecord => {
      const beforeSlot = unit.slot;
      const beforePosition = unit.position;
      unit.slot = index === 0 ? b : a;
      syncDerivedPosition(unit);
      return { unit, beforeSlot, afterSlot: unit.slot, beforePosition, afterPosition: unit.position, fromOrder: beforePosition, toOrder: unit.position };
    });
    const validation = this.validateOccupancy();
    if (!validation.ok) return validation;
    return { ok: true, message: "ok", moved };
  }

  move(unitId: string, toSlot: BattleSlot): BoardMutationResult {
    const unit = this.units.find((item) => item.unitId === unitId);
    if (!unit || unit.retreated) return { ok: false, message: "source unavailable", moved: [] };
    if (combatSideForSlot(unit.slot) !== combatSideForSlot(toSlot)) return { ok: false, message: "cross-side move disabled", moved: [] };
    if (this.units.some((item) => !item.retreated && item.unitId !== unitId && item.slot === toSlot)) return { ok: false, message: "target occupied", moved: [] };
    const beforeSlot = unit.slot;
    const beforePosition = unit.position;
    unit.slot = toSlot;
    syncDerivedPosition(unit);
    const validation = this.validateOccupancy();
    if (!validation.ok) return validation;
    return {
      ok: true,
      message: "ok",
      moved: beforeSlot === toSlot ? [] : [{ unit, beforeSlot, afterSlot: unit.slot, beforePosition, afterPosition: unit.position, fromOrder: beforePosition, toOrder: unit.position }],
    };
  }

  push(unitId: string, offset = 1): BoardMutationResult {
    return this.moveWithinSide(unitId, Math.abs(offset));
  }

  pull(unitId: string, offset = 1): BoardMutationResult {
    return this.moveWithinSide(unitId, -Math.abs(offset));
  }

  compact(side: Side): BoardMutationResult {
    const units = this.activeSideUnits(side);
    const slots = sideSlots(side);
    const moved: BoardMoveRecord[] = [];
    for (const [index, unit] of units.entries()) {
      const beforeSlot = unit.slot;
      const beforePosition = unit.position;
      const afterSlot = slots[index];
      unit.slot = afterSlot;
      syncDerivedPosition(unit);
      if (beforeSlot !== afterSlot) {
        moved.push({ unit, beforeSlot, afterSlot, beforePosition, afterPosition: unit.position, fromOrder: beforePosition, toOrder: unit.position });
      }
    }
    const validation = this.validateOccupancy();
    if (!validation.ok) return validation;
    return { ok: true, message: "ok", moved };
  }
}
