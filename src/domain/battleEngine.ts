import { ANIMAL_BY_ID } from "../content/animals";
import { ENVIRONMENT_BY_ID } from "../content/environments";
import type {
  BattleEvent,
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
}

export function createBattleUnits(input: BattleInput, side: Side): BattleUnit[] {
  const team = side === "player" ? input.playerTeam : input.opponentTeam;
  return team.units.map((unit) => ({
    unitId: `${side}_${unit.snapshotUnitId}`,
    side,
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
  })).sort((a, b) => a.position - b.position);
}

function active(units: readonly BattleUnit[]): BattleUnit[] {
  return units.filter((unit) => !unit.retreated).sort((a, b) => a.position - b.position);
}

function enemySide(side: Side): Side {
  return side === "player" ? "opponent" : "player";
}

function unitName(unit: BattleUnit): string {
  return ANIMAL_BY_ID[unit.speciesId].nameZh;
}

function addEvent(ctx: BattleContext, event: Omit<BattleEvent, "eventId" | "sequence">): void {
  ctx.sequence += 1;
  ctx.events.push({ eventId: `evt_${ctx.sequence}`, sequence: ctx.sequence, ...event });
}

function sideUnits(player: BattleUnit[], opponent: BattleUnit[], side: Side): BattleUnit[] {
  return side === "player" ? player : opponent;
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
    case "allyLowestHealth": return one(allies.filter((unit) => unit.unitId !== source.unitId).sort((a, b) => a.health - b.health || a.position - b.position)[0]);
    case "allAllies": return allies.filter((unit) => unit.unitId !== source.unitId);
    case "randomAlly": return allies.length ? [ctx.rng.pick(allies)] : [];
    case "enemyFront": return one(enemies[0]);
    case "enemyBack": return one(enemies[enemies.length - 1]);
    case "enemyLowestHealth": return one([...enemies].sort((a, b) => a.health - b.health || a.position - b.position)[0]);
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
      addEvent(ctx, { type: "shieldAbsorbed", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount: blocked, before: beforeShield, after: target.shield, messageZh: `${unitName(target)}的护盾吸收 ${blocked} 点伤害。`, metadata: { damageKind: intent.kind } });
    }
    const before = target.health;
    if (remaining > 0) target.health -= remaining;
    if (source && remaining > 0) ctx.contribution.byUnitId[source.unitId].damageDealt += remaining;
    ctx.contribution.maxSingleDamage = Math.max(ctx.contribution.maxSingleDamage, remaining);
    if (remaining > 0) addEvent(ctx, { type: "damageApplied", sourceUnitId: source?.unitId, targetUnitId: target.unitId, side: target.side, amount: remaining, before, after: target.health, messageZh: `${unitName(target)}受到 ${remaining} 点${intent.kind === "normalAttack" ? "普通" : "技能"}伤害。`, metadata: { damageKind: intent.kind } });
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

