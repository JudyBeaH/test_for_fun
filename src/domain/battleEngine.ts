import { ANIMAL_BY_ID } from "../content/animals";
import { ENVIRONMENT_BY_ID } from "../content/environments";
import { BoardMutationService, combatSideForSlot, positionForSlot, slotForSidePosition } from "./battleBoard";
import type {
  BattleEvent,
  BattlePhaseId,
  BattleInput,
  BattleOutput,
  BattleResult,
  BattleStatus,
  BattleUnit,
  ContributionSummary,
  DamageIntent,
  DamageResult,
  EffectDef,
  Habitat,
  Side,
  TargetSelector,
  Trigger,
} from "./types";
import { emptyContribution, longestAbilityChain, recomputeTotals } from "./contribution";
import { createRng, type Rng } from "./rng";

interface BattleContext {
  rng: Rng;
  events: BattleEvent[];
  sequence: number;
  diagnostics: string[];
  contribution: ContributionSummary;
  phaseId: BattlePhaseId;
  batchId?: string;
  exchangeId?: string;
  simultaneousGroupId?: string;
}

interface TriggerOptions {
  committed?: boolean;
}

interface QueuedTrigger {
  sourceUnitId: string;
  trigger: Trigger;
  attackerUnitId?: string;
  committed: boolean;
}

export function createBattleUnits(input: BattleInput, side: Side): BattleUnit[] {
  const team = side === "player" ? input.playerTeam : input.opponentTeam;
  return team.units.map((unit) => ({
    unitId: `${side}_${unit.snapshotUnitId}`,
    side,
    originOwner: side,
    slot: slotForSidePosition(side, unit.position),
    speciesId: unit.speciesId,
    level: unit.level,
    attack: unit.initialAttack,
    health: unit.initialMaxHealth,
    maxHealth: unit.initialMaxHealth,
    shield: 0,
    position: unit.position,
    triggerCounts: {},
    statuses: unit.startingStatuses.flatMap((status): BattleStatus[] => status.def.kind === "sleepThenEmpower" ? [{ kind: "sleeping" }] : []),
    retreated: false,
  })).sort((a, b) => positionForSlot(a.slot) - positionForSlot(b.slot));
}

function active(units: readonly BattleUnit[]): BattleUnit[] {
  return units.filter((unit) => !unit.retreated).sort((a, b) => positionForSlot(a.slot) - positionForSlot(b.slot));
}

function enemySide(side: Side): Side {
  return side === "player" ? "opponent" : "player";
}

function unitName(unit: BattleUnit): string {
  return ANIMAL_BY_ID[unit.speciesId].nameZh;
}

function addEvent(ctx: BattleContext, event: Omit<BattleEvent, "eventId" | "sequence">): void {
  ctx.sequence += 1;
  ctx.events.push({
    eventId: `evt_${ctx.sequence}`,
    sequence: ctx.sequence,
    phaseId: event.phaseId ?? ctx.phaseId,
    batchId: event.batchId ?? ctx.batchId,
    exchangeId: event.exchangeId ?? ctx.exchangeId,
    simultaneousGroupId: event.simultaneousGroupId ?? ctx.simultaneousGroupId,
    ...event,
  });
}

function withEventContext(ctx: BattleContext, patch: Partial<Pick<BattleContext, "batchId" | "exchangeId" | "phaseId" | "simultaneousGroupId">>, run: () => void): void {
  const previous = {
    phaseId: ctx.phaseId,
    batchId: ctx.batchId,
    exchangeId: ctx.exchangeId,
    simultaneousGroupId: ctx.simultaneousGroupId,
  };
  Object.assign(ctx, patch);
  try {
    run();
  } finally {
    ctx.phaseId = previous.phaseId;
    ctx.batchId = previous.batchId;
    ctx.exchangeId = previous.exchangeId;
    ctx.simultaneousGroupId = previous.simultaneousGroupId;
  }
}

function sideUnits(player: BattleUnit[], opponent: BattleUnit[], side: Side): BattleUnit[] {
  return allUnits(player, opponent).filter((unit) => combatSideForSlot(unit.slot) === side);
}

