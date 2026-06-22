# 野迹 / Project Wildtrail v0.3
## 项目审计、规则重构与产品化路线

> 审计对象：`https://github.com/JudyBeaH/test_for_fun` 当前 `main` 分支  
> 文档用途：供产品负责人、游戏设计、工程负责人共同评审。  
> 结论性质：这是一次代码级静态审计与架构设计，不等同于已经向仓库提交代码。

---

## 1. 执行结论

当前项目**已经证明了核心方向可以运行**，并且有几项值得保留的基础：

- 规则层位于 `src/domain`，不依赖 React、DOM、网络或本地存储；
- 战斗采用可复现输入和事件日志；
- 出发时固定战斗输入，避免退出重进后重新随机；
- 已经有自动保存、挑战码、模拟器和基础回归测试；
- 战斗 UI 不是重新计算规则，而是读取 `BattleEvent[]` 播放。

这些基础是正确的，不建议推倒重来。

但是，当前版本不适合直接继续堆 25 只动物和大量演出。应先完成一个 **v0.3“规则地基重构”**。当前最重要的问题不是某个拖拽函数写错，而是营地位置、手势状态、页面状态机和战斗空间模型仍然存在相互缠绕。继续增加内容会放大复制、消失、卡死和无法复现的问题。

推荐顺序：

1. 修复十胜终局状态机；
2. 重构营地槽位和原子命令；
3. 重写拖拽控制器；
4. 统一食物和装备的目标系统；
5. 将战斗改为明确的阶段与同步批次；
6. 抽象可跨中线的位置模型；
7. 扩充到 25 只动物和 Tier 5；
8. 最后增加背景、拖放、合成、攻击和结算演出。

---

## 2. 已确认的关键问题

### 2.1 十胜后卡住：状态机优先级错误

`finishBattleReport()` 在达到十枚远征章时只把 phase 改为 `successResolution`，没有清除 `pendingBattle`。而 UI 路由先检查是否存在 `pendingBattle`，于是即使领域状态已进入成功结算，界面仍被判定为战斗页。

这不是单纯缺少一个按钮，而是“页面由多个互相冲突的事实推导”的问题。

#### 修复原则

- `phase` 是唯一页面状态来源；
- `pendingBattle` 只是 phase 对应的数据，不得反向决定页面；
- 从报告进入终局时，先归档最终战，再清除 `pendingBattle`；
- 加入 9 胜到 10 胜的完整回归测试；
- 成功结算采用一个原子事务完成：领养、奖励、命名、登记、清除活跃远征和保存。

---

### 2.2 拖到空位容易卡住：不是一个 Bug，而是四类问题叠加

#### 手势层

当前长按后通过 React state 进入 dragging，但 `pointerup` 可能读取到旧闭包中的 dragging；普通鼠标和触摸未始终捕获 pointer，移出源元素后可能丢失结束事件。拖拽结束后还可能继续触发 click，产生“双命令”。

#### 地址层

拖拽源和选择状态依赖 `area + index`。一旦一次操作改变数组，index 立即可能指向另一个单位。稳定身份应该是 `instanceId`、`offerId` 和 `itemInstanceId`。

#### 槽位层

战斗队用了可空槽位，但替补和仓库仍接近“紧凑数组”。只要容量扩大到 3，`splice` 就无法准确表达“把动物放到替补第 3 个空位”，会自动压缩或改变其他对象的索引。

#### 命令层

从邂逅位拖到某个战斗空位时，现有招募命令没有完整携带目标槽位。视觉上玩家放到了指定位置，规则层却可能放到第一个空位。

#### 结论

不应继续为每个表现 Bug 打补丁。营地必须改成：

> 稳定实体 ID + 固定槽位 ID + 单一原子命令 + 操作后不变量校验。

---

### 2.3 食物目标不能只靠“拖到一只动物”

当前内容已经包含：

- 单体食物；
- 指定生态族群食物；
- 全体食物；
- 单体装备。

因此目标选择必须成为规则数据的一部分，而不是 UI 根据物品名称猜测。

推荐统一模型：

```ts
type ItemTargetSpec =
  | { kind: "singleUnit"; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "group"; selector: UnitSelector; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "allOwned"; allowedZones: readonly OwnedUnitZone[] }
  | { kind: "none" };

type ItemUsage =
  | { kind: "food"; consumeOnSuccess: true }
  | { kind: "equipment"; replaceExisting: true };
```