function applyEffect(effect: EffectDef, source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, attacker?: BattleUnit): void {
  if (source.retreated || source.health <= 0) {
    addEvent(ctx, { type: "abilitySourceUnavailable", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}已经退场，排队技能失效。`, metadata: { effect } });
    return;
  }
  if (effect.kind === "moveSelf") {
    const allies = active(sideUnits(player, opponent, source.side));
    const from = allies.findIndex((unit) => unit.unitId === source.unitId);
    const to = Math.max(0, Math.min(allies.length - 1, from + effect.offset));
    if (from < 0 || to === from) {
      addEvent(ctx, { type: "abilityNoTarget", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}尝试移动，但队列没有变化。`, metadata: { effect } });
      return;
    }
    const promoted = effect.offset > 0 ? allies[from + 1] : allies[to];
    const reordered = [...allies];
    reordered.splice(from, 1);
    reordered.splice(to, 0, source);
    const positions = allies.map((unit) => unit.position).sort((a, b) => a - b);
    reordered.forEach((unit, index) => { unit.position = positions[index]; });
    ctx.contribution.byUnitId[source.unitId].usefulMoves += 1;
    addEvent(ctx, { type: "unitMoved", sourceUnitId: source.unitId, side: source.side, before: positions[from], after: positions[to], messageZh: `${unitName(source)}跃至后位。`, metadata: { fromOrder: from, toOrder: to } });
    if (promoted && effect.buffPromotedAllyAttack) modifyAttack(promoted, effect.buffPromotedAllyAttack, source, ctx, `${unitName(source)}跃至后位，${unitName(promoted)}补到前方并获得 +${effect.buffPromotedAllyAttack} 攻击。`);
    return;
  }
  const targets = selectTargets(effect.target, source, player, opponent, ctx, attacker);
  if (targets.length === 0) {
    addEvent(ctx, { type: "abilityNoTarget", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}的技能没有合适目标。`, metadata: { effect } });
    return;
  }
  for (const target of targets) {
    if (effect.kind === "dealDamage") {
      const results = applyDamageBatch(player, opponent, [{ sourceUnitId: source.unitId, targetUnitId: target.unitId, amount: effect.amount, kind: "ability" }], ctx);
      for (const result of results.filter((item) => item.triggersOnHurt)) {
        const hurt = findUnit(player, opponent, result.targetUnitId);
        if (hurt) triggerAbility("onHurt", hurt, player, opponent, ctx, source);
      }
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
}

function triggerAbility(trigger: Trigger, source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext, attacker?: BattleUnit): void {
  if ((source.retreated || source.health <= 0) && trigger !== "selfRetreat") return;
  const ability = ANIMAL_BY_ID[source.speciesId].ability.levels[source.level - 1];
  if (ability.trigger !== trigger) return;
  const current = source.triggerCounts[trigger] ?? 0;
  if (ability.maxTriggersPerBattle !== undefined && current >= ability.maxTriggersPerBattle) return;
  source.triggerCounts[trigger] = current + 1;
  ctx.contribution.byUnitId[source.unitId].abilityTriggers += 1;
  addEvent(ctx, { type: "abilityTriggered", sourceUnitId: source.unitId, side: source.side, messageZh: `${unitName(source)}触发${ANIMAL_BY_ID[source.speciesId].ability.nameZh}。`, metadata: { trigger } });
  for (const effect of ability.effects) applyEffect(effect, source, player, opponent, ctx, attacker);
}

function processRetreats(player: BattleUnit[], opponent: BattleUnit[], ctx: BattleContext): void {
  const newly = allUnits(player, opponent)
    .filter((unit) => !unit.retreated && unit.health <= 0)
    .sort((a, b) => a.position - b.position || (a.side === "player" ? -1 : 1));
  if (!newly.length) return;
  for (const unit of newly) {
    unit.retreated = true;
    addEvent(ctx, { type: "unitRetreated", sourceUnitId: unit.unitId, side: unit.side, messageZh: `${unitName(unit)}退出本次遭遇。`, metadata: {} });
    triggerAbility("selfRetreat", unit, player, opponent, ctx);
  }
  for (const retreated of newly) {
    const allies = active(sideUnits(player, opponent, retreated.side)).filter((ally) => ally.unitId !== retreated.unitId);
    for (const ally of allies) triggerAbility("allyRetreat", ally, player, opponent, ctx);
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

function triggerEquipmentStart(source: BattleUnit, player: BattleUnit[], opponent: BattleUnit[], input: BattleInput, ctx: BattleContext): void {
  const snapshot = (source.side === "player" ? input.playerTeam : input.opponentTeam).units.find((unit) => unit.position === source.position);
  if (!snapshot?.equipmentEffect?.battleStartDamage) return;
  const enemies = active(sideUnits(player, opponent, enemySide(source.side)));
  if (!enemies.length) return;
  const target = ctx.rng.pick(enemies);
  addEvent(ctx, { type: "equipmentTriggered", sourceUnitId: source.unitId, targetUnitId: target.unitId, side: source.side, messageZh: `${unitName(source)}的装备松果弹弓触发。`, metadata: { itemId: snapshot.equipmentEffect.itemId } });
  const results = applyDamageBatch(player, opponent, [{ sourceUnitId: source.unitId, targetUnitId: target.unitId, amount: snapshot.equipmentEffect.battleStartDamage, kind: "equipment" }], ctx);
  for (const result of results.filter((item) => item.triggersOnHurt)) {
    const hurt = findUnit(player, opponent, result.targetUnitId);
    if (hurt) triggerAbility("onHurt", hurt, player, opponent, ctx, source);
  }
}

export function resolveBattle(input: BattleInput): BattleOutput {
  const player = createBattleUnits(input, "player");
  const opponent = createBattleUnits(input, "opponent");
  const ctx: BattleContext = {
    rng: createRng(input.seed),
    events: [],
    sequence: 0,
    diagnostics: [],
    contribution: emptyContribution([...player, ...opponent]),
  };
  addEvent(ctx, { type: "battleStarted", messageZh: "双方进入遭遇。", metadata: { seed: input.seed, battleId: input.battleId } });
  applyEnvironment(input, player, opponent, ctx);
  const maxSlots = Math.max(0, ...player.map((unit) => unit.position + 1), ...opponent.map((unit) => unit.position + 1));
  for (let i = 0; i < maxSlots; i += 1) {
    const playerAtSlot = player.find((unit) => unit.position === i);
    const opponentAtSlot = opponent.find((unit) => unit.position === i);
    if (playerAtSlot) triggerEquipmentStart(playerAtSlot, player, opponent, input, ctx);
    processRetreats(player, opponent, ctx);
    if (opponentAtSlot) triggerEquipmentStart(opponentAtSlot, player, opponent, input, ctx);
    processRetreats(player, opponent, ctx);
    if (playerAtSlot) triggerAbility("battleStart", playerAtSlot, player, opponent, ctx);
    processRetreats(player, opponent, ctx);
    if (opponentAtSlot) triggerAbility("battleStart", opponentAtSlot, player, opponent, ctx);
    processRetreats(player, opponent, ctx);
  }
  let exchanges = 0;
  let result = resultOf(player, opponent);
  while (!result && exchanges < 100 && ctx.events.length < 1000) {
    exchanges += 1;
    const pOriginal = active(player)[0];
    const oOriginal = active(opponent)[0];
    if (!pOriginal || !oOriginal) break;
    const pCan = canAttack(pOriginal);
    const oCan = canAttack(oOriginal);
    if (pCan) {
      addEvent(ctx, { type: "attackWindup", sourceUnitId: pOriginal.unitId, side: "player", messageZh: `${unitName(pOriginal)}准备普通攻击。`, metadata: {} });
      triggerAbility("beforeAttack", pOriginal, player, opponent, ctx);
    } else addEvent(ctx, { type: "attackSkipped", sourceUnitId: pOriginal.unitId, side: "player", messageZh: `${unitName(pOriginal)}正在睡眠，跳过攻击。`, metadata: {} });
    processRetreats(player, opponent, ctx);
    if (oCan) {
      addEvent(ctx, { type: "attackWindup", sourceUnitId: oOriginal.unitId, side: "opponent", messageZh: `${unitName(oOriginal)}准备普通攻击。`, metadata: {} });
      triggerAbility("beforeAttack", oOriginal, player, opponent, ctx);
    } else addEvent(ctx, { type: "attackSkipped", sourceUnitId: oOriginal.unitId, side: "opponent", messageZh: `${unitName(oOriginal)}正在睡眠，跳过攻击。`, metadata: {} });
    processRetreats(player, opponent, ctx);
    result = resultOf(player, opponent);
    if (result) break;
    const intents: DamageIntent[] = [];
    if (pCan && !pOriginal.retreated && pOriginal.health > 0 && canAttack(pOriginal)) intents.push({ sourceUnitId: pOriginal.unitId, targetUnitId: active(opponent)[0].unitId, amount: normalAttackDamage(pOriginal, ctx), kind: "normalAttack", simultaneousGroupId: `x${exchanges}` });
    if (oCan && !oOriginal.retreated && oOriginal.health > 0 && canAttack(oOriginal)) intents.push({ sourceUnitId: oOriginal.unitId, targetUnitId: active(player)[0].unitId, amount: normalAttackDamage(oOriginal, ctx), kind: "normalAttack", simultaneousGroupId: `x${exchanges}` });
    if (!intents.length) {
      ctx.diagnostics.push("no attackers available");
      result = "draw";
      break;
    }
    addEvent(ctx, { type: "attackExchange", sourceUnitId: intents[0].sourceUnitId, targetUnitId: intents[0].targetUnitId, messageZh: "前排进行普通攻击交换。", metadata: { count: intents.length } });
    const results = applyDamageBatch(player, opponent, intents, ctx);
    for (const damage of results.filter((item) => item.triggersOnHurt)) {
      const target = findUnit(player, opponent, damage.targetUnitId);
      const source = damage.sourceUnitId ? findUnit(player, opponent, damage.sourceUnitId) : undefined;
      if (target) triggerAbility("onHurt", target, player, opponent, ctx, source);
    }
    processRetreats(player, opponent, ctx);
    if (intents.some((intent) => intent.sourceUnitId === pOriginal.unitId) && !pOriginal.retreated && pOriginal.health > 0) triggerAbility("afterAttack", pOriginal, player, opponent, ctx);
    if (intents.some((intent) => intent.sourceUnitId === oOriginal.unitId) && !oOriginal.retreated && oOriginal.health > 0) triggerAbility("afterAttack", oOriginal, player, opponent, ctx);
    processRetreats(player, opponent, ctx);
    result = resultOf(player, opponent);
  }
  if (!result) {
    result = resultOf(player, opponent) ?? "draw";
    ctx.diagnostics.push("safety cap reached or unresolved battle");
    addEvent(ctx, { type: "safetyCapReached", messageZh: "战斗达到安全上限，按平局记录。", metadata: { exchanges, eventCount: ctx.events.length } });
  }
  ctx.contribution.longestSkillChain = longestAbilityChain(ctx.events);
  recomputeTotals(ctx.contribution);
  ctx.contribution.highlight = makeHighlight(result, ctx.contribution);
  addEvent(ctx, { type: "battleEnded", messageZh: `遭遇结束：${result === "win" ? "我方获得远征章" : result === "loss" ? "士气下降" : "双方暂时分开"}。`, metadata: { result } });
  return { result, events: ctx.events, finalPlayerUnits: player, finalOpponentUnits: opponent, contribution: ctx.contribution, diagnostics: ctx.diagnostics };
}

function makeHighlight(result: BattleResult, contribution: ContributionSummary): string {
  const mvp = contribution.mvpUnitId ? contribution.byUnitId[contribution.mvpUnitId] : undefined;
  if (!mvp) return result === "win" ? "队伍稳稳拿下一枚远征章。" : "队伍记录了这次遭遇的线索。";
  return `${ANIMAL_BY_ID[mvp.speciesId].nameZh}贡献最高，${result === "win" ? "帮助队伍拿下一枚远征章" : result === "draw" ? "帮助队伍守住阵脚" : "留下关键观察"}。`;
}