function allUnits(player: BattleUnit[], opponent: BattleUnit[]): BattleUnit[] {
  return [...player, ...opponent];
}

function findUnit(player: BattleUnit[], opponent: BattleUnit[], unitId: string): BattleUnit | undefined {
  return allUnits(player, opponent).find((unit) => unit.unitId === unitId);
}

function firstWithHabitat(units: BattleUnit[], habitat: Habitat): BattleUnit | undefined {
  return active(units).find((unit) => ANIMAL_BY_ID[unit.speciesId].habitats.includes(habitat));
}

function lastWithHabitat(units: BattleUnit[], habitat: Habitat): BattleUnit | undefined {
  return [...active(units)].reverse().find((unit) => ANIMAL_BY_ID[unit.speciesId].habitats.includes(habitat));
}

function applyEnvironment(input: BattleInput, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext): void {
  const env = ENVIRONMENT_BY_ID[input.environmentId];
  for (const units of [player, opponent]) {
    if (input.environmentId === "wetland_channel") {
      const target = firstWithHabitat(units, "water");
      if (target) modifyHealth(target, 2, undefined, ctx, `湿地水道滋养${unitName(target)}，获得 +2 体力。`);
    }
    if (input.environmentId === "meadow") {
      const target = firstWithHabitat(units, "land");
      if (target) {
        modifyAttack(target, 1, undefined, ctx, `草甸鼓舞${unitName(target)}，获得 +1 攻击。`);
        gainShield(target, 1, undefined, ctx, `草甸掩护${unitName(target)}，获得 1 点护盾。`);
      }
    }
    if (input.environmentId === "canopy") {
      const source = lastWithHabitat(units, "air");
      const target = active(units)[0];
      if (source && target) modifyAttack(target, 1, source, ctx, `林冠中的${unitName(source)}提醒前排，${unitName(target)}获得 +1 攻击。`);
    }
  }
  addEvent(ctx, { type: "environmentApplied", messageZh: `${env.nameZh}生效：${env.ruleZh}`, metadata: { environmentId: input.environmentId } });
}

function canAttack(unit: BattleUnit): boolean {
  return !unit.retreated && unit.health > 0 && !unit.statuses.some((status) => status.kind === "sleeping" || status.kind === "cannotAttack");
}

function selectTargets(selector: TargetSelector, source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, attacker?: BattleUnit): BattleUnit[] {
  const allies = active(sideUnits(player, opponent, source.side));
  const enemies = active(sideUnits(player, opponent, enemySide(source.side)));
  const selfIndex = allies.findIndex((unit) => unit.unitId === source.unitId);
  const one = (unit?: BattleUnit) => unit ? [unit] : [];
  switch (selector) {
    case "self": return source.retreated ? [] : [source];
    case "allyFront": return one(allies.find((unit) => unit.unitId !== source.unitId));
    case "allyBack": return one([...allies].reverse().find((unit) => unit.unitId !== source.unitId));
    case "allyBehindSelf": return one(allies.find((_unit, index) => index > selfIndex));
    case "allyAheadSelf": return one([...allies].reverse().find((_unit, index) => allies.length - 1 - index < selfIndex));
    case "allyLowestHealth": return one(allies.filter((unit) => unit.unitId !== source.unitId).sort((a, b) => a.health - b.health || positionForSlot(a.slot) - positionForSlot(b.slot))[0]);
    case "allAllies": return allies.filter((unit) => unit.unitId !== source.unitId);
    case "randomAlly": return allies.length ? [ctx.rng.pick(allies)] : [];
    case "enemyFront": return one(enemies[0]);
    case "enemyBack": return one(enemies[enemies.length - 1]);
    case "enemyLowestHealth": return one([...enemies].sort((a, b) => a.health - b.health || positionForSlot(a.slot) - positionForSlot(b.slot))[0]);
    case "randomEnemy": return enemies.length ? [ctx.rng.pick(enemies)] : [];
    case "attacker": return attacker && !attacker.retreated ? [attacker] : [];
  }
}

