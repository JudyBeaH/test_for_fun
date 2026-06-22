# AGENTS.md — Project Wildtrail v0.3 稳定性重构规格

> 本文件用于替换或暂时覆盖仓库当前的开发指令。  
> 当前任务不是从零重写，也不是立刻迁移 Cocos。  
> Codex 必须在现有 `JudyBeaH/test_for_fun` 工程上按阶段重构。  
> 所有产品新增要求以本文为准；未明确修改的 v0.2 规则继续保留。

---

## 0. 执行契约

1. 先阅读：
   - 本文件；
   - `PROJECT_IMPLEMENTATION.md`；
   - 当前 `src/domain`、`src/app/App.tsx` 和全部测试。
2. 新建分支，建议：`refactor/v0.3-stability`.
3. 不要一次完成全部范围。严格按 P0–P7 顺序，每阶段独立提交。
4. 每阶段完成后运行：
   ```bash
   npm run test
   npm run lint
   npm run build
   ```
5. P5、P6 结束后额外运行：
   ```bash
   npm run sim -- --runs 10000 --seed 20260620
   ```
6. 不得删除失败测试来“修复”构建。
7. 不得把领域规则写入 React 组件、CSS 或动画回调。
8. 不得使用外部版权图片、Super Auto Pets 资源或其具体 UI 素材。
9. 如果某阶段需要改变存档结构，必须增加 schema version 和迁移测试。
10. 完成汇报必须列出真实命令结果、提交、已知限制和仍未通过项。

---

## 1. v0.3 目标

必须解决：

- 十胜后卡住、无法进入成功结算和登记；
- 邂逅位、战斗位、替补位之间拖放卡住；
- 动物偶发消失、复制、目标空位未按预期填充；
- 拖拽和单击行为不一致；
- 仓库物品不能自然拖出使用；
- 单体、族群、全体食物缺少统一目标设计；
- 双方战斗开始和攻击前技能过度串行；
- 战斗位置模型无法支持跨阵营换位；
- 表现代码与规则语义仍不够解耦；
- 动物扩充至 25 只和 Tier 5；
- 回合 2、4、6、8 分别升级至 T2、T3、T4、T5；
- 简单杭州江南湿地占位美术和基础动画。

非目标：

- 微信 SDK、登录、支付、广告、后端；
- 正式商用美术和音效；
- 大地图、探险事件、家园、公会；
- 实时 PvP；
- Cocos 正式迁移；
- 复杂 3D。

---

## 2. 必须保留的已有优点

- 领域层不依赖 React、DOM、storage 或网络；
- 所有随机行为使用种子 RNG；
- 战斗输入在出发时固定；
- 战斗输出为确定性的事件序列；
- UI 播放事件，不重新计算规则；
- 自动保存和 staging/commit 仓储；
- 重复物种可共存，合成由玩家主动触发；
- 满级不能合成；
- 装备和永久属性进入战前快照，战斗临时属性不回写。

---

# P0 — 仓库清理和基线

## P0.1 清理

- 将 `node_modules/`、`dist/`、`*.tsbuildinfo` 从 Git 跟踪中移除；
- 更新 `.gitignore`；
- 保留 `package-lock.json`；
- 不修改玩法。

## P0.2 CI

增加 `.github/workflows/ci.yml`：

```text
npm ci
npm run test
npm run lint
npm run build
```

## P0.3 基线记录

在 `artifacts/v0.2-baseline.md` 记录：

- commit；
- 测试数；
- 模拟摘要；
- 已知 Bug；
- 当前存档 schema。

### P0 完成条件

- clean clone 后 `npm ci` 可工作；
- 三个检查命令通过；
- 无生成目录被跟踪。

---

# P1 — 修复十胜终局状态机

## P1.1 单一页面来源

`phase` 是页面路由的唯一事实。

禁止：

```ts
if (expedition.pendingBattle) return "battle";
```

优先使用穷尽式 phase switch。

## P1.2 清理 pending battle

