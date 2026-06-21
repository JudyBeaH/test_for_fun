# Project Wildtrail v0.2 工程实现说明

本文档整理当前本地原型的工程实现、技术栈、模块边界、核心玩法系统，以及迭代过程中遇到的关键 bug 与修复方式。它适合放入公开 Git 仓库，作为后续给 GPT 或其他开发者读取的项目上下文。

## 1. 项目概览

Project Wildtrail / 野迹 是一个本地浏览器轻策略自走棋原型。核心循环是：

1. 在营地购买动物、道具，调整战斗队和替补。
2. 出发后根据固定输入自动结算战斗。
3. 播放战斗演出，显示双方队列、数值变化、退场和技能事件。
4. 回到营地继续推进，直到成功登记队伍或提前返程。
5. 最终胜利后保存最终战前队伍快照，并支持 WT2 挑战码。

项目当前重点验证的是本地可玩原型，不包含微信、后端服务、账号系统或生产发布范围。

## 2. 技术栈

- React 19：前端 UI 和游戏界面。
- TypeScript 6：全项目类型约束。
- Vite 8：本地开发服务器和生产构建。
- Vitest 4：规则层、模拟和回归测试。
- ESLint 10 + typescript-eslint：静态检查。
- localStorage：本地存档。
- tsx：运行模拟批处理脚本。

主要命令：

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
npm run sim
```

## 3. 项目结构

```text
src/
  app/
    App.tsx                  React 单页应用、营地 UI、战斗 UI、报告、挑战码界面
  content/
    animals.ts               动物定义、基础数值、技能
    campLevels.ts            营地等级、开放槽位、Tier 权重
    constants.ts             初始参数、经济参数、版本信息
    environments.ts          战斗环境规则
    items.ts                 食物、装备、褪黑素等道具
  domain/
    battleEngine.ts          战斗结算、事件流、技能触发、退场逻辑
    campEngine.ts            营地规则、购买、移动、合成、装备、快照
    challengeCode.ts         WT2 挑战码编码/解码/校验
    contribution.ts          战斗贡献统计、MVP、技能链
    expeditionEngine.ts      远征状态机、出发、结算、胜利/返程
    ids.ts                   稳定 ID 生成
    rewardEngine.ts          返程/胜利奖励
    rng.ts                   确定性随机数
    saveSchema.ts            存档结构
    types.ts                 领域类型
  sim/
    autoPlayer.ts            自动营地策略
    opponentGenerator.ts     对手生成、战斗输入生成
    report.ts                模拟报告结构
    runBatch.ts              批量模拟入口
  storage/
    localRepository.ts       存档导入导出、本地仓储
    transactionalSave.ts     原子化保存与 staging
  index.css                  UI 样式
  main.tsx                   React 入口

tests/
  battleEngine.test.ts
  campEngine.test.ts
  challengeCode.test.ts
  expeditionEngine.test.ts
  items.test.ts
  rewardEngine.test.ts
  rng.test.ts
  soak.test.ts
