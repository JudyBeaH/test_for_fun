import { BoardMutationService, BATTLE_SLOTS, type BoardMutationResult } from "./battleBoard";
import { createBattleUnits, resolveBattleFromUnits } from "./battleEngine";
import type { BattleInput, BattleOutput, BattleSlot, BattleUnit } from "./types";

export interface BattleSandboxFlags {
  experimentalCrossSideSwap?: boolean;
}

export interface CrossSideSwapMutation {
  kind: "swap";
  a: BattleSlot;
  b: BattleSlot;
  label?: string;
}

export interface BattleSandboxTrace {
  label: string;
  text: string;
  slots: Record<BattleSlot, string | null>;
}

export interface CrossSideSwapSandboxResult {
  output: BattleOutput;
  debugTrace: BattleSandboxTrace[];
  mutationResults: BoardMutationResult[];
  unresolvedDesignAmbiguities: string[];
}

const DEFAULT_SANDBOX_FLAGS: Required<BattleSandboxFlags> = {
  experimentalCrossSideSwap: false,
};

function slotOccupant(units: readonly BattleUnit[], slot: BattleSlot): string | null {
  const unit = units.find((item) => !item.retreated && item.slot === slot);
  if (!unit) return null;
  return `${unit.unitId}{origin=${unit.originOwner},combat=${unit.side},hp=${unit.health},atk=${unit.attack}}`;
}

export function traceBattleSlots(label: string, units: readonly BattleUnit[]): BattleSandboxTrace {
  const slots = Object.fromEntries(BATTLE_SLOTS.map((slot) => [slot, slotOccupant(units, slot)])) as Record<BattleSlot, string | null>;
  return {
    label,
    slots,
    text: BATTLE_SLOTS.map((slot) => `${slot}:${slots[slot] ?? "."}`).join(" | "),
  };
}

export function runCrossSideSwapSandbox(input: BattleInput, mutations: readonly CrossSideSwapMutation[], flags: BattleSandboxFlags = {}): CrossSideSwapSandboxResult {
  const effectiveFlags = { ...DEFAULT_SANDBOX_FLAGS, ...flags };
  const player = createBattleUnits(input, "player");
  const opponent = createBattleUnits(input, "opponent");
  const allUnits = [...player, ...opponent];
  const board = new BoardMutationService(allUnits, effectiveFlags);
  const debugTrace: BattleSandboxTrace[] = [traceBattleSlots("initial", allUnits)];
  const mutationResults: BoardMutationResult[] = [];

  for (const [index, mutation] of mutations.entries()) {
    const result = mutation.kind === "swap" ? board.swap(mutation.a, mutation.b) : { ok: false, message: "unknown mutation", moved: [] };
    mutationResults.push(result);
    debugTrace.push(traceBattleSlots(mutation.label ?? `${index + 1}:${mutation.kind}:${mutation.a}<->${mutation.b}:${result.ok ? "ok" : result.message}`, allUnits));
  }

  const output = resolveBattleFromUnits(input, player, opponent, effectiveFlags.experimentalCrossSideSwap ? ["experimentalCrossSideSwap enabled"] : []);
  return {
    output,
    debugTrace,
    mutationResults,
    unresolvedDesignAmbiguities: [
      "Cross-side ability wording is still unresolved: user-facing text may need to distinguish origin owner from current combat side.",
      "Equipment and long-lived status ownership currently follows originOwner; future steal/charm mechanics may need explicit ownership transfer semantics.",
      "Rewards and contribution remain origin-owner based; future content should decide whether temporary side changes can affect scoring.",
    ],
  };
}