`finishBattleReport()`：

- 若进入 `successResolution` 或 `returnResolution`，必须先把最终战归档并清空 `pendingBattle`；
- `finalVictoryRecord` 保留；
- 终局 phase 不允许存在 pendingBattle。

## P1.3 成功提交服务

实现纯领域函数：

```ts
completeSuccessResolution(input): DomainResult<{
  savePatch: ...
  registeredTeam: RegisteredTeam
}>
```

一次验证并产出：

- 10 枚远征章；
- 最终胜利记录存在；
- 领养目标在第十胜战前快照中；
- 两个奖励合法且不重复；
- 队伍名；
- 登记队伍；
- 最终战前永久属性、等级、装备、位置、环境、挑战种子；
- 不含临时攻血盾；
- 结束 active expedition。

应用层一次事务保存。

## P1.4 测试

新增端到端领域测试：

```text
9 badges
→ prepare battle
→ win
→ settle
→ finish report
→ phase successResolution
→ pendingBattle null
→ complete success
→ registered team exists
→ active expedition cleared
```

### P1 完成条件

真实 UI 中十胜能：

- 显示成功页；
- 领养；
- 选择两项奖励；
- 命名并登记；
- 进入冠军陈列或主页。

---

# P2 — 固定槽位和原子 CampCommand

## P2.1 数据结构

战斗队固定 5 格，替补固定 3 格，仓库固定 3 格：

```ts
type Fixed5<T> = readonly [T, T, T, T, T];
type Fixed3<T> = readonly [T, T, T];

interface CampState {
  unitsById: Record<UnitId, TeamMember>;
  itemsById: Record<ItemInstanceId, ItemInstance>;

  formation: Fixed5<UnitId | null>;
  reserve: Fixed3<UnitId | null>;
  inventory: Fixed3<ItemInstanceId | null>;

  animalOffers: Fixed5<AnimalOffer | null>;
  itemOffers: readonly [ItemOffer | null, ItemOffer | null];

  // existing data...
}
```

锁定未开放市场格仍有固定 slot，只是不可用。

禁止把 reserve 和 inventory 建模为会自动压缩的 dense array。

## P2.2 稳定引用

```ts
type UnitSlotRef =
  | { zone: "formation"; slot: 0|1|2|3|4 }
  | { zone: "reserve"; slot: 0|1|2 };

type ItemSlotRef =
  | { zone: "inventory"; slot: 0|1|2 };
```

选择状态只能保存：

```ts
{ kind: "unit"; unitId }
{ kind: "animalOffer"; offerId }
{ kind: "itemOffer"; offerId }
{ kind: "inventoryItem"; itemInstanceId }
```

不能把 area/index 作为实体身份。

## P2.3 CampCommand

实现一个入口：

```ts
applyCampCommand(state, command): DomainResult<CampTransition>
```

命令至少包含：

```ts
type CampCommand =
  | { type: "moveUnit"; unitId: UnitId; to: UnitSlotRef }
  | { type: "mergeUnits"; sourceUnitId: UnitId; targetUnitId: UnitId }
  | { type: "recruitAnimal"; offerId: OfferId; to: UnitSlotRef }
  | { type: "recruitAndMerge"; offerId: OfferId; targetUnitId: UnitId }
  | { type: "releaseUnit"; unitId: UnitId }
  | { type: "moveItem"; itemInstanceId: ItemInstanceId; to: ItemSlotRef }
  | { type: "purchaseItemToInventory"; offerId: OfferId; to: ItemSlotRef }
  | { type: "purchaseAndApplyItem"; offerId: OfferId; target: ItemTarget }
  | { type: "applyInventoryItem"; itemInstanceId: ItemInstanceId; target: ItemTarget };
```

现有其他命令可逐步迁移，但 UI 不得再直接调用多套移动函数。

## P2.4 原子性

一个命令：

1. 全部验证；
2. 修改 clone；
3. `assertCampInvariants(next)`；
4. 成功才返回；
5. 应用层保存一次。