```

## 4. 架构边界

### 4.1 领域规则层

`src/domain` 是核心规则层，不依赖 React、DOM、localStorage、网络或浏览器 API。该约束由 `tests/soak.test.ts` 检查。

领域层负责：

- 营地动作合法性。
- 动物实例、重复个体、手动合成。
- 战斗输入固定、自动战斗结算。
- 技能触发、伤害、护盾、状态、退场。
- 最终胜利快照、挑战码数据。

### 4.2 UI 层

`src/app/App.tsx` 负责：

- 屏幕路由：home / camp / battle / report / collection / champions / challenge / dev。
- 营地交互：单击选中、右键/长按拖放、放置、换位、合成、告别、装备。
- 战斗演出：按事件流播放攻血盾变化、退场、移位、日志。

### 4.3 存档层

存档使用 localStorage。`transactionalSave.ts` 提供 staging/commit 风格的原子保存流程，避免中途写坏活跃存档。损坏存档会备份。

## 5. 关键系统实现

### 5.1 营地队伍槽位

战斗队是 5 个位置，当前正式建模为：

```ts
Array<TeamMember | null>
```

`null` 表示空位。这样位置本身就是状态，不再额外维护一组并行 bool。好处是：

- 空位不会和真实动物数组不同步。
- 移动、交换、放置、告别都围绕同一份槽位数据。
- 战斗快照可以保留原始 position。

规则层约定：

- `position/index 0 = 前排`。
- `position/index 4 = 后排`。
- UI 中玩家队列按 `4,3,2,1,0` 显示，即“后排 -> 前排”。

### 5.2 手动合成

重复物种允许同时存在，不会自动合成。合成只能由玩家显式触发：

- 从市场招募并合成。
- 已有动物拖到同种动物上合成。
- 选中一个动物后点击另一个同种动物的“合成到此”。

合成规则：

- 只能同物种。
- 经验 `bondXp` 合并。
- 即使未升级也可以合成。
- 跨过等级阈值才产生高级发现。
- 满级单位不能继续合成。

### 5.3 待安置动物

高级发现选择后会产生 `pendingRecruit`。若战斗队和替补都满，玩家仍然可以：

- 告别待安置动物。
- 告别战斗队动物。
- 告别替补动物。
- 直接替换某个战斗位或替补位。

这避免了“待安置状态卡死”。

### 5.4 替补和仓库

当前 v0.2 约束：

- 替补容量：1。
- 道具仓库容量：1。
- 替补可以上场。
- 战斗队动物可以下替补。
- 若战斗队有空位，替补上场会优先填补空位。

### 5.5 补给经济

初始补给是 10，不等于硬上限。告别动物返还补给可以超过入营上限。

告别返还：

- Level 1: +1
- Level 2: +3
- Level 3: +5

### 5.6 道具与装备

道具分为食物和装备：

- 食物：直接改变实例永久属性、默契或限时状态。
- 装备：挂到动物实例上，并在战斗快照里转成装备效果。

代表道具：

- 红果：单体永久 +1 攻击、+1 体力。
- 河苔：所有水域动物永久 +2 体力。
- 同心果：单体默契 +1，可触发高级发现。
- 松果弹弓：装备，初始攻击 +1，战斗开始对随机敌人造成装备伤害。
- 苦根：单体 -1 体力、+2 攻击，不能使初始最大体力低于 1。
- 褪黑素：下一次参战睡眠，受实际伤害醒来后获得 3 次强化普通攻击。

### 5.7 战斗规则

战斗输入一旦出发即固定，后续恢复不会重掷。

关键规则：

- 双方保留 5 个位置的概念。
- 退场后不自动补位。
- 当前最前的存活动物发起普通攻击。
- 后排动物在原位置成为新的最前活动单位，不会改变 position。
- 技能移动只在现有活动单位占用的位置之间交换。
- 技能伤害和装备伤害统一走伤害管线。
- 只有实际受伤且仍存活的单位触发 `onHurt`。

### 5.8 战斗演出

战斗 UI 不直接重新模拟规则，而是从 `BattleEvent[]` 事件流构造当前帧：

- `damageApplied` 更新血量。
- `shieldAbsorbed` 更新护盾。
- `statModified` 更新攻击、体力上限、护盾。
- `unitMoved` 更新 position。
- `unitRetreated` 标记退场。

这让战斗播放、单步、跳结果都能从同一事件序列恢复。

## 6. 已修复的关键 bug 与处理方式

### 6.1 战斗进入后卡住

问题：

- 战斗准备、结算、回放和报告状态切换不清楚。
- 跳到结果后没有稳定的“继续/返回营地”入口。

修复：

- 将 battlePreparing / battlePlayback / battleReport 拆清。
- 战斗输入先固定，再结算，再回放。
- 回放结束后显示固定的“查看报告 / 继续”按钮。
- 自动播放、暂停、单步、跳结果统一基于事件 cursor。

### 6.2 战斗无法自动播放

问题：

- 回放 cursor 和播放状态没有稳定推进。

修复：

- `BattleView` 用 `useEffect` 根据 `battleSpeed` 推进 cursor。
- 到达最后事件自动暂停。
- 减少动画模式缩短延迟。

### 6.3 同种动物无法按需求合成

问题：

- 早期逻辑把同种购买/移动和升级合成耦合过紧。

修复：

- 允许重复动物实例共存。
- 合成必须手动触发。
- 合成只要求同物种，不要求一定升级。
- `bondXp` 正确合并。

### 6.4 选中同种动物时全部高亮

问题：

- 前端选中状态曾按 species 判断，导致同物种全选。

修复：

- 选中状态改为 instanceId + area + index。
- 高亮只绑定具体个体。

### 6.5 拖到空位后复制个体

问题：

- 早期 `moveOwned` 在同队移动到空位时使用 splice 调整，边界情况下会保留旧引用或顺序错误。

修复：

- 重写同列表移动逻辑。
- 对战斗队使用显式槽位写入。
- 新增测试保证移动到空位或占用位不会复制。

### 6.6 替补交换后再次上场复制个体

问题：

- 跨区移动/交换混用了 `splice` 和直接赋值。
- 替补和战斗位交换后，再移动原替补动物可能导致同一 instanceId 出现两次。

修复：

- 将战斗队建模为 `TeamMember | null` 槽位。
- 跨区移动改为“读源槽、读目标槽、一次性写回两个槽”。
- 移动后检测所有 owned instanceId 唯一性。
- 新增复现测试：替补交换、战斗位移位、替补再上场，不允许复制。

### 6.7 待安置动物满员卡死

问题：

- `upgradeDiscovery` 阶段只允许选择发现和安置新动物。
- 战斗队和替补都满时无法腾位，也无法放弃待安置动物。

修复：

- 新增 `discardPendingRecruit`。
- `upgradeDiscovery` 阶段允许 `release`。
- 待安置 UI 增加告别待安置、替换、告别已有动物。

### 6.8 补给返还被上限限制

问题：

- 初始补给和补给上限被混淆。

修复：

- 入营补给仍受上限控制。
- 告别返还直接增加补给，可超过入营上限。
- 返还数值按等级 1/3/5。

### 6.9 战斗队方向显示反了

问题：

- 规则层约定 `index 0 = 前排`。
- 营地 UI 之前按 `0,1,2,3,4` 从左到右渲染，但标题写“后排 -> 前排”。
- 战斗 UI 又将前排放在中线附近，导致玩家感觉进入战斗后方向反了。

修复：

- 营地战斗队改为 `4,3,2,1,0` 显示。
- 每个槽位显示“后排 / 前排 / 位号”。
- 移动按钮方向同步修正。
- 在 `SlotList` 和 `BattleQueue` 添加 cause marker 注释。

### 6.10 战斗退场后自动补位

问题：

- 原战斗引擎有 `compact()`，单位退场后会重排 position。
- 这与“位置是玩法信息”的设计冲突。

修复：

- 移除自动补位。
- 退场只标记 `retreated`。
- 活动队列按原 position 排序。
- 后续最前存活动物在原位置继续战斗。

### 6.11 战斗数值变化不可见

问题：

- 前端早期只在最终结果显示最后数值。
- 播放过程中看不出谁受伤、谁退场、谁加攻/加盾。

修复：

- 前端根据事件流逐帧构造当前显示状态。
- 日志高亮伤害、护盾、属性变化、移位、退场。
- 战斗卡牌实时显示攻/血/盾和退场状态。

### 6.12 市场装备无法装备到个体

问题：

- 市场中的装备道具走 `buyAndUseItem`。
- 规则层之前只按食物效果处理，没有把装备挂到动物实例上。

修复：

- `buyAndUseItem` 遇到 `equipment` 时调用购买并直接装备流程。
- UI 文案从“直接使用”改为“直接装备”。
- 旧装备在仓库有空位时回仓。
- 仓库满时阻止替换，避免旧装备丢失。

## 7. 测试与验证

当前测试覆盖：

- RNG 确定性。
- 营地槽位、移动、替补、合成、待安置。
- 道具、装备、褪黑素。
- 战斗伤害、onHurt、装备伤害、退场不补位。
- 远征状态机。
- 奖励与挑战码。
- 1000 场 soak 边界。
- 规则层不依赖 React/DOM/storage/browser API。

常用验证：

```bash
npm run test
npm run lint
npm run build
npm run sim
```

最近一次完整验证结果：

```text
npm run test: 8 files / 38 tests passed
npm run lint: passed
npm run build: passed
npm run sim:
  runs=1000
  seed=20260620
  successRate=0.0%
  averageBadges=3.71
  averageRounds=8.25
  avgEvents=59.0
  drawRate=6.6%
  safetyCaps=0