function gainShield(target: BattleUnit, amount: number, source: BattleUnit | undefined, ctx: BattleContext, messageZh?: string): void {
  const before = target.shield;
  target.shield += amount;
  if (source) ctx.contribution.byUnitId[source.unitId].positiveStatsGranted += amount;
  addEvent(ctx, { type: "statModified", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount, before, after: target.shield, messageZh: messageZh ?? `${unitName(target)}获得 ${amount} 点护盾。`, metadata: { stat: "shield" } });
}

function modifyAttack(target: BattleUnit, amount: number, source: BattleUnit | undefined, ctx: BattleContext, messageZh?: string): void {
  const before = target.attack;
  target.attack += amount;
  if (source && amount > 0) ctx.contribution.byUnitId[source.unitId].positiveStatsGranted += amount;
  addEvent(ctx, { type: "statModified", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount, before, after: target.attack, messageZh: messageZh ?? `${unitName(target)}获得 ${amount >= 0 ? "+" : ""}${amount} 攻击。`, metadata: { stat: "attack" } });
}

function reduceAttack(target: BattleUnit, amount: number, source: BattleUnit | undefined, ctx: BattleContext): void {
  const before = target.attack;
  target.attack = Math.max(0, target.attack - amount);
  const reduced = before - target.attack;
  if (source) ctx.contribution.byUnitId[source.unitId].enemyAttackReduced += reduced;
  addEvent(ctx, { type: "statModified", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount: reduced, before, after: target.attack, messageZh: `${unitName(target)}的攻击降低 ${reduced}。`, metadata: { stat: "attackReduced" } });
}

function modifyHealth(target: BattleUnit, amount: number, source: BattleUnit | undefined, ctx: BattleContext, messageZh?: string): void {
  const before = target.health;
  target.maxHealth += amount;
  target.health += amount;
  if (source && amount > 0) ctx.contribution.byUnitId[source.unitId].positiveStatsGranted += amount;
  addEvent(ctx, { type: "statModified", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount, before, after: target.health, messageZh: messageZh ?? `${unitName(target)}获得 ${amount >= 0 ? "+" : ""}${amount} 体力。`, metadata: { stat: "health" } });
}

export function applyDamageBatch(player: BattleUnit[], opponent: BattleUnit[], intents: readonly DamageIntent[], ctx: BattleContext): DamageResult[] {
  const results: DamageResult[] = [];
  for (const intent of intents) {
    const target = findUnit(player, opponent, intent.targetUnitId);
    const source = intent.sourceUnitId ? findUnit(player, opponent, intent.sourceUnitId) : undefined;
    if (!target || target.retreated || target.health <= 0) continue;
    let remaining = Math.max(0, intent.amount);
    let blocked = 0;
    if (target.shield > 0 && remaining > 0) {
      blocked = Math.min(target.shield, remaining);
      const beforeShield = target.shield;
      target.shield -= blocked;
      remaining -= blocked;
      ctx.contribution.byUnitId[target.unitId].damageBlocked += blocked;
      addEvent(ctx, { type: "shieldAbsorbed", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount: blocked, before: beforeShield, after: target.shield, simultaneousGroupId: intent.simultaneousGroupId, messageZh: `${unitName(target)}的护盾吸收 ${blocked} 点伤害。`, metadata: { damageKind: intent.kind, simultaneousGroupId: intent.simultaneousGroupId } });
    }
    const before = target.health;
    if (remaining > 0) target.health -= remaining;
    if (source && remaining > 0) ctx.contribution.byUnitId[source.unitId].damageDealt += remaining;
    ctx.contribution.maxSingleDamage = Math.max(ctx.contribution.maxSingleDamage, remaining);
    if (remaining > 0) addEvent(ctx, { type: "damageApplied", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount: remaining, before, after: target.health, simultaneousGroupId: intent.simultaneousGroupId, messageZh: `${unitName(target)}受到 ${remaining} 点${intent.kind === "normalAttack" ? "普通" : "技能"}伤害。`, metadata: { damageKind: intent.kind, simultaneousGroupId: intent.simultaneousGroupId } });
    const survived = target.health > 0;
    const result: DamageResult = { sourceUnitId: source?.unitId, targetUnitId: target.unitId, inputDamage: intent.amount, shieldAbsorbed: blocked, actualHealthLost: remaining, healthBefore: before, healthAfter: target.health, survived, triggersOnHurt: remaining > 0 && survived && !target.retreated };
    results.push(result);
    if (result.triggersOnHurt) reactToDamage(target, ctx);
  }
  return results;
}

