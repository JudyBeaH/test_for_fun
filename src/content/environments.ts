import type { EnvironmentId } from "../domain/types";

export interface EnvironmentDef {
  id: EnvironmentId;
  nameZh: string;
  ruleZh: string;
}

export const ENVIRONMENTS: readonly EnvironmentDef[] = [
  { id: "wetland_channel", nameZh: "湿地水道", ruleZh: "双方最前方的水域动物获得 +2 体力。" },
  { id: "meadow", nameZh: "草甸", ruleZh: "双方最前方的地表动物获得 +1 攻击和 +1 护盾。" },
  { id: "canopy", nameZh: "林冠", ruleZh: "双方最后方的空中动物使本方前排获得 +1 攻击。" },
] as const;

export const ENVIRONMENT_BY_ID = Object.fromEntries(ENVIRONMENTS.map((environment) => [environment.id, environment])) as Record<EnvironmentId, EnvironmentDef>;