交互约定：

- 单体食物：拖到某只动物；
- 族群食物：拖起后高亮全部受影响单位，任意放到高亮单位或族群投放区；
- 全体食物：拖到“整队”投放区，所有受影响卡片预览闪亮；
- 装备：只能放到单体动物；
- 所有物品均可拖入仓库；
- 仓库中的物品也必须能拖出使用；
- 无合法目标时不得扣补给、不得清空市场格。

---

### 2.4 战斗逻辑“同时攻击”，但技能阶段仍显得串行

当前普通攻击伤害已经接近同步结算，但战斗开始技能、装备技能和攻击前技能按玩家、对手依次执行。问题包括：

- 一方在另一方尚未完成同阶段触发前就改变状态；
- 动画只能逐条播放，缺少两军同时准备的节奏；
- 后续增加位置技能后，会出现明显先后手偏差。

推荐使用显式阶段：

```text
setup
→ environment
→ battleStartSnapshot
→ battleStartResolve
→ exchangeStart
→ preAttackSnapshot
→ preAttackResolve
→ pairedWindup
→ simultaneousImpact
→ hurtResolve
→ retreatResolve
→ afterAttackResolve
→ exchangeEnd
→ battleEnd
```

关键规则：

1. `battleStartSnapshot` 同时收集双方在该阶段开始时存活单位的触发。
2. 同一批次中的已提交触发不会因另一侧同批次伤害而被取消。
3. 攻击交换开始时锁定双方攻击者。
4. 双方攻击前效果全部结束后，再读取攻击力和正式碰撞。
5. 如果锁定攻击者在攻击前阶段已经退场，该侧本次不攻击，不临时替换新前排。
6. 两次普通攻击伤害属于同一个 `simultaneousGroupId`。
7. 由本批次产生的受伤、退场和连锁技能进入下一批次。

这样既能保持确定性，又能让表现层播放为：

> 两侧技能准备近似同时完成 → 双方后撤蓄力 → 同时撞击 → 数值和连锁反馈。

---

### 2.5 未来跨阵营换位要求重新抽象“所有者、战斗侧、位置”

当前 `side + position` 容易把三个概念混在一起：

- 这只动物原本属于谁；
- 它当前位于战场哪一侧；
- 它当前占据哪一个具体位置。

建议预先拆开：

```ts
type OriginOwner = "player" | "opponent";
type CombatSide = "left" | "right";
type BoardSlotId =
  | "L4" | "L3" | "L2" | "L1" | "L0"
  | "R0" | "R1" | "R2" | "R3" | "R4";

interface BattleUnit {
  unitId: string;
  originOwner: OriginOwner;
  slotId: BoardSlotId;
  // stats ...
}
```

显示顺序：

```text
L4 L3 L2 L1 L0 | R0 R1 R2 R3 R4
后排       前排 | 前排       后排
```

跨中线交换只修改 `slotId`。不要通过从一个数组删除、再向另一个数组插入来实现。

#### 建议先采用的原型语义

- `originOwner` 永不变化，用于战斗记录、最终胜负归属和部分“原队友”技能；
- `combatSide` 由当前槽位决定；
- 普通攻击由左右两侧当前有效前排碰撞，因此被交换到另一侧的动物可能被原队友攻击，符合“位置交换会改变实际攻击对象”的直觉；
- 技能选择器显式声明依据：
  - `sameOriginOwner`
  - `oppositeOriginOwner`
  - `sameCombatSide`
  - `oppositeCombatSide`
- 胜负先按 `originOwner` 的存活单位判定；
- 必须为“双方存活单位都处于同一侧”设计防停滞规则。v0.3 可采用：每次交换结束后，按槽位向中线重新寻找一对不同 `originOwner` 的最近单位进行普通攻击；这一规则必须单独做可视化原型和测试。

这个系统比当前需求稍抽象，但它避免未来再重写整个战斗容器。

---

## 3. 目标工程架构

### 3.1 领域层：只产生事实

```text
CampCommand
  → validate
  → reduce
  → assert invariants
  → CampTransition { state, events }

BattleInput
  → resolveBattle
  → BattleOutput { result, events, diagnostics }
```

领域层禁止：

- DOM；
- React；
- CSS 动画时间；
- `setTimeout`；
- 音频；
- localStorage；
- 屏幕坐标；
- 依赖拖拽库。

