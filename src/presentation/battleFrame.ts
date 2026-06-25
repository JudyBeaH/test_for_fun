import { slotForSidePosition } from "../domain/battleBoard";
import type { BattleEvent, BattleSlot, Side, SpeciesId, TeamSnapshotUnit } from "../domain/types";

export type BattleFrameUnit = {
  unitId: string;
  side: Side;
  snapshot: TeamSnapshotUnit;
  slot: BattleSlot;
  attack: number;
  health: number;
  maxHealth: number;
  shield: number;
  position: number;
  retreated: boolean;
};

export function buildBattleFrame(playerUnits: readonly TeamSnapshotUnit[], opponentUnits: readonly TeamSnapshotUnit[], events: readonly BattleEvent[]): Map<string, BattleFrameUnit> {
  const frame = new Map<string, BattleFrameUnit>();
  for (const [side, units] of [["player", playerUnits], ["opponent", opponentUnits]] as const) {
    for (const unit of units) {
      const unitId = `${side}_${unit.snapshotUnitId}`;
      frame.set(unitId, { unitId, side, snapshot: unit, slot: slotForSidePosition(side, unit.position), attack: unit.initialAttack, health: unit.initialMaxHealth, maxHealth: unit.initialMaxHealth, shield: 0, position: unit.position, retreated: false });
    }
  }
  for (const event of events) {
    const target = event.targetUnitId ? frame.get(event.targetUnitId) : undefined;
    const source = event.sourceUnitId ? frame.get(event.sourceUnitId) : undefined;
    if (event.type === "unitSummoned" && event.targetUnitId) {
      const effect = event.metadata.effect as { speciesId?: SpeciesId; level?: 1 | 2 | 3; attack?: number; health?: number } | undefined;
      const speciesId = effect?.speciesId ?? event.metadata.speciesId as SpeciesId | undefined;
      const side = event.side;
      if (speciesId && side) {
        const attack = effect?.attack ?? 1;
        const health = effect?.health ?? 1;
        const slot = typeof event.metadata.slot === "string" ? event.metadata.slot as BattleSlot : slotForSidePosition(side, typeof event.after === "number" ? event.after : 0);
        frame.set(event.targetUnitId, {
          unitId: event.targetUnitId,
          side,
          slot,
          snapshot: {
            snapshotUnitId: event.targetUnitId,
            speciesId,
            position: typeof event.after === "number" ? event.after : 0,
            bondXp: 0,
            level: effect?.level ?? 1,
            initialAttack: attack,
            initialMaxHealth: health,
            equipmentEffect: null,
            startingStatuses: [],
          },
          attack,
          health,
          maxHealth: health,
          shield: 0,
          position: typeof event.after === "number" ? event.after : 0,
          retreated: false,
        });
      }
    }
    if (event.type === "shieldAbsorbed" && target && typeof event.after === "number") target.shield = event.after;
    if (event.type === "damageApplied" && target && typeof event.after === "number") target.health = event.after;
    if (event.type === "statModified" && target && typeof event.after === "number") {
      if (event.metadata.stat === "attack" || event.metadata.stat === "attackReduced") target.attack = event.after;
      if (event.metadata.stat === "health") {
        const before = typeof event.before === "number" ? event.before : target.health;
        const delta = event.after - before;
        target.health = event.after;
        target.maxHealth = Math.max(1, target.maxHealth + delta);
      }
      if (event.metadata.stat === "shield") target.shield = event.after;
    }
    if (event.type === "unitMoved" && source && typeof event.after === "number") {
      source.position = event.after;
      if (typeof event.metadata.afterSlot === "string") source.slot = event.metadata.afterSlot as BattleSlot;
    }
    if (event.type === "unitRetreated" && source) {
      source.retreated = true;
      source.health = Math.min(0, source.health);
    }
  }
  return frame;
}

export function activeSlotEntries(frameById: ReadonlyMap<string, BattleFrameUnit>, side: Side): Map<BattleSlot, BattleFrameUnit> {
  const bySlot = new Map<BattleSlot, BattleFrameUnit>();
  for (const frame of frameById.values()) {
    if (frame.side !== side || frame.retreated) continue;
    bySlot.set(frame.slot, frame);
  }
  return bySlot;
}
