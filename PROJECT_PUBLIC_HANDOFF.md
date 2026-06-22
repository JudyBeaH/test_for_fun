# Project Wildtrail 工程实现与公开仓库交接文档

本文档用于把当前本地原型整理成可公开阅读的工程说明。它重点说明：项目是什么、用了什么技术栈、核心系统如何实现、开发过程中遇到的关键 bug 以及当前采用的修复方式。后续如果新建 public Git 仓库，建议把本文档放在仓库根目录，供 GPT 或其他开发者优先读取。

## 1. 工程位置

当前本地工程路径：

```text
/Users/linbohan/Documents/Codex/2026-06-21/read-agents-md-and-implement-the-2
```

当前分支：

```text
refactor/v0.3-stability
```

本地开发地址通常是：

```text
http://127.0.0.1:5173/
```

## 2. 项目定位

Project Wildtrail / 野迹 是一个本地浏览器轻策略自走棋原型。当前目标是验证核心玩法闭环，而不是上线生产环境。

核心循环：

1. 在营地购买动物、购买或使用道具、调整战斗队和替补。
2. 出发时固定战斗输入，生成确定性的战斗结果。
3. 前端播放战斗事件流，展示双方队列、数值变化、技能、退场和结果。
4. 战斗结束后进入报告，再返回营地、提前返程或进入成功结算。
5. 最终胜利时登记最终战前队伍快照，生成可复现挑战码。

明确不包含：

- 微信 SDK、登录、支付、广告。
- 后端服务、云存档、实时 PvP。
- 商业级正式美术、音效和发布流程。
- Cocos 迁移。

## 3. 技术栈

- React 19：前端界面、营地交互、战斗播放、报告页。
- TypeScript 6：领域层和 UI 层类型约束。
- Vite 8：本地开发服务器与构建。
- Vitest 4：领域规则、回归测试和 soak 测试。
- ESLint 10 + typescript-eslint：静态检查。
- localStorage：本地存档。
- tsx：运行模拟脚本。

常用命令：

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
npm run sim
```

`package.json` 中的脚本：

```text
dev    -> vite
test   -> vitest run
lint   -> eslint .
build  -> tsc -b && vite build
sim    -> tsx src/sim/runBatch.ts
```

## 4. 主要目录

```text
src/
  app/
    App.tsx                  React 单页应用，包含营地、战斗、报告、图鉴、冠军、挑战码和开发者工具
  app/assets/
    placeholderGlyphs.ts     占位字形资源
  content/
    animals.ts               动物内容、基础数值、技能定义
    campLevels.ts            营地等级、动物位开放、Tier 权重
    constants.ts             初始参数、经济参数、版本号
    environments.ts          战斗环境
    items.ts                 食物、装备、褪黑素等道具
  domain/
    battleEngine.ts          战斗结算、技能触发、伤害、退场和事件流
    campEngine.ts            营地规则、购买、移动、合成、装备、快照
    challengeCode.ts         WT2 挑战码编码、解码和兼容校验
    contribution.ts          战斗贡献统计、MVP、技能链统计
    expeditionEngine.ts      远征状态机、出发、结算、登记队伍
    ids.ts                   稳定 ID 生成
    rewardEngine.ts          胜利/返程奖励
    rng.ts                   种子随机数
    saveSchema.ts            存档结构、迁移与默认存档
    types.ts                 领域类型
  sim/
    autoPlayer.ts            自动玩家营地策略
    opponentGenerator.ts     对手生成和 BattleInput 生成
    report.ts                模拟报告数据结构
    runBatch.ts              批量模拟入口
  storage/
    localRepository.ts       localStorage 仓储、导入导出、损坏备份
    transactionalSave.ts     staging/commit 风格保存
  main.tsx                   React 入口
  index.css                  页面布局、营地、战斗和占位美术样式

tests/
  battleEngine.test.ts       战斗规则
  campEngine.test.ts         营地、移动、合成、待安置、补给
  challengeCode.test.ts      挑战码
  expeditionEngine.test.ts   远征状态机
  items.test.ts              食物、装备、褪黑素相关
  rewardEngine.test.ts       奖励与登记
  rng.test.ts                RNG 确定性
  soak.test.ts               领域层边界和随机压力