### 3.2 表现编排层：把事实编译成节奏

增加：

```text
src/presentation/
  campCueCompiler.ts
  battleCueCompiler.ts
  resultCueCompiler.ts
  cueTypes.ts
```

例如领域事件：

```ts
{
  type: "attackImpact",
  exchangeId: "ex-7",
  simultaneousGroupId: "impact-7",
  ...
}
```

转成表现提示：

```ts
[
  { kind: "windup", actors: ["p1", "o4"], startMs: 0, durationMs: 220 },
  { kind: "lunge", actors: ["p1", "o4"], startMs: 220, durationMs: 140 },
  { kind: "impact", groupId: "impact-7", startMs: 360, durationMs: 100 },
  { kind: "return", actors: ["p1", "o4"], startMs: 460, durationMs: 160 }
]
```

换皮、调整速度和减少动画时不修改规则层。

### 3.3 UI 层：发命令和播放 Cue

建议拆分目前较大的 `App.tsx`：

```text
src/app/
  App.tsx
  navigation/
  state/
  screens/
    CampScreen/
    BattleScreen/
    SuccessScreen/
  interaction/
    usePointerDragController.ts
    dropRegistry.ts
    gestureTypes.ts
  components/
  animation/
```

---

## 4. 营地重构规格

### 4.1 所有区域都必须是固定槽位

```ts
interface CampSlots {
  formation: readonly [UnitId|null, UnitId|null, UnitId|null, UnitId|null, UnitId|null];
  reserve: readonly [UnitId|null, UnitId|null, UnitId|null];
  inventory: readonly [ItemInstanceId|null, ItemInstanceId|null, ItemInstanceId|null];
  animalOffers: readonly [
    AnimalOffer|null, AnimalOffer|null, AnimalOffer|null,
    AnimalOffer|null, AnimalOffer|null
  ];
  itemOffers: readonly [ItemOffer|null, ItemOffer|null];
}
```

锁定但尚未开放的市场位也保留固定 ID，只是 `available=false`。

### 4.2 位置引用必须稳定

```ts
type UnitSlotRef =
  | { zone: "formation"; slot: 0|1|2|3|4 }
  | { zone: "reserve"; slot: 0|1|2 };

type ItemSlotRef =
  | { zone: "inventory"; slot: 0|1|2 };

type OfferSlotRef =
  | { zone: "animalMarket"; slot: 0|1|2|3|4 }
  | { zone: "itemMarket"; slot: 0|1 };
```

UI 可用 slot ref 查当前实体，但命令源对象优先携带实体 ID，避免旧 index 指错对象。

### 4.3 一切操作统一为命令

```ts
type CampCommand =
  | { type: "moveUnit"; unitId: UnitId; to: UnitSlotRef }
  | { type: "mergeUnits"; sourceUnitId: UnitId; targetUnitId: UnitId }
  | { type: "recruitAnimal"; offerId: OfferId; to: UnitSlotRef }
  | { type: "recruitAndMerge"; offerId: OfferId; targetUnitId: UnitId }
  | { type: "moveItem"; itemInstanceId: ItemInstanceId; to: ItemSlotRef }
  | { type: "purchaseItemToInventory"; offerId: OfferId; to: ItemSlotRef }
  | { type: "purchaseAndApplyItem"; offerId: OfferId; target: ItemTarget }
  | { type: "applyInventoryItem"; itemInstanceId: ItemInstanceId; target: ItemTarget }
  | { type: "releaseUnit"; unitId: UnitId }
  | { type: "freezeOffer"; offerId: OfferId; frozen: boolean }
  | { type: "refreshMarket" }
  | { type: "depart" };
```

拖拽和单击只是构造同一个命令的两种方式。

### 4.4 每个命令必须是原子的

执行步骤：

1. 从当前 state 找到实体；
2. 验证源、目标、补给、容量、合成和目标规则；
3. 在副本上完成全部修改；
4. 验证不变量；
5. 成功才返回新 state 和事件；
6. 应用层只保存一次；
7. 失败返回中文原因，state 完全不变。

### 4.5 必须持续检查的不变量