失败时：

- state 引用内容不变；
- 补给不变；
- offer 不变；
- 不出现半完成。

## P2.5 不变量

实现 `assertCampInvariants`，至少验证：

- 单位 ID 全局唯一；
- 物品 ID 全局唯一；
- 每个 owned entity 恰好占一个槽；
- 无悬空 slot 引用；
- 无一个实体占多个槽；
- 所有容量合法；
- 满级无法合成；
- 合成后源删除、目标 ID 保留；
- 招募后对应 offer 立即变空；
- 指定目标空位被准确占用；
- 无效目标不扣补给。

## P2.6 存档迁移

将旧 reserve/inventory 转成固定槽，保留原顺序。

### P2 完成条件

至少覆盖：

- 战斗位 A → 战斗空位；
- 战斗位 A ↔ 战斗位 B；
- 战斗位 → 替补任意空位；
- 替补 → 战斗任意空位；
- 战斗位 ↔ 替补；
- 替补第 1 格 → 第 3 空格；
- 邂逅位 → 指定战斗空位；
- 邂逅位 → 指定替补空位；
- 同种合成；
- 不同种交换；
- 连续 100 个随机合法 camp command 无重复或丢失。

---

# P3 — 拖拽与单击控制器

## P3.1 新模块

```text
src/app/interaction/
  usePointerDragController.ts
  dropRegistry.ts
  gestureTypes.ts
```

## P3.2 硬性手势规则

- 所有 pointerdown 都使用 `setPointerCapture`；
- 内部实时状态放 `useRef`；
- 鼠标移动超过 6–8 px 才算拖；
- 触摸使用 180 ms 左右短长按或位移阈值；
- pointerup 永远只提交 0 或 1 条命令；
- pointercancel、Escape、窗口失焦安全取消；
- drag overlay `pointer-events:none`；
- 拖放后抑制尾随 click；
- 不在业务组件中散落 `elementFromPoint`；
- 使用 drop registry 获取当前合法目标；
- 拖起后只高亮领域层预判为合法的目标。

## P3.3 单击模式

```text
点击源
→ 记录 entity ID
→ 高亮合法目标
→ 点击目标
→ 构造和拖拽完全相同的 command
```

再次点源可取消。点击空白可取消。

## P3.4 无法操作提示

领域错误返回中文原因，例如：

- 补给不足；
- 替补已满；
- 不能把不同物种合成；
- 该单位已经满级；
- 该食物没有合法目标；
- 当前格尚未解锁。

### P3 完成条件

鼠标和移动触摸仿真均能完成 P2 的全部操作；每次手势只产生一条领域命令。

---

# P4 — 食物和装备目标系统

## P4.1 数据结构

```ts
type UnitSelector =
  | { kind: "habitat"; habitat: Habitat }
  | { kind: "species"; speciesId: SpeciesId }
  | { kind: "tier"; tier: Tier }
  | { kind: "all" };

type ItemTargetSpec =
  | { kind: "singleUnit"; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "group"; selector: UnitSelector; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "allOwned"; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "none" };
```

装备强制：

```ts
usage.kind === "equipment"
targetSpec.kind === "singleUnit"
```

## P4.2 UI

- 单体：高亮合法动物；
- 族群：高亮全部将受影响动物，浮层显示“影响 N 只”；
- 全体：高亮整队区域和全部动物；
- 无目标：放到确认区或单击使用；
- 市场物品可拖入仓库；
- 仓库物品可拖出使用；
- 新装备替换旧装备前显示明确确认；
- 预览不改状态。

## P4.3 原子购买

`purchaseAndApplyItem` 必须：

- 先解析目标；
- 目标为空则失败；
- 成功后才扣补给、清空 offer、应用效果。

### P4 完成条件

为以下各加测试：

- 单体永久食物；
- 水域族群食物；
- 全体食物；
- 单体装备；
- 替换装备；
- 市场买入仓库；
- 仓库拖出使用；
- 无目标不扣钱。