function reactToDamage(target: BattleUnit, ctx: BattleContext): void {
  const sleeping = target.statuses.findIndex((status) => status.kind === "sleeping");
  if (sleeping >= 0) {
    target.statuses.splice(sleeping, 1);
    target.statuses.push({ kind: "empoweredNormalAttacks", remaining: 3, bonusDamage: 5 });
    addEvent(ctx, { type: "statusConsumed", targetUnitId: target.unitId, side: target.side, messageZh: `褪黑素效果解除：${unitName(target)}醒来，接下来 3 次攻击额外造成 5 点伤害。`, metadata: { status: "sleepThenEmpower" } });
  }
}

function applyEffect(effect: EffectDef, source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, attacker?: BattleUnit, options: TriggerOptions = {}): DamageResult[] {
  const damageResults: DamageResult[] = [];
  if ((source.retreated || source.health <= 0) && !options.committed) {
    addEvent(ctx, { type: "abilitySourceUnavailable", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}已经退场，排队技能失效。`, metadata: { effect } });
    return damageResults;
  }
  if (effect.kind === "moveSelf") {
    const board = new BoardMutationService(allUnits(player, opponent));
    const beforeAllies = board.activeSideUnits(source.side);
    const promoted = effect.offset > 0 ? beforeAllies[beforeAllies.findIndex((unit) => unit.unitId === source.unitId) + 1] : beforeAllies[Math.max(0, beforeAllies.findIndex((unit) => unit.unitId === source.unitId) + effect.offset)];
    const result = board.moveWithinSide(source.unitId, effect.offset);
    if (!result.ok || result.moved.length === 0) {
      addEvent(ctx, { type: "abilityNoTarget", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}尝试移动，但队列没有变化。`, metadata: { effect } });
      return damageResults;
    }
    ctx.contribution.byUnitId[source.unitId].usefulMoves += 1;
    const movedRecords = [...result.moved].sort((a, b) => Number(b.unit.unitId === source.unitId) - Number(a.unit.unitId === source.unitId));
    for (const record of movedRecords) {
      const isSource = record.unit.unitId === source.unitId;
      addEvent(ctx, {
        type: "unitMoved",
        sourceUnitId: record.unit.unitId,
        side: record.unit.side,
        before: record.beforePosition,
        after: record.afterPosition,
        messageZh: isSource ? `${unitName(source)}跃至后位。` : `${unitName(record.unit)}补位换位。`,
        metadata: { beforeSlot: record.beforeSlot, afterSlot: record.afterSlot, fromOrder: record.fromOrder, toOrder: record.toOrder, causeUnitId: source.unitId },
      });
    }
    if (promoted && effect.buffPromotedAllyAttack) modifyAttack(promoted, effect.buffPromotedAllyAttack, source, ctx, `${unitName(source)}跃至后位，${unitName(promoted)}补到前方并获得 +${effect.buffPromotedAllyAttack} 攻击。`);
    return damageResults;
  }
  const targets = selectTargets(effect.target, source, player, opponent, ctx, attacker);
  if (targets.length === 0) {
    addEvent(ctx, { type: "abilityNoTarget", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}的技能没有合适目标。`, metadata: { effect } });
    return damageResults;
  }
  for (const target of targets) {
    if (effect.kind === "dealDamage") {
      const results = applyDamageBatch(player, opponent, [{ sourceUnitId: source.unitId, targetUnitId: target.unitId, amount: effect.amount, kind: "ability" }], ctx);
      damageResults.push(...results);
    }
    if (effect.kind === "modifyAttack") modifyAttack(target, effect.amount, source, ctx);
    if (effect.kind === "modifyHealth") modifyHealth(target, effect.amount, source, ctx);
    if (effect.kind === "gainShield") gainShield(target, effect.amount, source, ctx);
    if (effect.kind === "reduceAttack") reduceAttack(target, effect.amount, source, ctx);
    if (effect.kind === "applyBattleStatus") {
      target.statuses.push(effect.status);
      addEvent(ctx, { type: "statusApplied", sourceUnitId: source.unitId, targetUnitId: target.unitId, side: target.side, messageZh: `${unitName(target)}获得状态。`, metadata: { status: effect.status.kind } });
    }
  }
  return damageResults;
}

function triggerAbility(trigger: Trigger, source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, attacker?: BattleUnit, options: TriggerOptions = {}): DamageResult[] {
  const damageResults: DamageResult[] = [];
  if ((source.retreated || source.health <= 0) && trigger !== "selfRetreat" && !options.committed) return damageResults;
  const ability = ANIMAL_BY_ID[source.speciesId].ability.levels[source.level - 1];
  if (ability.trigger !== trigger) return damageResults;
  const current = source.triggerCounts[trigger] ?? 0;
  if (ability.maxTriggersPerBattle !== undefined && current >= ability.maxTriggersPerBattle) return damageResults;
  source.triggerCounts[trigger] = current + 1;
  ctx.contribution.byUnitId[source.unitId].abilityTriggers += 1;
  addEvent(ctx, { type: "abilityTriggered", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}触发${ANIMAL_BY_ID[source.speciesId].ability.nameZh}。`, metadata: { trigger } });
  for (const effect of ability.effects) damageResults.push(...applyEffect(effect, source, player, opponent, ctx, attacker, options));
  return damageResults;
}