```

## 5. 架构边界

### 5.1 领域层

`src/domain` 是规则核心。设计目标是纯规则层，不依赖 React、DOM、localStorage、网络或浏览器 API。

领域层负责：

- 动物实例、重复物种、手动合成。
- 营地动作合法性和补给消耗。
- 食物、装备和战斗前快照。
- 战斗输入固定、自动结算、确定性事件流。
- 技能触发、伤害、护盾、状态和退场。
- 最终胜利登记和挑战码数据。

### 5.2 UI 层

`src/app/App.tsx` 负责把领域状态渲染为可操作界面：

- 营地：单击选中、右键/长按拖放、换位、放置、合成、告别、查看技能。
- 战斗：播放 `BattleEvent[]`，展示双方队列、攻血盾变化、退场、日志和结果按钮。
- 报告：继续远征、返程奖励、成功登记。
- 图鉴、冠军陈列、挑战码、开发者工具。

### 5.3 存档层

当前使用 localStorage。`transactionalSave.ts` 提供 staging/commit 风格保存，目标是降低中途写坏存档的风险。`localRepository.ts` 负责导入导出、读取、重置和 staging 信息。

## 6. 当前已实现的核心系统

### 6.1 营地和队伍

当前战斗队使用 `Array<TeamMember | null>` 表达 5 个战斗位置，`null` 表示空位。位置本身就是状态，因此不再额外维护一组并行 bool。

重要约定：

- 领域层 `position/index 0 = 前排`。
- 领域层 `position/index 4 = 后排`。
- 营地 UI 玩家队列按 `4,3,2,1,0` 显示，也就是“后排 -> 前排”。
- 战斗退场后不自动补位，后续最前存活动物仍保留原始 position。

当前 v0.2 原型约束：

- 战斗队最多 5 个槽。
- 替补容量当前为 1。
- 仓库容量当前为 1。
- 允许战斗队存在空位。
- 替补上场时，如果战斗队有空位，优先填补指定/可用空位。

### 6.2 重复动物和手动合成

重复物种可以同时存在，不会自动合成。合成必须由玩家主动触发。

合成规则：

- 只能同物种。
- 源个体删除，目标个体保留。
- `bondXp` 经验合并。
- 即使没有升级，也允许合成。
- 跨过等级阈值才产生高级发现。
- 满级单位不能继续合成。
- 若源个体有装备，目标无装备时会继承；若双方都有不同装备，源装备尝试进入仓库。

### 6.3 待安置动物

升级发现后会产生 `pendingRecruit`。为了避免满员卡死，当前支持：

- 告别待安置动物。
- 告别战斗队动物腾位。
- 告别替补动物腾位。
- 直接替换某个战斗位或替补位。

### 6.4 补给经济

初始补给是 10，但不等于硬上限。告别动物返还补给可以让当前补给超过入营上限。

告别返还：

- Level 1: +1
- Level 2: +3
- Level 3: +5

### 6.5 道具与装备

当前道具分为食物和装备。

代表道具：

- 红果：单体永久 +1 攻击、+1 体力。
- 河苔：所有水域动物永久 +2 体力。
- 同心果：单体默契 +1，可触发高级发现。
- 松果弹弓：装备，初始攻击 +1，战斗开始对随机敌人造成装备伤害。
- 苦根：单体 -1 体力、+2 攻击，不能使初始最大体力低于 1。
- 褪黑素：下一次参战睡眠；受到实际伤害且存活后醒来，获得 3 次强化普通攻击。

装备处理：

- 市场装备可以直接装备到选中个体。
- 仓库装备可以装备到个体。
- 替换旧装备时，如果仓库有空位，旧装备回仓。
- 仓库满时阻止替换，避免旧装备丢失。

### 6.6 战斗系统

战斗输入在出发时固定，恢复或刷新不会重掷。战斗输出是确定性 `BattleEvent[]`。

当前规则：

- 双方各有队列位置。
- 退场只标记 `retreated`，不 compact、不自动补位。
- 当前最前存活动物发起普通攻击。
- 普通攻击伤害用一批 intent 近似同步结算。
- 技能伤害和装备伤害统一走伤害管线。
- 只有实际扣血、仍存活、未退场的单位触发 `onHurt`。
- 褪黑素睡眠单位受到实际伤害后醒来，获得强化攻击状态。

### 6.7 战斗前端播放

前端不重新计算战斗规则，而是根据 `BattleEvent[]` 构造当前帧：

- `damageApplied` 更新血量。
- `shieldAbsorbed` 更新护盾。
- `statModified` 更新攻击、体力上限或护盾。
- `unitMoved` 更新位置。
- `unitRetreated` 标记退场。

战斗 UI 支持：

- 自动播放。
- 暂停。
- 单步。
- 跳到结果。
- 查看报告 / 继续按钮。
- 双方队列显示。
- 最近日志和完整日志。

### 6.8 最终胜利和挑战码

第 10 胜会记录 `finalVictoryRecord`，其中包含最终战前玩家队伍快照。登记冠军队伍时使用这个战前快照，而不是战斗后临时状态。

挑战码系统负责把登记队伍编码为 WT2 挑战码，并在解码后根据版本兼容性决定是否允许挑战。

## 7. 开发过程中修复过的关键 bug

### 7.1 进入战斗后卡住

现象：

- 进入战斗后自动播放不推进。
- 直接跳到结果后没有继续或返回营地选项。

处理方式：

- 明确 `battlePreparing`、`battlePlayback`、`battleReport` 三个阶段。
- 出发时先固定 `BattleInput`，再结算并保存 `BattleOutput`。
- 战斗播放结束后展示稳定的“查看报告 / 继续”按钮。
- 自动播放、暂停、单步、跳结果都围绕事件 cursor 推进。

### 7.2 战斗无法自动播放

现象：

- 战斗 UI 停在首个事件。

处理方式：

- `BattleView` 使用 `useEffect` 根据 `battleSpeed` 推进 cursor。
- 到达最后事件时自动暂停。
- `reduceMotion` 模式缩短播放延迟。

### 7.3 同种动物不能按需求合成

现象：

- 两只同种动物不能在“不升级”的情况下合成，或者招募时被错误地自动合并。

处理方式：

- 重复物种默认共存。
- 合成改为玩家显式触发。
- 合成仅要求同物种，不要求一定升级。
- `bondXp` 合并到目标个体。

### 7.4 选中一只同种动物时全部同种动物被高亮

现象：

- 前端用 species 判断选中状态，导致同物种全部被选中。

处理方式：

- 选中状态改用具体 `instanceId`，并保留 area/index 用于展示和命令构造。
- 高亮只绑定具体个体。

### 7.5 拖动到空位或换位后复制个体

现象：

- 战斗队/替补之间交换，再移动时出现一模一样的重复个体。

处理方式：

- 战斗队使用可空槽位。
- 同队移动改为源槽和目标槽显式交换/写入。
- 跨区移动改为读取源槽、读取目标槽、一次性写回两个位置。
- 移动后检测 owned `instanceId` 是否重复。
- 增加回归测试覆盖：替补交换、场上移位、替补再上场，不允许复制。

### 7.6 待安置动物满员卡死

现象：

- 高级发现产生新动物时，如果战斗队和替补都满，玩家无法继续。

处理方式：

- 新增 `discardPendingRecruit`。
- `upgradeDiscovery` 阶段允许 `release`。
- 待安置 UI 增加告别待安置、告别已有动物、直接替换指定位置。

### 7.7 初始补给和补给上限混淆

现象：

- 开局 10 补给被误当作不能超过的硬上限，告别动物返还受限制。

处理方式：

- 入营补给仍受上限控制。
- 告别返还直接增加当前补给，可超过入营上限。
- 返还改为按等级 1/3/5。

### 7.8 战斗队方向显示反了

现象：

- 领域层 `index 0 = 前排`，但营地 UI 曾按 `0,1,2,3,4` 显示，同时文案写“后排 -> 前排”，进入战斗后用户感觉方向反转。

处理方式：

- 营地战斗队改为 `4,3,2,1,0` 显示。
- 战斗 UI 玩家侧也按后排到前排渲染，使前排靠近中线。
- 在 `SlotList` 和 `BattleQueue` 附加 cause marker 注释说明原因。

### 7.9 战斗退场后自动补位

现象：

- 原引擎有 compact 行为，退场后重排 position。
- 这破坏了“位置是玩法信息”的设计。

处理方式：

- 退场只标记 `retreated`。
- 活动单位按原 position 寻找最前存活者。
- 后续攻击不改变未退场单位 position。

### 7.10 战斗数值变化不可见

现象：

- 只看到最终结果，看不出伤害、护盾、属性变化和退场过程。

处理方式：

- 前端根据事件流逐帧构造 battle frame。
- 卡牌实时显示攻击、体力、护盾、退场状态。
- 日志对伤害、护盾、属性变化、移位、退场加前缀。

### 7.11 市场装备无法装备到个体

现象：

- 市场装备走 `buyAndUseItem`，但规则层只按食物效果处理，不能挂到动物实例。

处理方式：

- `buyAndUseItem` 遇到 equipment 时调用装备流程。
- UI 文案区分“直接装备”和“直接使用”。
- 旧装备回仓；仓库满时阻止替换。

## 8. 当前测试覆盖

已有测试大类：

- RNG 确定性。
- 营地槽位、移动、替补、合成、待安置。
- 道具、装备、褪黑素。
- 战斗伤害、装备伤害、onHurt、退场不补位。
- 远征状态机。
- 奖励和挑战码。
- 领域层不依赖 React/DOM/storage/browser API。

建议公开前运行：

```bash
npm run test
npm run lint
npm run build
npm run sim
```

## 9. 当前已知限制

这部分非常重要，后续给 GPT 读仓库时建议保留，避免它误以为 v0.3 已经完全实现。

当前代码仍偏 v0.2 原型，尚未完全完成 AGENTS.md 中的 v0.3 稳定性重构：

- `phaseToScreen()` 目前仍会优先检查 `pendingBattle`，P1 规格要求改为仅由 `phase` 决定页面。
- `finishBattleReport()` 进入 `successResolution` 或 `returnResolution` 时仍需要进一步确保清空终局 `pendingBattle`。
- 成功结算还没有完全收敛成 `completeSuccessResolution(input)` 纯领域函数。
- 营地还没有重构为固定 5/3/3 的 `unitsById/itemsById + formation/reserve/inventory` 结构。
- 营地动作还没有统一收敛到 v0.3 规格中的 `applyCampCommand(state, command)`。
- 替补和仓库当前仍是 v0.2 的 1 格容量，不是 v0.3 目标的 3 格固定槽。
- 拖拽当前仍在 `App.tsx` 内部实现，没有拆成 `src/app/interaction/usePointerDragController.ts`、`dropRegistry.ts` 和 `gestureTypes.ts`。
- 食物目标系统已有 single/habitat/allOwned 雏形，但还不是 v0.3 规格中的 `ItemTargetSpec`。
- 战斗还没有拆成 v0.3 的显式 phase/batch/cue compiler 架构。
- 动物内容当前是 12 只、Tier 1-3，不是 v0.3 目标的 25 只、Tier 1-5。

## 10. Public Git 仓库建议

建议提交：

- `src/`
- `tests/`
- `docs/`
- `README.md`
- `PROJECT_IMPLEMENTATION.md`
- `PROJECT_PUBLIC_HANDOFF.md`
- `PROJECT_AUDIT_AND_REFACTOR_PLAN.md`
- `AGENTS.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `eslint.config.js`
- `index.html`