---

# P5 — 战斗阶段、同步攻击和位置模型

## P5.1 拆分概念

```ts
type OriginOwner = "player" | "opponent";
type CombatSide = "left" | "right";
type BoardSlotId =
  | "L4" | "L3" | "L2" | "L1" | "L0"
  | "R0" | "R1" | "R2" | "R3" | "R4";

interface BattleUnit {
  unitId: UnitId;
  originOwner: OriginOwner;
  slotId: BoardSlotId;
  // stats/status...
}
```

`combatSide` 由 slot 推导，不作为第二份可不同步状态。

所有移动、交换、推拉统一使用 `BoardMutationService`。

## P5.2 明确阶段

```ts
type BattlePhaseId =
  | "setup"
  | "environment"
  | "battleStart"
  | "exchangeStart"
  | "preAttack"
  | "windup"
  | "impact"
  | "hurt"
  | "retreat"
  | "afterAttack"
  | "battleEnd";
```

## P5.3 同步批次

战斗开始：

1. 从同一个 phase-start snapshot 收集双方触发；
2. 分配同一个 batch；
3. 解析效果；
4. 统一处理伤害、受伤和退场；
5. 再进入下一触发 wave。

攻击交换：

1. 锁定左右两侧攻击者；
2. 同时收集双方攻击前触发；
3. 完成全部攻击前效果；
4. 若锁定攻击者仍在，快照攻击力；
5. 发出成对 windup；
6. 同时 impact；
7. 统一处理伤害、受伤、退场；
8. 处理 afterAttack；
9. 不在本交换临时替换退场攻击者。

## P5.4 事件

所有事件可含：

```ts
phaseId
batchId
exchangeId
simultaneousGroupId
```

领域事件不得包含毫秒时间。

## P5.5 表现编译

增加：

```text
src/presentation/
  battleCueCompiler.ts
  cueTypes.ts
```

将事件编译为时间 Cue。规则测试不依赖 Cue。

## P5.6 跨中线交换

先增加引擎能力和测试，不要求立刻给正式动物。

必须测试：

- L0 与 R4 交换；
- slot 唯一；
- originOwner 不变；
- 普通攻击目标符合当前定义；
- “队友/敌人”选择器能明确按 originOwner 或 combatSide；
- 不会因双方单位在同一侧陷入无限循环；
- 回放能正确显示跨中线移动。

### P5 完成条件

- 战斗看起来是双方同时准备和同时碰撞；
- 相同输入仍完全确定；
- 10,000 场无安全上限异常；
- 领域层无动画时间。

---

# P6 — Tier 5 与 25 只动物

## P6.1 营地等级

```ts
const CAMP_LEVELS = [
  { minRound: 1, tier: 1, animalOfferSlots: 3 },
  { minRound: 2, tier: 2, animalOfferSlots: 3 },
  { minRound: 4, tier: 3, animalOfferSlots: 4 },
  { minRound: 6, tier: 4, animalOfferSlots: 4 },
  { minRound: 8, tier: 5, animalOfferSlots: 5 },
] as const;
```

禁止在 UI、自动玩家或对手生成器中复制另一套 if/else。

## P6.2 动物

实现 `CONTENT_ROSTER_ZHEJIANG.md` 中 25 只占位内容。

要求：

- 每 Tier 5 只；
- 杭州/浙江湿地、山林和沿海生态主题；
- Tier 是内容节奏，不宣传为现实动物强弱排名；
- 保护动物使用“发现、同行、观察”表达；
- 技能数据驱动；
- 物种 UI 不写专属规则；
- 数值可占位，但不能全员硬编码在引擎。

## P6.3 关键标识

营地顶部展示：

- 当前 T；
- 下一升级回合；
- 当前动物位数量；
- 新 Tier 解锁时短动画。

卡片展示：

- 名称；
- Tier；
- 水/陆/空；
- `✊` 攻击；
- 红 `♥` 体力；
- 等级；
- 装备和状态。