function processRetreats(player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext): DamageResult[] {
  const damageResults: DamageResult[] = [];
  const newly = allUnits(player, opponent)
    .filter((unit) => !unit.retreated && unit.health <= 0)
    .sort((a, b) => positionForSlot(a.slot) - positionForSlot(b.slot) || (a.side === "player" ? -1 : 1));
  if (!newly.length) return damageResults;
  for (const unit of newly) {
    unit.retreated = true;
    addEvent(ctx, { type: "unitRetreated", sourceUnitId: unit.unitId, side: unit.side, messageZh: `${unitName(unit)}退出本次遭遇。`, metadata: {} });
    damageResults.push(...triggerAbility("selfRetreat", unit, player, opponent, ctx));
  }
  for (const retreated of newly) {
    const allies = active(sideUnits(player, opponent, retreated.side)).filter((ally) => ally.unitId !== retreated.unitId);
    for (const ally of allies) damageResults.push(...triggerAbility("allyRetreat", ally, player, opponent, ctx));
  }
  return damageResults;
}

function resolveQueuedTriggers(triggers: readonly QueuedTrigger[], player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext): DamageResult[] {
  const damageResults: DamageResult[] = [];
  for (const item of triggers) {
    const source = findUnit(player, opponent, item.sourceUnitId);
    const attacker = item.attackerUnitId ? findUnit(player, opponent, item.attackerUnitId) : undefined;
    if (source) damageResults.push(...triggerAbility(item.trigger, source, player, opponent, ctx, attacker, { committed: item.committed }));
  }
  return damageResults;
}