- 一个 `unitId` 在所有营地区域最多出现一次；
- 一个 `itemInstanceId` 在所有区域最多出现一次；
- 被消费的 offer 必须从市场消失；
- 无效命令不得减少补给；
- 无效命令不得生成动物或物品；
- 每个槽位最多一个实体；
- `unitsById` 中每个“owned”单位必须恰好被一个槽位引用；
- `itemsById` 中每个库存物品必须恰好被一个槽位引用；
- 合成后源单位删除，目标单位保留稳定 ID；
- 满级单位无法合成；
- 成功招募到指定空位，不得偷偷改放第一个空位；
- 每次成功原子命令后触发一次自动保存。

开发构建中每次命令都运行 `assertCampInvariants`；生产构建至少在存档前运行。

---

## 5. 拖拽与单击交互规格

### 5.1 目标体验

玩家应能用以下两种路径完成同一操作：

```text
路径 A：按下并拖动源 → 放到目标
路径 B：单击源 → 合法目标高亮 → 单击目标
```

任何仅能拖拽、不能单击完成的核心动作都不合格。

### 5.2 自定义 Pointer Controller

本地 React 原型中可暂不引入大型拖拽库，推荐一个独立的控制器：

```text
pointerdown
→ record source and start point
→ setPointerCapture for mouse/touch/pen
→ move beyond threshold
→ begin drag
→ update overlay and hovered drop target
→ pointerup
→ dispatch exactly one command
→ release capture and suppress trailing click
```

硬性要求：

- 手势内部状态放在 `useRef`，不能依赖延迟回调中的旧 React state；
- 鼠标位移约 6–8 px 后开始拖；
- 触摸可采用短长按 160–220 ms 或明确位移阈值；
- 拖拽镜像 `pointer-events:none`；
- 用 drop-target registry 命中，不让业务代码到处调用 `elementFromPoint`；
- pointercancel、窗口失焦和 Escape 都能安全取消；
- 拖拽后 250 ms 内抑制源元素 click；
- 放到非法目标只回弹，不执行部分命令；
- 合法目标在拖起时立即高亮；
- 选择状态只保存 `entityId`，不保存容易失效的 index。

---

## 6. 战斗阶段与可编辑效果系统

### 6.1 事件头信息

```ts
interface BattleEventBase {
  eventId: string;
  sequence: number;
  phaseId: BattlePhaseId;
  batchId?: string;
  exchangeId?: string;
  simultaneousGroupId?: string;
  sourceUnitId?: string;
  targetUnitId?: string;
}
```

### 6.2 触发收集与效果执行分离

```ts
collectTriggers(snapshot, phase): TriggerIntent[]
resolveIntentBatch(state, intents): BatchResult
```

不要在遍历玩家单位时立即改状态，再遍历对手单位。

### 6.3 可扩展效果 DSL

在现有效果基础上扩展：

```ts
type EffectDef =
  | DealDamageEffect
  | ModifyStatEffect
  | ApplyStatusEffect
  | GainShieldEffect
  | MoveUnitEffect
  | SwapUnitsEffect
  | PushPullEffect
  | ModifyCampResourceEffect;
```

位置类效果统一走一个 `BoardMutationService`，禁止物种代码直接 splice 队列。

### 6.4 必测同步场景

- 双方战斗开始技能都能提交；
- 一方战斗开始伤害击倒另一方时，另一方同批次战斗开始技能仍触发；
- 两侧攻击前增益都结束后才锁定碰撞伤害；
- 普通攻击的两次伤害属于同一 simultaneous group；
- 前摇期间攻击者退场不会临时换前排补打；
- 两只 `onHurt` 单位的反应链可结束；
- 位置交换不会复制、丢失或产生两个单位占同槽；
- 跨中线交换后普通攻击目标符合当前选定语义；
- 任意 10,000 场随机战斗无悬挂、无重复 ID、无 NaN。

---

## 7. 十胜结算和冠军登记

### 7.1 推荐状态机

```text
camp
→ battlePrepared
→ battlePlayback
→ battleReport
→ camp | successResolution | returnResolution
→ successCommitted | returnCommitted
→ home/champions
```

每个 phase 有明确的允许数据：

| Phase | pendingBattle | finalVictoryRecord |
|---|---:|---:|
| camp | null | optional historical |
| battlePrepared/playback/report | required | optional |
| successResolution | null | required |
| returnResolution | null | optional |
| successCommitted | null | archived |

### 7.2 原子成功提交

```ts
completeSuccessResolution({
  expedition,
  adoptedUnitId,
  rewardChoiceIds,
  teamName,
  existingTeams,
  nowIso
})
```

一次完成：

