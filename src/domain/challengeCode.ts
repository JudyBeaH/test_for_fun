import { CONTENT_VERSION, ENGINE_VERSION, REGION_ID } from "../content/constants";
import type { RegisteredTeam } from "./types";

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export interface ChallengeDecode {
  ok: boolean;
  team?: RegisteredTeam;
  museumOnly?: boolean;
  errorZh?: string;
}

export function encodeChallengeCode(team: RegisteredTeam): string {
  const payload = encodeBase64Url(JSON.stringify(team));
  return `WT2.${payload}.${fnv1a(payload)}`;
}

export function decodeChallengeCode(code: string): ChallengeDecode {
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "WT2") return { ok: false, errorZh: "挑战码格式无效或版本未知。" };
  const [, payload, checksum] = parts;
  if (fnv1a(payload) !== checksum) return { ok: false, errorZh: "挑战码校验失败，可能已损坏。" };
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as Partial<RegisteredTeam>;
    const validation = validateRegisteredTeam(parsed);
    if (validation) return { ok: false, errorZh: validation };
    const team = parsed as RegisteredTeam;
    return { ok: true, team, museumOnly: team.engineVersion !== ENGINE_VERSION || team.contentVersion !== CONTENT_VERSION };
  } catch {
    return { ok: false, errorZh: "挑战码内容无法读取。" };
  }
}

export function validateRegisteredTeam(team: Partial<RegisteredTeam>): string | null {
  if (!team.teamId || !team.name || !team.sourceRunId || !team.sourceBattleId) return "挑战码缺少队伍基础字段。";
  if (team.regionId !== REGION_ID) return "挑战码地区不受支持。";
  if (team.badges !== 10) return "挑战码远征章数量非法。";
  if (!team.lineupSnapshot || !Array.isArray(team.lineupSnapshot.units) || team.lineupSnapshot.units.length < 1 || team.lineupSnapshot.units.length > 5) return "挑战码队列快照非法。";
  for (const unit of team.lineupSnapshot.units) {
    if (typeof unit.position !== "number" || typeof unit.initialAttack !== "number" || typeof unit.initialMaxHealth !== "number" || ![1, 2, 3].includes(unit.level)) return "挑战码队员数值非法。";
  }
  if (typeof team.finalBattleSeed !== "number" || !team.finalBattleEnvironmentId) return "挑战码缺少最终战环境或种子。";
  return null;
}
