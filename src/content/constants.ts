export const ENGINE_VERSION = "0.2.0-prototype";
export const CONTENT_VERSION = "0.2.0-prototype";
export const REGION_ID = "jiangnan_wetland" as const;
export const REGION_NAME_ZH = "江南湿地";

export const DEFAULT_CAMP_ECONOMY = {
  baseSupply: 10,
  supplyCap: 10,
  recruitCost: 3,
  refreshCost: 1,
  releaseRefund: 1,
  reserveCapacity: 1,
  inventoryCapacity: 1,
  itemOfferSlots: 2,
  carrySupplyLimit: 0,
  freeRefreshes: 0,
} as const;

export const INITIAL_EXPEDITION = {
  badges: 0,
  morale: 4,
  round: 1,
  phase: "camp" as const,
} as const;
