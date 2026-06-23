import type { CONTENT_VERSION, ENGINE_VERSION, REGION_ID } from "../content/constants";

export type Habitat = "water" | "land" | "air";
export type Side = "player" | "opponent";
export type BattleResult = "win" | "loss" | "draw";
export type ExpeditionStatus = "active" | "success" | "returned";
export type ExpeditionPhase =
  | "camp"
  | "upgradeDiscovery"
  | "battlePreparing"
  | "battlePlayback"
  | "battleReport"
  | "successResolution"
  | "returnResolution"
  | "completed";

export type Trigger = "battleStart" | "beforeAttack" | "afterAttack" | "onHurt" | "allyRetreat" | "selfRetreat";
export type EnvironmentId = "wetland_channel" | "meadow" | "canopy";
export type RewardCategory = "companionMark" | "unknownTrace" | "habitatSeed";
export type SpeciesId =
  | "hedgehog"
  | "frog"
  | "mussel"
  | "swallow"
  | "otter"
  | "hare"
  | "kingfisher"
  | "carp"
  | "crow"
  | "pangolin"
  | "egret"
  | "weasel";
export type ItemId = "red_berry" | "river_moss" | "bond_nut" | "pinecone_sling" | "bitter_root" | "melatonin";

export type TargetSelector =
  | "self"
  | "allyFront"
  | "allyBack"
  | "allyBehindSelf"
  | "allyAheadSelf"
  | "allyLowestHealth"
  | "allAllies"
  | "randomAlly"
  | "enemyFront"
  | "enemyBack"
  | "enemyLowestHealth"
  | "randomEnemy"
  | "attacker";

export type BattleStatus =
  | { kind: "sleeping" }
  | { kind: "empoweredNormalAttacks"; remaining: number; bonusDamage: number }
  | { kind: "cannotAttack"; remainingExchanges: number };

export type BattleStatusDef = BattleStatus;

export type EffectDef =
  | { kind: "dealDamage"; target: TargetSelector; amount: number }
  | { kind: "modifyAttack"; target: TargetSelector; amount: number }
  | { kind: "modifyHealth"; target: TargetSelector; amount: number }
  | { kind: "gainShield"; target: TargetSelector; amount: number }
  | { kind: "reduceAttack"; target: TargetSelector; amount: number }
  | { kind: "moveSelf"; offset: number; buffPromotedAllyAttack?: number }
  | { kind: "applyBattleStatus"; target: TargetSelector; status: BattleStatusDef };

export interface AbilityLevelDef {
  trigger: Trigger;
  effects: readonly EffectDef[];
  maxTriggersPerBattle?: number;
}

export interface AbilityDef {
  nameZh: string;
  descriptionByLevel: readonly [string, string, string];
  levels: readonly [AbilityLevelDef, AbilityLevelDef, AbilityLevelDef];
}

export type CampModifier =
  | { kind: "modifyBaseSupply"; amount: number }
  | { kind: "modifySupplyCap"; amount: number }
  | { kind: "modifyCarryLimit"; amount: number }
  | { kind: "modifyRefreshCost"; amount: number }
  | { kind: "grantFreeRefreshes"; amount: number }
  | { kind: "modifyAnimalOfferSlots"; amount: number; max?: number }
  | { kind: "modifyItemOfferSlots"; amount: number; max?: number }
  | { kind: "grantSupplyOnCampEnter"; amount: number }
  | { kind: "grantSupplyOnLevelUp"; amount: number };

export type LevelUpRewardEffect =
  | { kind: "gainSupply"; amount: number }
  | { kind: "gainFreeRefresh"; amount: number }
  | { kind: "createItem"; itemId: ItemId }
  | { kind: "buffSelfPermanent"; attack?: number; health?: number };

export interface AnimalDef {
  id: SpeciesId;
  nameZh: string;
  tier: 1 | 2 | 3;
  habitats: readonly Habitat[];
  baseAttack: number;
  baseHealth: number;
  levelAttackBonus: readonly [number, number, number];
  levelHealthBonus: readonly [number, number, number];
  ability: AbilityDef;
  campModifiers?: readonly CampModifier[];
  levelUpRewards?: readonly LevelUpRewardEffect[];
  visual: { emoji: string; fallbackGlyph: string };
}

