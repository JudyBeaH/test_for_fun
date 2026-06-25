import { ANIMALS, ANIMAL_BY_ID } from "../content/animals";
import { campLevelRowForRound } from "../content/campLevels";
import { CONTENT_VERSION, ENGINE_VERSION } from "../content/constants";
import { ENVIRONMENTS } from "../content/environments";
import { createMember, formationMembers, toTeamSnapshot } from "../domain/campEngine";
import { makeId, makeTeamId } from "../domain/ids";
import { createRng, shuffleDeterministic } from "../domain/rng";
import type { BattleInput, EnvironmentId, ExpeditionState, SpeciesId, TeamMember } from "../domain/types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function environmentForRound(seed: number, round: number): EnvironmentId {
  return ENVIRONMENTS[Math.abs(seed + round) % ENVIRONMENTS.length].id;
}

export function generateOpponent(state: ExpeditionState) {
  const rng = createRng(state.expeditionSeed ^ (state.round * 104729) ^ (state.badges * 8191));
  const teamSize = clamp(2 + Math.floor((state.round - 1) / 2), 2, 5);
  const level = campLevelRowForRound(state.round);
  const pool = ANIMALS.filter((animal) => animal.tier <= level.maxAnimalTier).map((animal) => animal.id);
  const chosen: SpeciesId[] = [];
  const counts = new Map<SpeciesId, number>();
  const first = rng.pick(pool);
  chosen.push(first);
  counts.set(first, 1);
  while (chosen.length < teamSize) {
    const compatible = pool.filter((id) => (counts.get(id) ?? 0) < 2 && ANIMAL_BY_ID[id].habitats.some((habitat) => ANIMAL_BY_ID[first].habitats.includes(habitat)));
    const legal = pool.filter((id) => (counts.get(id) ?? 0) < 2);
    const source = compatible.length > 0 && rng.next() < 0.6 ? compatible : legal;
    const pick = rng.pick(source);
    chosen.push(pick);
    counts.set(pick, (counts.get(pick) ?? 0) + 1);
  }
  const members: TeamMember[] = chosen.map((id, index) => createMember(id, state.expeditionSeed ^ 0xaaaa, state.round, index));
  let budget = Math.max(0, state.round - 2) + state.badges;
  while (budget > 0) {
    const candidates = members.filter((member) => member.bondXp < 6);
    if (!candidates.length) break;
    rng.pick(candidates).bondXp += 1;
    budget -= 1;
  }
  let itemBudget = Math.max(0, Math.floor((state.round - 2) / 3));
  for (const member of members) {
    if (itemBudget <= 0) break;
    member.equipment = { instanceId: makeId("op_item", state.expeditionSeed + state.round, itemBudget), itemId: "pinecone_sling" };
    itemBudget -= 1;
  }
  const ordered = shuffleDeterministic(members, rng).sort((a, b) => sortWeight(a.speciesId) - sortWeight(b.speciesId));
  return {
    teamId: makeTeamId(state.expeditionSeed, `opponent:${state.round}:${state.badges}`),
    snapshot: toTeamSnapshot(ordered),
    battleSeed: state.expeditionSeed ^ (state.round * 65537) ^ (state.badges * 257),
    environmentId: environmentForRound(state.expeditionSeed, state.round),
  };
}

function sortWeight(speciesId: SpeciesId): number {
  const animal = ANIMAL_BY_ID[speciesId];
  const levelOne = animal.ability.levels[0];
  if (animal.baseHealth >= 7 || levelOne.trigger === "onHurt" || levelOne.trigger === "selfRetreat") return 0;
  if (levelOne.trigger === "battleStart" || levelOne.trigger === "allyRetreat") return 3;
  if (levelOne.effects.some((effect) => effect.kind === "swapSelfWithNearestAlly")) return 2;
  return 1;
}

export function battleInputForState(state: ExpeditionState): BattleInput {
  const opponent = generateOpponent(state);
  return {
    battleId: makeId("battle", state.expeditionSeed + state.round, state.badges),
    playerTeam: toTeamSnapshot(formationMembers(state)),
    opponentTeam: opponent.snapshot,
    environmentId: opponent.environmentId,
    seed: opponent.battleSeed,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
  };
}
