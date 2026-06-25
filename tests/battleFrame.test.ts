import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ENGINE_VERSION } from "../src/content/constants";
import { compileBattleCues } from "../src/presentation/battleCueCompiler";
import { activeSlotEntries, buildBattleFrame } from "../src/presentation/battleFrame";
import type { BattleEvent, BattleInput, TeamSnapshotUnit } from "../src/domain/types";

function unit(snapshotUnitId: string, speciesId: TeamSnapshotUnit["speciesId"], position: number): TeamSnapshotUnit {
  return {
    snapshotUnitId,
    speciesId,
    position,
    bondXp: 1,
    level: 1,
    initialAttack: 3,
    initialMaxHealth: 5,
    equipmentEffect: null,
    startingStatuses: [],
  };
}

function event(sequence: number, event: Omit<BattleEvent, "eventId" | "sequence" | "messageZh">): BattleEvent {
  return { eventId: `evt_${sequence}`, sequence, messageZh: event.type, ...event };
}

describe("battle presentation frame", () => {
  it("applies grouped movement atomically for summoned unit and backline ally swaps", () => {
    const input: BattleInput = {
      battleId: "frame_push_summon",
      playerTeam: { units: [unit("frog_1", "frog", 1)] },
      opponentTeam: { units: [unit("deer_0", "chinese_water_deer", 0)] },
      environmentId: "wetland_channel",
      seed: 1,
      engineVersion: ENGINE_VERSION,
      contentVersion: CONTENT_VERSION,
    };
    const events: BattleEvent[] = [
      event(1, { type: "unitSummoned", phaseId: "retreat", batchId: "x1-retreat-1", sourceUnitId: "player_crucian_carp_0", targetUnitId: "summon_player_player_crucian_carp_0_1", side: "player", after: 0, metadata: { slot: "L0", speciesId: "swallow", effect: { kind: "summonUnit", speciesId: "swallow", level: 1, attack: 1, health: 2, placement: "sourceThenBack" } } }),
      event(2, { type: "unitMoved", phaseId: "afterAttack", batchId: "x1-after", exchangeId: "x1", sourceUnitId: "player_frog_1", side: "player", before: 1, after: 0, metadata: { beforeSlot: "L1", afterSlot: "L0", causeUnitId: "opponent_chinese_water_deer_0" } }),
      event(3, { type: "unitMoved", phaseId: "afterAttack", batchId: "x1-after", exchangeId: "x1", sourceUnitId: "summon_player_player_crucian_carp_0_1", side: "player", before: 0, after: 1, metadata: { beforeSlot: "L0", afterSlot: "L1", causeUnitId: "opponent_chinese_water_deer_0" } }),
    ];

    const movementCue = compileBattleCues(events).find((cue) => cue.kind === "movement")!;
    const frame = buildBattleFrame(input.playerTeam.units, input.opponentTeam.units, events.slice(0, movementCue.eventEndIndex + 1));
    const playerSlots = activeSlotEntries(frame, "player");

    expect(movementCue.eventTypes).toEqual(["unitMoved", "unitMoved"]);
    expect(playerSlots.get("L0")?.unitId).toBe("player_frog_1");
    expect(playerSlots.get("L1")?.unitId).toBe("summon_player_player_crucian_carp_0_1");
    expect([...playerSlots.values()].map((entry) => entry.unitId).sort()).toEqual(["player_frog_1", "summon_player_player_crucian_carp_0_1"]);
  });
});