export type ItemKind = "equipment" | "food";
export type ItemTargetScope = { kind: "singleUnit" } | { kind: "habitat"; habitat: Habitat } | { kind: "allOwned" };
export type EffectDuration =
  | { kind: "permanent" }
  | { kind: "nextParticipatingBattle" }
  | { kind: "participatingBattles"; count: number }
  | { kind: "untilTriggered" };

export type ItemEffectDef =
  | { kind: "modifyPermanentAttack"; amount: number }
  | { kind: "modifyPermanentHealth"; amount: number }
  | { kind: "modifyBondXp"; amount: number }
  | { kind: "attachStatus"; status: StatusDef; duration: EffectDuration }
  | { kind: "battleStartDamage"; target: "randomEnemy"; amount: number }
  | { kind: "modifyInitialAttack"; amount: number }
  | { kind: "modifyInitialHealth"; amount: number }
  | { kind: "afterDurationPermanentBuff"; attack?: number; health?: number };

export type StatusDef =
  | {
      kind: "sleepThenEmpower";
      remainingParticipatingBattles: 1;
      sleeping: true;
      bonusDamagePerAttack: 5;
      bonusAttackChargesAfterWake: 3;
    }
  | {
      kind: "participationDebuffThenBuff";
      remainingParticipatingBattles: number;
      initialAttackModifier: number;
      afterDurationPermanentBuff: { attack?: number; health?: number };
    };

export interface ItemDef {
  id: ItemId;
  nameZh: string;
  kind: ItemKind;
  price: number;
  targetScope: ItemTargetScope;
  descriptionZh: string;
  effects: readonly ItemEffectDef[];
}

export interface EquipmentInstance {
  instanceId: string;
  itemId: ItemId;
}

export interface ItemInstance {
  instanceId: string;
  itemId: ItemId;
}

export interface TimedStatus {
  statusId: string;
  def: StatusDef;
}

export interface TeamMember {
  instanceId: string;
  speciesId: SpeciesId;
  bondXp: number;
  permanentAttackBonus: number;
  permanentHealthBonus: number;
  equipment: EquipmentInstance | null;
  timedStatuses: TimedStatus[];
  acquiredAtRound: number;
  participatedRounds: number;
}

export type UnitId = string;
export type ItemInstanceId = string;
export type OfferId = string;
export type Fixed5<T> = [T, T, T, T, T];
export type Fixed3<T> = [T, T, T];
export type Fixed2<T> = [T, T];

export interface AnimalOffer {
  offerInstanceId: OfferId;
  speciesId: SpeciesId;
}

export interface ItemOffer {
  offerInstanceId: OfferId;
  itemId: ItemId;
}

export interface OfferSlot<T> {
  slotId: string;
  kind: "animal" | "item";
  unlocked: boolean;
  held: boolean;
  offer: T | null;
}

export interface CampState {
  campId: string;
  campLevel: 1 | 2 | 3;
  supply: number;
  freeRefreshes: number;
  animalOffers: Fixed5<OfferSlot<AnimalOffer>>;
  itemOffers: Fixed2<OfferSlot<ItemOffer>>;
  lastSaveMessage?: string;
}

export interface ComputedCampRules {
  campLevel: 1 | 2 | 3;
  animalOfferSlots: number;
  itemOfferSlots: number;
  maxAnimalTier: 1 | 2 | 3;
  animalTierWeights: Record<1 | 2 | 3, number>;
  baseSupply: number;
  supplyCap: number;
  recruitCost: number;
  refreshCost: number;
  releaseRefund: number;
  carrySupplyLimit: number;
  freeRefreshes: number;
  reserveCapacity: number;
  inventoryCapacity: number;
}

export interface UpgradeDiscovery {
  discoveryId: string;
  sourceInstanceId: string;
  targetTier: 1 | 2 | 3;
  candidates: SpeciesId[];
}

export interface NormalizedEquipmentEffect {
  itemId: ItemId;
  initialAttackBonus: number;
  initialHealthBonus: number;
  battleStartDamage?: number;
}

export interface StartingStatusSnapshot {
  statusId: string;
  def: StatusDef;
}

export interface TeamSnapshotUnit {
  snapshotUnitId: string;
  speciesId: SpeciesId;
  position: number;
  bondXp: number;
  level: 1 | 2 | 3;
  initialAttack: number;
  initialMaxHealth: number;
  equipmentEffect: NormalizedEquipmentEffect | null;
  startingStatuses: readonly StartingStatusSnapshot[];
}

