import type { BattleEvent, BattleEventType, BattlePhaseId } from "../domain/types";

export type PresentationCueKind =
  | "setup"
  | "environment"
  | "battleStart"
  | "exchangeStart"
  | "preAttack"
  | "pairedImpact"
  | "hurtWave"
  | "retreatWave"
  | "afterAttack"
  | "movement"
  | "battleEnd"
  | "other";

export interface PresentationCue {
  cueId: string;
  index: number;
  kind: PresentationCueKind;
  phaseId?: BattlePhaseId;
  batchId?: string;
  exchangeId?: string;
  simultaneousGroupId?: string;
  eventStartIndex: number;
  eventEndIndex: number;
  eventIds: string[];
  eventTypes: BattleEventType[];
  sourceUnitIds: string[];
  targetUnitIds: string[];
  labelZh: string;
  summaryZh: string;
  debugLine: string;
  isSimultaneous: boolean;
  isSkippable: true;
}

function movementCause(event: BattleEvent): string | undefined {
  if (event.type !== "unitMoved") return undefined;
  const cause = event.metadata.causeUnitId ?? event.sourceUnitId;
  return typeof cause === "string" ? cause : undefined;
}

function cueKind(event: BattleEvent): PresentationCueKind {
  if (event.type === "unitMoved") return "movement";
  if (event.phaseId === "setup") return "setup";
  if (event.phaseId === "environment") return "environment";
  if (event.phaseId === "battleStart") return "battleStart";
  if (event.phaseId === "exchangeStart") return "exchangeStart";
  if (event.phaseId === "preAttack") return "preAttack";
  if (event.phaseId === "impact") return "pairedImpact";
  if (event.phaseId === "hurt") return "hurtWave";
  if (event.phaseId === "retreat") return "retreatWave";
  if (event.phaseId === "afterAttack") return "afterAttack";
  if (event.phaseId === "battleEnd") return "battleEnd";
  return "other";
}

function cueLabel(kind: PresentationCueKind, event: BattleEvent): string {
  if (kind === "setup") return "入场";
  if (kind === "environment") return "环境";
  if (kind === "battleStart") return "开局批次";
  if (kind === "exchangeStart") return `${event.exchangeId ?? "交换"} 锁定攻击者`;
  if (kind === "preAttack") return `${event.exchangeId ?? "交换"} 攻击前`;
  if (kind === "pairedImpact") return `${event.exchangeId ?? "交换"} 成对冲击`;
  if (kind === "hurtWave") return `${event.exchangeId ?? "链"} 受伤反应`;
  if (kind === "retreatWave") return `${event.exchangeId ?? "链"} 退场波`;
  if (kind === "afterAttack") return `${event.exchangeId ?? "交换"} 攻击后`;
  if (kind === "movement") return "移位";
  if (kind === "battleEnd") return "结算";
  return "事件";
}

function groupKey(event: BattleEvent): string {
  const cause = movementCause(event);
  if (cause) return `movement:${cause}`;
  if (event.phaseId === "impact" && event.simultaneousGroupId) return `impact:${event.exchangeId ?? ""}:${event.simultaneousGroupId}`;
  if (event.batchId || event.phaseId || event.exchangeId) return `${event.phaseId ?? ""}:${event.exchangeId ?? ""}:${event.batchId ?? ""}`;
  return `single:${event.eventId}`;
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function summarize(events: readonly BattleEvent[]): string {
  if (events.length === 1) return events[0].messageZh;
  const messages = events.map((event) => event.messageZh);
  return `${messages[0]} / ${messages[messages.length - 1]} (${events.length} events)`;
}

export function compileBattleCues(events: readonly BattleEvent[]): PresentationCue[] {
  const cues: PresentationCue[] = [];
  let index = 0;
  while (index < events.length) {
    const start = index;
    const key = groupKey(events[start]);
    const kind = cueKind(events[start]);
    index += 1;
    while (index < events.length && groupKey(events[index]) === key) index += 1;
    const group = events.slice(start, index);
    const first = group[0];
    const eventIds = group.map((event) => event.eventId);
    const eventTypes = group.map((event) => event.type);
    const sourceUnitIds = uniqueDefined(group.map((event) => event.sourceUnitId));
    const targetUnitIds = uniqueDefined(group.map((event) => event.targetUnitId));
    const batch = first.batchId ? ` batch=${first.batchId}` : "";
    const exchange = first.exchangeId ? ` exchange=${first.exchangeId}` : "";
    const simultaneous = first.simultaneousGroupId ? ` simultaneous=${first.simultaneousGroupId}` : "";
    const cue: PresentationCue = {
      cueId: `cue_${cues.length + 1}`,
      index: cues.length,
      kind,
      phaseId: first.phaseId,
      batchId: first.batchId,
      exchangeId: first.exchangeId,
      simultaneousGroupId: first.simultaneousGroupId,
      eventStartIndex: start,
      eventEndIndex: index - 1,
      eventIds,
      eventTypes,
      sourceUnitIds,
      targetUnitIds,
      labelZh: cueLabel(kind, first),
      summaryZh: summarize(group),
      debugLine: `[${String(cues.length + 1).padStart(2, "0")}] ${cueLabel(kind, first)} phase=${first.phaseId ?? "-"}${exchange}${batch}${simultaneous} events=${eventTypes.join("+")}`,
      isSimultaneous: Boolean(first.simultaneousGroupId || group.length > 1),
      isSkippable: true,
    };
    cues.push(cue);
  }
  return cues;
}

export function formatBattleCueTimeline(cues: readonly PresentationCue[]): string {
  return cues.map((cue) => cue.debugLine).join("\n");
}