function resolveHurtAndRetreatWaves(initialDamageResults: readonly DamageResult[], player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, exchangeId?: string): void {
  let pendingDamage = [...initialDamageResults];
  let wave = 0;
  while (pendingDamage.length > 0 || allUnits(player, opponent).some((unit) => !unit.retreated && unit.health <= 0)) {
    wave += 1;
    const hurtDamage = pendingDamage;
    pendingDamage = [];
    if (hurtDamage.some((item) => item.triggersOnHurt)) {
      withEventContext(ctx, { phaseId: "hurt", exchangeId, batchId: `${exchangeId ?? "start"}-hurt-${wave}` }, () => {
        for (const damage of hurtDamage.filter((item) => item.triggersOnHurt)) {
          const target = findUnit(player, opponent, damage.targetUnitId);
          const source = damage.sourceUnitId ? findUnit(player, opponent, damage.sourceUnitId) : undefined;
          if (target && !target.retreated && target.health > 0) pendingDamage.push(...triggerAbility("onHurt", target, player, opponent, ctx, source));
        }
      });
    }
    withEventContext(ctx, { phaseId: "retreat", exchangeId, batchId: `${exchangeId ?? "start"}-retreat-${wave}` }, () => {
      pendingDamage.push(...processRetreats(player, opponent, ctx));
    });
  }
}

function resultOf(player: BattleUnit[], opponent: BattleUnit[]): BattleResult | undefined {
  const p = active(player).length;
  const o = active(opponent).length;
  if (p === 0 && o === 0) return "draw";
  if (p === 0) return "loss";
  if (o === 0) return "win";
  return undefined;
}

function normalAttackDamage(unit: BattleUnit, ctx: BattleContext): number {
  let damage = unit.attack;
  const empowered = unit.statuses.find((status): status is Extract<BattleStatus, { kind: "empoweredNormalAttacks" }> => status.kind === "empoweredNormalAttacks");
  if (empowered && empowered.remaining > 0) {
    damage += empowered.bonusDamage;
    empowered.remaining -= 1;
    addEvent(ctx, { type: "statusConsumed", sourceUnitId: unit.unitId, side: unit.side, amount: empowered.bonusDamage, messageZh: `${unitName(unit)}消耗一次强化攻击，额外 +${empowered.bonusDamage} 伤害。`, metadata: { status: "empoweredNormalAttacks", remaining: empowered.remaining } });
    if (empowered.remaining <= 0) {
      unit.statuses = unit.statuses.filter((status) => status !== empowered);
      addEvent(ctx, { type: "statusExpired", sourceUnitId: unit.unitId, side: unit.side, messageZh: `${unitName(unit)}的强化攻击结束。`, metadata: { status: "empoweredNormalAttacks" } });
    }
  }
  return damage;
}

function triggerEquipmentStart(source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], input: BattleInput, ctx: BattleContext): DamageResult[] {
  const snapshot = (source.originOwner === "player" ? input.playerTeam : input.opponentTeam).units.find((unit) => `${source.originOwner}_${unit.snapshotUnitId}` === source.unitId);
  if (!snapshot?.equipmentEffect?.battleStartDamage) return [];
  const enemies = active(sideUnits(player, opponent, enemySide(source.side)));
  if (!enemies.length) return [];
  const target = ctx.rng.pick(enemies);
  addEvent(ctx, { type: "equipmentTriggered", sourceUnitId: source.unitId, targetUnitId: target.unitId, side: source.side, messageZh: `${unitName(source)}的装备松果弹弓触发。`, metadata: { itemId: snapshot.equipmentEffect.itemId } });
  return applyDamageBatch(player, opponent, [{ sourceUnitId: source.unitId, targetUnitId: target.unitId, amount: snapshot.equipmentEffect.battleStartDamage, kind: "equipment" }], ctx);
}