- 校验确实 10 胜；
- 校验最终胜利战快照存在；
- 领养最终战前队伍中的动物；
- 应用两项纪念物；
- 生成登记队伍；
- 保存第 10 胜开战前的永久属性、装备、等级、位置、环境和挑战种子；
- 不保存战斗内临时攻血盾；
- 清除 active expedition；
- 写入冠军陈列；
- 原子保存。

### 7.3 必测回归

从一个 9 胜存档开始：

1. 出发；
2. 获胜；
3. 结算；
4. 播放或跳过；
5. 查看报告；
6. 进入成功页；
7. `pendingBattle === null`；
8. 可选领养；
9. 可选两件纪念物；
10. 输入队名并登记；
11. 冠军列表出现新队伍；
12. 返回主页后没有“继续旧战斗”。

---

## 8. Tier 1–5 与 25 只浙江主题动物

### 8.1 商店等级

按用户指定节奏：

| 回合 | 营地等级 | 动物邂逅位 |
|---:|---:|---:|
| 1 | T1 | 3 |
| 2–3 | T2 | 3 |
| 4–5 | T3 | 4 |
| 6–7 | T4 | 4 |
| 8+ | T5 | 5 |

必须数据驱动：

```ts
const CAMP_LEVELS = [
  { minRound: 1, tier: 1, animalOfferSlots: 3 },
  { minRound: 2, tier: 2, animalOfferSlots: 3 },
  { minRound: 4, tier: 3, animalOfferSlots: 4 },
  { minRound: 6, tier: 4, animalOfferSlots: 4 },
  { minRound: 8, tier: 5, animalOfferSlots: 5 },
];
```

UI 显示：

- 当前营地 Tier；
- 本轮是否刚升级；
- 下一次升级回合；
- 市场牌的 Tier；
- 升级发现是“高一 Tier 三选一”，T5 时给同 Tier 稀有发现或其他数据化奖励。

### 8.2 内容扩充顺序

不要边改槽位边一次写完 25 个技能。

1. 先让现有动物全部通过新引擎；
2. 每 Tier 增加到 5 只占位动物；
3. 用 10,000 次模拟检查异常；
4. 再调数值；
5. 最后加演出。

完整名单和技能草案见 `CONTENT_ROSTER_ZHEJIANG.md`。

---

## 9. 简单美术与低刺激演出

### 9.1 杭州江南湿地占位背景

不下载或临摹外部图片。用 CSS/SVG 自绘：

- 远景：浅灰蓝山体；
- 中景：白墙黛瓦的小亭或民居剪影；
- 近景：水道、荷叶、芦苇和垂柳；
- 少量低频水纹、叶片轻摆；
- 战斗区保留高对比、干净的中线。

### 9.2 动物占位卡

每只动物至少包含：

- 简化 SVG/几何头像或系统字形；
- 中文名；
- Tier 标识；
- 水/陆/空标签；
- `✊` 攻击；
- 红色 `♥` 体力；
- 等级叶片或星点；
- 装备图标；
- 睡眠 `Zzz`、护盾、临时状态标识。

### 9.3 动画

营地：

- 拖起：抬升、阴影、轻微放大；
- 合法格：柔和描边；
- 放置：100–160 ms 回弹；
- 合成前：两卡向中心靠拢；
- 合成后：短闪光、等级标志弹出、属性变化 `+X`；
- 营地升级：顶部 Tier 徽章展开，不全屏闪白。

战斗：

- 双方前排同时后撤蓄力；
- 同时前冲；
- 碰撞时短暂停顿和小幅缩放；
- 伤害数字同时弹出；
- 退场沿抛物线飞出，但不血腥；
- 单场胜负使用 0.6–1.0 秒短条幅；
- 十胜使用完整杭州湿地纪念卡和冠军队合影。

偏头痛友好：

- 默认不震屏；
- 禁止高频闪烁；
- 粒子数量上限；
- 动画可跳过；
- `reduceMotion` 下以淡入淡出替代位移；
- 背景动态可完全关闭；
- 不用持续高对比呼吸光。

---

## 10. 技术栈决策

### 10.1 现在

继续保留 React + TypeScript + Vite 作为：

- 规则验证器；
- 自动模拟入口；
- 内容编辑和测试台；
- 未来 Cocos 客户端的参考实现。

不要立刻迁移，否则很难判断问题来自新引擎还是旧规则。

### 10.2 正式客户端

