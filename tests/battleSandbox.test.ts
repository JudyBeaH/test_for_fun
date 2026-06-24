import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, ENGINE_VERSION } from "../src/content/constants";
import { runCrossSideSwapSandbox } from "../src/domain/battleSandbox";
import type { BattleInput, SpeciesId, TeamSnapshot } from "../src/domain/types";

function unit(speciesId: SpeciesId, position: number, attack: number, health: number) {
  return {
    snapshotUnitId: `${speciesId}_${position}`,
    speciesId,
    position,
    bondXp: 1,
    level: 1 as const,
    initialAttack: attack,
    initialMaxHealth: health,
    equipmentEffect: null,
    startingStatuses: [],
  };
}

function team(units: TeamSnapshot["units"]): TeamSnapshot {
  return { units };
}

function input(playerTeam: TeamSnapshot, opponentTeam: TeamSnapshot): BattleInput {
  return {
    battleId: "sandbox_cross_side",
    playerTeam,
    opponentTeam,
    environmentId: "canopy",
    seed: 20260504,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
  };
}

describe("P5D cross-line sandbox", () => {
  it("keeps cross-side swap disabled by default", () => {
    const battle = input(team([unit("weasel", 0, 6, 4)]), team([unit("frog", 4, 3, 5)]));
    const sandbox = runCrossSideSwapSandbox(battle, [{ kind: "swap", a: "L0", b: "R4" }]);

    expect(sandbox.mutationResults[0].ok).toBe(false);
    expect(sandbox.mutationResults[0].message).toContain("cross-side swap disabled");
    expect(sandbox.debugTrace).toHaveLength(2);
    expect(sandbox.debugTrace[1].slots.L0).toContain("player_weasel_0");
    expect(sandbox.debugTrace[1].slots.R4).toContain("opponent_frog_4");
  });

  it("resolves L0 <-> R4 with originOwner separated from combatSide", () => {
    const battle = input(team([unit("weasel", 0, 6, 4)]), team([unit("frog", 4, 3, 5)]));
    const sandbox = runCrossSideSwapSandbox(battle, [{ kind: "swap", a: "L0", b: "R4", label: "swap-front-with-far-back" }], { experimentalCrossSideSwap: true });

    expect(sandbox.mutationResults[0].ok).toBe(true);
    expect(sandbox.debugTrace).toHaveLength(2);
    expect(sandbox.debugTrace[1].text).toContain("L0:opponent_frog_4{origin=opponent,combat=player");
    expect(sandbox.debugTrace[1].text).toContain("R4:player_weasel_0{origin=player,combat=opponent");

    const playerUnit = sandbox.output.finalPlayerUnits.find((item) => item.unitId === "player_weasel_0")!;
    const opponentUnit = sandbox.output.finalOpponentUnits.find((item) => item.unitId === "opponent_frog_4")!;
    expect(playerUnit.originOwner).toBe("player");
    expect(playerUnit.side).toBe("opponent");
    expect(playerUnit.slot).toBe("R4");
    expect(opponentUnit.originOwner).toBe("opponent");
    expect(opponentUnit.side).toBe("player");
    expect(opponentUnit.slot).toBe("L0");
  });

  it("uses combatSide for normal attack targeting but originOwner for victory ownership", () => {
    const battle = input(team([unit("weasel", 0, 6, 4)]), team([unit("frog", 4, 3, 5)]));
    const sandbox = runCrossSideSwapSandbox(battle, [{ kind: "swap", a: "L0", b: "R4" }], { experimentalCrossSideSwap: true });
    const windups = sandbox.output.events.filter((event) => event.type === "attackWindup");
    const damage = sandbox.output.events.filter((event) => event.type === "damageApplied" && event.metadata.damageKind === "normalAttack");

    expect(windups.slice(0, 2).map((event) => `${event.side}:${event.sourceUnitId}`)).toEqual(["player:opponent_frog_4", "opponent:player_weasel_0"]);
    expect(damage.slice(0, 2).map((event) => `${event.sourceUnitId}->${event.targetUnitId}`)).toEqual(["opponent_frog_4->player_weasel_0", "player_weasel_0->opponent_frog_4"]);
    expect(sandbox.output.result).toBe("win");
    expect(sandbox.output.diagnostics).not.toContain("no attackers available");
    expect(sandbox.output.diagnostics).not.toContain("safety cap reached or unresolved battle");
  });

  it("records unresolved design ambiguities for the experiment", () => {
    const battle = input(team([unit("weasel", 0, 6, 4)]), team([unit("frog", 4, 3, 5)]));
    const sandbox = runCrossSideSwapSandbox(battle, [{ kind: "swap", a: "L0", b: "R4" }], { experimentalCrossSideSwap: true });

    expect(sandbox.unresolvedDesignAmbiguities.length).toBeGreaterThan(0);
    expect(sandbox.unresolvedDesignAmbiguities.join("\n")).toContain("originOwner");
  });
});
