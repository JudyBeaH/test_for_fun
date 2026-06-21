import { hashString } from "./rng";

export function makeId(prefix: string, seed: number, index: number): string {
  return `${prefix}_${(hashString(`${prefix}:${seed}:${index}`) >>> 0).toString(36)}`;
}

export function makeRunId(seed: number): string {
  return makeId("run", seed, 1);
}

export function makeTeamId(seed: number, label: string): string {
  return `team_${hashString(`${seed}:${label}`).toString(36)}`;
}