推荐在 v0.3 规则稳定后做 **Cocos Creator 3.8.x 的小型技术验证**：

- TypeScript 逻辑可继续复用；
- 官方支持构建微信小游戏；
- Asset Bundle 可用于小游戏分包和远程资源；
- 同一引擎可覆盖 Web、小游戏和原生平台；
- 适合 2D 卡片、时间轴动画、粒子、音频和横屏适配。

建议不是“立即把 React 项目转成 Cocos”，而是建立 monorepo：

```text
apps/
  web-prototype/
  cocos-client/
packages/
  game-core/
  game-content/
  game-simulation/
  save-schema/
tools/
  content-validator/
```

`game-core` 不 import React 或 Cocos。Cocos 只负责输入、场景、动画、音频和平台接口。

### 10.3 PC / iOS / Android / 微信的判断

这款游戏的计算和渲染压力并不高，内容量不是必须放弃微信小游戏的理由。真正决定平台的是：

- 首包和远程资源策略；
- 商业化、审核和账号资质；
- 用户单局时长；
- 局外内容深度；
- 是否需要离线、手柄、Steam 成就等原生能力。

建议顺序：

1. Web 原型验证规则；
2. Cocos 横屏战斗技术样片；
3. 微信真机包验证启动、内存和触摸；
4. 再决定先发微信还是同时准备 iOS/Android；
5. PC 端可在内容、键鼠和窗口适配成熟后追加。

目前不建议换 Unity。若未来变成大量 3D 场景、复杂骨骼和强 PC 原生生态，再重新评估。

---

## 11. 项目管理拆分

### P0：仓库与回归基线

- 删除 Git 跟踪中的 `node_modules`、`dist`、`*.tsbuildinfo`；
- 完善 `.gitignore`；
- 建 GitHub Actions：install、test、lint、build；
- 记录当前模拟数据，不做平衡粉饰。

### P1：终局状态机

- 修复十胜卡住；
- 增加 9→10 胜端到端测试；
- 成功提交原子化。

### P2：营地槽位与命令

- 替补 3 格、仓库 3 格固定槽位；
- ID 命令；
- 不变量检查；
- 迁移旧存档。

### P3：手势系统

- 新 pointer controller；
- 拖拽和单击同命令；
- 所有空位、换位、合成、市场招募回归测试。

### P4：物品目标

- 单体、族群、全体、无目标；
- 食物和装备分开；
- 市场购买/使用原子化；
- 仓库拖入拖出。

### P5：战斗阶段与位置

- 同步批次；
- paired attack；
- 全局槽位；
- 跨中线交换测试；
- 事件到 Cue 的编译层。

### P6：内容

- Tier 5；
- 25 只动物；
- 回合 2/4/6/8 升级；
- 模拟和数据表。

### P7：表现

- 自绘杭州湿地；
- 简单动物卡；
- 合成、升级、攻击、退场、结算动画；
- 减少动画模式。

每个 P 阶段必须独立提交，不能让 Codex 一次性重写全部项目。

---

## 12. 停止条件与风险

出现以下任一情况，应停止扩内容：

- 同一操作偶发复制或丢失实体；
- 10,000 场模拟出现无穷事件、NaN 或重复 ID；
- 领域层开始引用动画时长；
- UI 根据物种 ID 写专属规则；
- 一次拖放触发两条命令；
- 旧存档无迁移或无明确放弃策略；
- 25 只动物加入后仍无法解释某场战斗的先后顺序。

另一个必须重视的信号是当前工程说明里的模拟成功率为 0%。在规则稳定前不要急着“调到好看”，但 v0.3 完成后必须重新跑模拟和人工试玩，否则 10 胜目标可能对轻度玩家过于苛刻。

---

## 13. 外部技术与生态资料

- Cocos Creator 3.8 发布微信小游戏：  
  https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-wechatgame.html
- Cocos 小游戏分包：  
  https://docs.cocos.com/creator/3.8/manual/en/editor/publish/subpackage.html
- Cocos 原生 / Web / 小游戏双内核说明：  
  https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/engine-customization.html
- 国家林草局《陆生野生动物重要栖息地名录（第一批）》：  
  https://www.forestry.gov.cn/html/main/main_4461/20230105202222013856422/file/20230105202402559398024.pdf
- 国家林草局浙江湿地资料：  
  https://www.forestry.gov.cn/c/www/mtbd/92045.jhtml