export interface TeamSnapshot {
  units: readonly TeamSnapshotUnit[];
}

export interface PendingBattle {
  battleId: string;
  status: "prepared" | "resolved";
  input: BattleInput;
  output: BattleOutput | null;
  settlementApplied: boolean;
  playbackCursor: number;
}

export interface BattleRecord {
  battleId: string;
  input: BattleInput;
  output: BattleOutput;
}

export interface FinalVictoryRecord {
  battleId: string;
  input: BattleInput;
  output: BattleOutput;
  playerPreBattleSnapshot: TeamSnapshot;
}

export interface ExpeditionStats {
  battlesWon: number;
  battlesLost: number;
  battlesDrawn: number;
  animalRounds: Partial<Record<SpeciesId, number>>;
  animalContribution: Partial<Record<SpeciesId, number>>;
  mvpSpeciesId?: SpeciesId;
  maxSingleDamage: number;
  longestSkillChain: number;
  highlight: string;
  upgradeDiscoveries: number;
  merges: number;
}

export interface ExpeditionState {
  runId: string;
  expeditionSeed: number;
  phase: ExpeditionPhase;
  round: number;
  badges: number;
  morale: number;
  camp: CampState | null;
  unitsById: Record<UnitId, TeamMember>;
  itemsById: Record<ItemInstanceId, ItemInstance>;
  formation: Fixed5<UnitId | null>;
  reserve: Fixed3<UnitId | null>;
  inventory: Fixed3<ItemInstanceId | null>;
  pendingRecruit: TeamMember | null;
  pendingDiscoveries: UpgradeDiscovery[];
  pendingBattle: PendingBattle | null;
  battleHistory: BattleRecord[];
  finalVictoryRecord: FinalVictoryRecord | null;
  stats: ExpeditionStats;
}

export type UnitSlotRef =
  | { zone: "formation"; slot: 0 | 1 | 2 | 3 | 4 }
  | { zone: "reserve"; slot: 0 | 1 | 2 };

export type ItemSlotRef = { zone: "inventory"; slot: 0 | 1 | 2 };

export type ItemTarget = { kind: "units"; unitIds: UnitId[] };

export type CampCommand =
  | { type: "toggleHold"; slotKind: "animal" | "item"; offerId: OfferId; expectedRevision?: number }
  | { type: "refresh"; expectedRevision?: number }
  | { type: "moveUnit"; unitId: UnitId; to: UnitSlotRef; expectedRevision?: number }
  | { type: "mergeUnits"; sourceUnitId: UnitId; targetUnitId: UnitId; expectedRevision?: number }
  | { type: "recruitAnimal"; offerId: OfferId; to: UnitSlotRef; expectedRevision?: number }
  | { type: "recruitAndMerge"; offerId: OfferId; targetUnitId: UnitId; expectedRevision?: number }
  | { type: "releaseUnit"; unitId: UnitId; expectedRevision?: number }
  | { type: "moveItem"; itemInstanceId: ItemInstanceId; to: ItemSlotRef; expectedRevision?: number }
  | { type: "purchaseItemToInventory"; offerId: OfferId; to: ItemSlotRef; expectedRevision?: number }
  | { type: "purchaseAndApplyItem"; offerId: OfferId; target: ItemTarget; expectedRevision?: number }
  | { type: "applyInventoryItem"; itemInstanceId: ItemInstanceId; target: ItemTarget; discardOld?: boolean; expectedRevision?: number }
  | { type: "chooseDiscovery"; discoveryId: string; speciesId: SpeciesId; expectedRevision?: number }
  | { type: "chooseDiscoveryToSlot"; discoveryId: string; speciesId: SpeciesId; to: UnitSlotRef; expectedRevision?: number }
  | { type: "chooseDiscoveryAndMerge"; discoveryId: string; speciesId: SpeciesId; targetUnitId: UnitId; expectedRevision?: number }
  | { type: "chooseDiscoverySupply"; discoveryId: string; expectedRevision?: number }
  | { type: "discardPendingRecruit"; expectedRevision?: number }
  | { type: "placePendingRecruit"; to: UnitSlotRef; replaceUnitId?: UnitId; expectedRevision?: number };

export interface CampTransition {
  state: ExpeditionState;
  command: CampCommand;
}