export function resolveBattleFromUnits(input: BattleInput, player: BattleUnit[], opponent: BattleUnit[], initialDiagnostics: readonly string[] = []): BattleOutput {
  const ctx: BattleContext = {
    rng: createRng(input.seed),
    events: [],
    sequence: 0,
    diagnostics: [...initialDiagnostics],
    contribution: emptyContribution([...player, ...opponent]),
    phaseId: "setup",
  };
  addEvent(ctx, { type: "battleStarted", messageZh: "双方进入遭遇。", metadata: { seed: input.seed, battleId: input.battleId } });
  withEventContext(ctx, { phaseId: "environment", batchId: "env-1" }, () => applyEnvironment(input, player, opponent, ctx));
  const startSnapshot = allUnits(player, opponent)
    .filter((unit) => !unit.retreated)
    .sort((a, b) => positionForSlot(a.slot) - positionForSlot(b.slot) || (a.side === "player" ? -1 : 1))
    .map((unit) => unit.unitId);
  const startDamageResults: DamageResult[] = [];
  withEventContext(ctx, { phaseId: "battleStart", batchId: "start-equipment" }, () => {
    for (const unitId of startSnapshot) {
      const source = findUnit(player, opponent, unitId);
      if (source) startDamageResults.push(...triggerEquipmentStart(source, player, opponent, input, ctx));
    }
  });
  withEventContext(ctx, { phaseId: "battleStart", batchId: "start-abilities" }, () => {
    startDamageResults.push(...resolveQueuedTriggers(startSnapshot.map((sourceUnitId): QueuedTrigger => ({ sourceUnitId, trigger: "battleStart", committed: true })), player, opponent, ctx));
  });
  resolveHurtAndRetreatWaves(startDamageResults, player, opponent, ctx);
  let exchanges = 0;
  let result = resultOf(player, opponent);
  while (!result && exchanges < 100 && ctx.events.length < 1000) {
    exchanges += 1;
    const exchangeId = `x${exchanges}`;
    const pOriginal = active(sideUnits(player, opponent, "player"))[0];
    const oOriginal = active(sideUnits(player, opponent, "opponent"))[0];
    if (!pOriginal || !oOriginal) break;
    const pCan = canAttack(pOriginal);
    const oCan = canAttack(oOriginal);
    withEventContext(ctx, { phaseId: "exchangeStart", exchangeId, batchId: `${exchangeId}-lock` }, () => {
      if (pCan) {
        addEvent(ctx, { type: "attackWindup", sourceUnitId: pOriginal.unitId, side: "player", messageZh: `${unitName(pOriginal)}准备普通攻击。`, metadata: {} });
      } else addEvent(ctx, { type: "attackSkipped", sourceUnitId: pOriginal.unitId, side: "player", messageZh: `${unitName(pOriginal)}正在睡眠，跳过攻击。`, metadata: {} });
      if (oCan) {
        addEvent(ctx, { type: "attackWindup", sourceUnitId: oOriginal.unitId, side: "opponent", messageZh: `${unitName(oOriginal)}准备普通攻击。`, metadata: {} });
      } else addEvent(ctx, { type: "attackSkipped", sourceUnitId: oOriginal.unitId, side: "opponent", messageZh: `${unitName(oOriginal)}正在睡眠，跳过攻击。`, metadata: {} });
    });
    const preAttackTriggers: QueuedTrigger[] = [];
    if (pCan) preAttackTriggers.push({ sourceUnitId: pOriginal.unitId, trigger: "beforeAttack", committed: true });
    if (oCan) preAttackTriggers.push({ sourceUnitId: oOriginal.unitId, trigger: "beforeAttack", committed: true });
    let preAttackDamageResults: DamageResult[] = [];
    withEventContext(ctx, { phaseId: "preAttack", exchangeId, batchId: `${exchangeId}-pre` }, () => {
      preAttackDamageResults = resolveQueuedTriggers(preAttackTriggers, player, opponent, ctx);
    });
    resolveHurtAndRetreatWaves(preAttackDamageResults, player, opponent, ctx, exchangeId);
    result = resultOf(player, opponent);
    if (result) break;
    const intents: DamageIntent[] = [];
    withEventContext(ctx, { phaseId: "impact", exchangeId, batchId: `${exchangeId}-damage-snapshot`, simultaneousGroupId: exchangeId }, () => {
      const playerTarget = active(sideUnits(player, opponent, "opponent"))[0];
      const opponentTarget = active(sideUnits(player, opponent, "player"))[0];
      if (pCan && playerTarget && !pOriginal.retreated && pOriginal.health > 0 && canAttack(pOriginal)) intents.push({ sourceUnitId: pOriginal.unitId, targetUnitId: playerTarget.unitId, amount: normalAttackDamage(pOriginal, ctx), kind: "normalAttack", simultaneousGroupId: exchangeId });
      if (oCan && opponentTarget && !oOriginal.retreated && oOriginal.health > 0 && canAttack(oOriginal)) intents.push({ sourceUnitId: oOriginal.unitId, targetUnitId: opponentTarget.unitId, amount: normalAttackDamage(oOriginal, ctx), kind: "normalAttack", simultaneousGroupId: exchangeId });
    });
    if (!intents.length) {
      ctx.diagnostics.push("no attackers available");
      result = "draw";
      break;
    }
    addEvent(ctx, { type: "attackExchange", phaseId: "impact", exchangeId, simultaneousGroupId: exchangeId, sourceUnitId: intents[0].sourceUnitId, targetUnitId: intents[0].targetUnitId, messageZh: "前排进行普通攻击交换。", metadata: { count: intents.length, simultaneousGroupId: exchangeId } });
    let results: ReturnType<typeof applyDamageBatch> = [];
    withEventContext(ctx, { phaseId: "impact", exchangeId, batchId: `${exchangeId}-impact`, simultaneousGroupId: exchangeId }, () => {
      results = applyDamageBatch(player, opponent, intents, ctx);
    });
    resolveHurtAndRetreatWaves(results, player, opponent, ctx, exchangeId);
    const afterAttackTriggers = intents
      .flatMap((intent): QueuedTrigger[] => intent.sourceUnitId ? [{ sourceUnitId: intent.sourceUnitId, trigger: "afterAttack", committed: true }] : [])
      .filter((item) => {
        const source = findUnit(player, opponent, item.sourceUnitId);
        return Boolean(source && !source.retreated && source.health > 0);
      });
    let afterAttackDamageResults: DamageResult[] = [];
    withEventContext(ctx, { phaseId: "afterAttack", exchangeId, batchId: `${exchangeId}-after` }, () => {
      afterAttackDamageResults = resolveQueuedTriggers(afterAttackTriggers, player, opponent, ctx);
    });
    resolveHurtAndRetreatWaves(afterAttackDamageResults, player, opponent, ctx, exchangeId);
    result = resultOf(player, opponent);
  }
  if (!result) {
    result = resultOf(player, opponent) ?? "draw";
    ctx.diagnostics.push("safety cap reached or unresolved battle");
    addEvent(ctx, { type: "safetyCapReached", phaseId: "battleEnd", messageZh: "战斗达到安全上限，按平局记录。", metadata: { exchanges, eventCount: ctx.events.length } });
  }
  ctx.contribution.longestSkillChain = longestAbilityChain(ctx.events);
  recomputeTotals(ctx.contribution);
  ctx.contribution.highlight = makeHighlight(result, ctx.contribution);
  addEvent(ctx, { type: "battleEnded", phaseId: "battleEnd", messageZh: `遭遇结束：${result === "win" ? "我方获得远征章" : result === "loss" ? "士气下降" : "双方暂时分开"}。`, metadata: { result } });
  return { result, events: ctx.events, finalPlayerUnits: player, finalOpponentUnits: opponent, contribution: ctx.contribution, diagnostics: ctx.diagnostics };
}

export function resolveBattle(input: BattleInput): BattleOutput {
  return resolveBattleFromUnits(input, createBattleUnits(input, "player"), createBattleUnits(input, "opponent"));
}

function makeHighlight(result: BattleResult, contribution: ContributionSummary): string {
  const mvp = contribution.mvpUnitId ? contribution.byUnitId[contribution.mvpUnitId] : undefined;
  if (!mvp) return result === "win" ? "队伍稳稳拿下一枚远征章。" : "队伍记录了这次遭遇的线索。";
  return `${ANIMAL_BY_ID[mvp.speciesId].nameZh}贡献最高，${result === "win" ? "帮助队伍拿下一枚远征章" : result === "draw" ? "帮助队伍守住阵脚" : "留下关键观察"}。`;
}