```

## 8. 本地运行

```bash
npm install
npm run dev
```

默认 Vite 地址：

```text
http://127.0.0.1:5173/
```

## 9. 公开仓库建议

建议提交：

- `src/`
- `tests/`
- `README.md`
- `PROJECT_IMPLEMENTATION.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `eslint.config.js`
- `index.html`
- `artifacts/.gitkeep`

建议不要提交：

- `node_modules/`
- `dist/`
- `tsconfig.tsbuildinfo`
- 本地临时输出或私有说明文件。

当前 `package.json` 里仍是：

```json
{
  "license": "UNLICENSED"
}
```

如果要创建 public Git 仓库，建议先选择并添加明确 license，例如 MIT、Apache-2.0 或保留 All Rights Reserved。

## 10. 给后续 GPT 的阅读入口

建议优先阅读：

1. `PROJECT_IMPLEMENTATION.md`
2. `README.md`
3. `src/domain/types.ts`
4. `src/domain/campEngine.ts`
5. `src/domain/battleEngine.ts`
6. `src/app/App.tsx`
7. `tests/campEngine.test.ts`
8. `tests/battleEngine.test.ts`
9. `tests/items.test.ts`

核心注意事项：

- `src/domain` 不应引入 React、DOM、storage 或网络。
- 战斗队位置 0 是前排。
- 战斗队可以有 `null` 空位。
- 退场不补位。
- 重复动物实例是合法状态。
- 合成必须手动触发。
- 出发时固定 BattleInput，恢复时不能重掷。
- 最终胜利登记必须使用最终战前快照。