export interface BattleUnit {
  unitId: string;
  side: Side;
  speciesId: SpeciesId;
  level: 1 | 2 | 3;
  attack: number;
  health: number;
  maxHealth: number;
  shield: number;
  position: number;
  triggerCounts: Partial<Record<Trigger, number>>;
  statuses: BattleStatus[];
  retreated: boolean;
}

export interface BattleInput {
  battleId: string;
  playerTeam: TeamSnapshot;
  opponentTeam: TeamSnapshot;
  environmentId: EnvironmentId;
  seed: number;
  engineVersion: typeof ENGINE_VERSION | string;
  contentVersion: typeof CONTENT_VERSION | string;
}

export type BattleEventType =
  | "battleStarted"
  | "environmentApplied"
  | "equipmentTriggered"
  | "abilityTriggered"
  | "abilityNoTarget"
  | "abilitySourceUnavailable"
  | "statusApplied"
  | "statusConsumed"
  | "statusExpired"
  | "attackWindup"
  | "attackSkipped"
  | "attackExchange"
  | "damageApplied"
  | "shieldAbsorbed"
  | "statModified"
  | "unitMoved"
  | "unitRetreated"
  | "lineCompacted"
  | "battleEnded"
  | "safetyCapReached";

export interface BattleEvent {
  eventId: string;
  sequence: number;
  type: BattleEventType;
  sourceUnitId?: string;
  targetUnitId?: string;
  side?: Side;
  amount?: number;
  before?: unknown;
  after?: unknown;
  messageZh: string;
  metadata: Record<string, unknown>;
}

export interface DamageIntent {
  sourceUnitId?: string;
  targetUnitId: string;
  amount: number;
  kind: "normalAttack" | "ability" | "equipment" | "environment";
  simultaneousGroupId?: string;
}

export interface DamageResult {
  sourceUnitId?: string;
  targetUnitId: string;
  inputDamage: number;
  shieldAbsorbed: number;
  actualHealthLost: number;
  healthBefore: number;
  healthAfter: number;
  survived: boolean;
  triggersOnHurt: boolean;
}

export interface ContributionSummary {
  byUnitId: Record<string, {
    speciesId: SpeciesId;
    side: Side;
    damageDealt: number;
    damageBlocked: number;
    positiveStatsGranted: number;
    enemyAttackReduced: number;
    abilityTriggers: number;
    usefulMoves: number;
    total: number;
  }>;
  mvpUnitId?: string;
  maxSingleDamage: number;
  longestSkillChain: number;
  highlight: string;
}

export interface BattleOutput {
  result: BattleResult;
  events: BattleEvent[];
  finalPlayerUnits: BattleUnit[];
  finalOpponentUnits: BattleUnit[];
  contribution: ContributionSummary;
  diagnostics: string[];
}

export interface DomainResult<T> {
  ok: boolean;
  state: T;
  messageZh: string;
}

export interface RewardChoice {
  id: string;
  category: RewardCategory;
  titleZh: string;
  descriptionZh: string;
  speciesId?: SpeciesId;
}

export interface RegisteredTeam {
  teamId: string;
  name: string;
  sourceRunId: string;
  sourceBattleId: string;
  createdAtIso: string;
  regionId: typeof REGION_ID;
  badges: 10;
  lineupSnapshot: TeamSnapshot;
  finalBattleEnvironmentId: EnvironmentId;
  finalBattleSeed: number;
  engineVersion: string;
  contentVersion: string;
  highlight: string;
}

export interface ChallengeRecord {
  teamId: string;
  challengedAtIso: string;
  result: BattleResult;
  earnedWildFruit: boolean;
  honorStamp: boolean;
}

export interface AppSave {
  schemaVersion: 3;
  saveRevision: number;
  activeExpedition: ExpeditionState | null;
  collection: Record<SpeciesId, {
    seen: boolean;
    memory: number;
    traceProgress: number;
    journalUnlocked: boolean;
    adopted: boolean;
  }>;
  habitatSeeds: number;
  wildFruit: number;
  unlockedCosmetics: string[];
  registeredTeams: RegisteredTeam[];
  challengedTeamIds: string[];
  challengeHistory: ChallengeRecord[];
  settings: {
    battleSpeed: 0.5 | 1 | 2 | 4;
    reduceMotion: boolean;
    soundEnabled: boolean;
  };
}