## P6.4 模拟

报告新增：

- 各 Tier 出现率；
- 各动物购买率；
- 各动物最终队伍率；
- 各回合平均补给；
- 各 Tier 升级后的胜率变化；
- 10 胜成功率和失败分布。

不要为了达到预设成功率篡改模拟。

---

# P7 — 简单占位美术与动画

## P7.1 杭州湿地背景

只用自制 CSS/SVG：

- 远山；
- 白墙黛瓦剪影；
- 水道；
- 荷叶/芦苇；
- 垂柳；
- 柔和低频水纹。

不下载外部图。

## P7.2 动物标识

每只动物使用：

- 自制几何 SVG 或系统字形；
- 可复用的头像框；
- 不需要正式插画。

## P7.3 动画

实现并与领域解耦：

- drag lift；
- valid drop glow；
- drop snap；
- merge approach；
- level badge pop；
- stat delta；
- paired windup/lunge/impact/return；
- non-gore fly-out retreat；
- battle result ribbon；
- 10-win success page。

## P7.4 低刺激

- 默认无震屏；
- 无全屏高频闪；
- particle cap；
- 所有演出可跳过；
- reduceMotion；
- backgroundMotion 开关。

---

# 3. 测试矩阵

至少新增以下类别：

## Camp identity

- 任意 move 后所有 owned unit ID 恰好一次；
- 任意 item move 后所有 item ID 恰好一次；
- 指定空位准确填充；
- 交换不复制；
- 合成删除源、保留目标；
- market offer 只消费一次；
- 无效动作零副作用；
- 1000 条随机命令后不变量成立。

## Gesture

使用 React Testing Library 或等效方式验证：

- drag 只提交一次；
- drag 后不再 click 提交第二次；
- pointercancel 不提交；
- click-source/click-target 与 drag 产生相同 command；
- 长按状态不受 stale closure 影响。

## Item

- single/group/all/equipment；
- target preview；
- empty group；
- replacement；
- inventory in/out。

## Battle

- battle-start 双侧同批次；
- pre-attack 双侧同批次；
- simultaneous impact；
- attacker killed in pre-attack；
- onHurt chains；
- cross-side swap；
- same seed exact output；
- cue compiler 不改变 output。

## Terminal

- 9→10；
- success page；
- champion registration；
- active run cleared；
- refresh/reload remains correct。

---

# 4. 文件边界

建议最终结构：

```text
src/
  domain/
    camp/
      campCommands.ts
      campReducer.ts
      campValidation.ts
      campInvariants.ts
    battle/
      battleEngine.ts
      battlePhases.ts
      boardMutation.ts
      selectors.ts
    expedition/
      expeditionEngine.ts
      successResolution.ts
  presentation/
    cueTypes.ts
    campCueCompiler.ts
    battleCueCompiler.ts
    resultCueCompiler.ts
  app/
    screens/
    interaction/
    components/
  content/
    animals.ts
    campLevels.ts
    items.ts
```

无需为追求目录结构一次性搬完所有文件；按阶段迁移。

---

# 5. Codex 每阶段汇报格式

```text
Phase:
Implemented:
Root causes fixed:
Files changed:
New tests:
npm run test:
npm run lint:
npm run build:
npm run sim:   # where applicable
Manual verification:
Known limitations:
Commit:
Next phase:
```

若有命令失败，必须报告，不得写“全部完成”。

---

# 6. 首条 Codex 指令

```text
Read AGENTS.md and PROJECT_IMPLEMENTATION.md. Work only on P0 and P1 first.
Do not start P2 or add animals until P1 tests, lint, and build pass.
After finishing, report with the required phase format and stop.
```

完成 P1 后再下达：

```text
Continue with P2 only. Preserve all existing game behavior except the slot and
command architecture explicitly changed by AGENTS.md. Add migrations and
invariant tests. Stop after P2 passes test, lint, and build.
```