建议不要提交：

- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- `.DS_Store`
- 本地临时输出。

当前 `package.json` 仍是：

```json
{
  "license": "UNLICENSED"
}
```

如果要建 public 仓库，建议先明确 license。可选：

- MIT：开放宽松，最适合原型。
- Apache-2.0：开放但带更明确专利条款。
- 保留 `UNLICENSED`：公开可见，但不授权他人使用。

如果希望 GPT 能通过 public repo 访问，最关键的是让根目录保留：

1. `PROJECT_PUBLIC_HANDOFF.md`
2. `PROJECT_IMPLEMENTATION.md`
3. `AGENTS.md`
4. `README.md`
5. `src/domain/types.ts`
6. `src/domain/campEngine.ts`
7. `src/domain/battleEngine.ts`
8. `src/app/App.tsx`
9. `tests/campEngine.test.ts`
10. `tests/battleEngine.test.ts`
11. `tests/items.test.ts`

## 11. 后续开发建议

建议下一步按 AGENTS.md 的 v0.3 分期执行，不要直接堆动物和动画：

1. P0：清理 Git 跟踪的生成目录，增加 `.gitignore` 和 CI。
2. P1：修复十胜终局状态机，并增加 9 胜到 10 胜回归测试。
3. P2：重构营地固定槽位和原子 CampCommand。
4. P3：拆出统一拖拽/单击控制器。
5. P4：统一食物和装备目标系统。
6. P5：重构战斗阶段、同步批次和表现 cue。
7. P6：扩展 Tier 5 和 25 只动物。
8. P7：补充杭州江南湿地占位美术和低刺激动画。

每一阶段都应运行：

```bash
npm run test
npm run lint
npm run build
```

P5、P6 后额外运行：

```bash
npm run sim -- --runs 10000 --seed 20260620
```

