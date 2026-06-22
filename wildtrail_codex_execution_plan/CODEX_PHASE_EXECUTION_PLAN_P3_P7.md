# Project Wildtrail — Codex P3–P7 分阶段实施与验收路线

> 原则：每个阶段都遵循“设计说明 → 实现 → 自动验证 → 独立复审 → 人工试玩 → 标签冻结”。
> 
> 不建议把 P3–P7 各作为一次巨大任务。P5 尤其必须拆分，否则很容易同时破坏战斗规则、回放和演出。

---

# 0. 每阶段通用工作流

## 0.1 实施者会话

Codex 只实现一个明确子阶段。

## 0.2 复审者会话

换一个新会话，让 Codex 只审查该阶段的 diff，不继续加功能。

## 0.3 人工试玩

机器测试证明“不会错”，人工试玩判断“是否好用、是否看得懂、是否舒服”。两者不能互相替代。

## 0.4 冻结

通过后独立 commit/tag，例如：

```text
v0.3-p3-input
v0.3-p4-items
v0.3-p5-battle-core
v0.3-p6-content
v0.3-p7-presentation
```

---

# P3 — 拖拽与单击手势系统

## P3 的唯一目标

把鼠标、触摸、笔和单击选择转换成**同一条 CampCommand**。P3 不改变营地规则，也不增加食物目标规则。

## 拆分

### P3A：输入控制器骨架

实现：

- `usePointerDragController`；
- pointer capture；
- drag threshold；
- pointercancel / Escape / window blur；
- drag overlay；
- drop registry；
- exactly-once command dispatch；
- 拖拽后抑制尾随 click。

先只接入“已有单位移动到空位”。

### P3B：完整营地动作映射

接入：

- formation 内换位；
- formation ↔ reserve；
- offer → formation/reserve；
- 同种合成；
- 物品 offer → inventory；
- inventory 内移动。

### P3C：单击等价路径与移动端验证

- 单击源 → 高亮目标 → 单击目标；
- 与拖拽生成完全相同的 command；
- 增加触摸 viewport 测试；
- 必要时增加 Playwright 或等效浏览器级测试，只覆盖关键手势，不扩大为完整 E2E 平台。

## P3 严格限制

- 不修改 `applyCampCommand` 的业务语义，除非先证明是 P2 Bug；
- 不在组件内复制合法目标规则；
- 不把 DOM index 当实体 ID；
- 不用 HTML5 `dragstart/drop` 作为移动端核心方案；
- 不在 pointerup 同时 dispatch drag 和 click；
- 不加入动画打磨；
- 不改变食物的 single/group/all 定义。

## P3 自动验收

- drag 只提交一次；
- drag 后不再触发第二次 click；
- pointercancel 不提交；
- 移出源元素后松开仍能结束；
- 非法目标不产生领域命令；
- click path 和 drag path 生成深度相等的 command；
- 触摸长按和滑动不会卡在 dragging 状态；
- 100 次连续拖放后 ID 不变量成立。

## P3 人工试玩

在鼠标和手机触摸模拟下分别验证：

- 快速拖；
- 很慢拖；
- 拖到屏幕边缘；
- 拖出窗口后松开；
- 按住后取消；
- 拖到非法目标；
- 连续来回换位；
- 单击完成同样操作。

目标不是“有动画”，而是“手永远不会把游戏拖坏”。

---

# P4 — 食物、装备与目标选择

## P4 的唯一目标

建立数据驱动的 item target model，并让购买、存仓、预览、使用和替换成为原子操作。

## 拆分

### P4A：目标模型与纯函数预览

定义：

```ts
ItemTargetSpec = singleUnit | group | allOwned | none
ItemUsage = food | equipment
```

实现纯函数：

```ts
resolveItemTargets(state, itemDef, candidateTarget): ItemTargetPreview
```

预览至少返回：

- 是否合法；
- 受影响 unit IDs；
- 原因；
- 预期属性/状态变化摘要；
- 是否会替换装备。

### P4B：原子购买和使用

实现：

- market → inventory；
- market → target 直接使用；
- inventory → target 使用；
- 装备替换；
- 无目标时零副作用；
- 一次性食品消费；
- 持续状态写入明确的数据结构。

### P4C：交互表达

- 单体：高亮合法动物；
- 族群：高亮所有受影响单位并显示数量；
- 全体：出现明确“整队投放区”；
- 装备：仅高亮单体；
- 替换装备前显示旧/新对比；
- 任何预览不改存档。

## P4 必须先冻结的语义

不要让 Codex 猜“全体”含义。每个 item definition 必须明确：

```ts
allowedZones: ["formation"]
// 或
allowedZones: ["formation", "reserve"]
```

“场上全体”和“所有已拥有动物”必须是两个不同 selector。

## P4 严格限制

- UI 不按物品名称或 ID 写 if/else；
- 无合法目标时不扣补给、不清 offer；
- 装备只能是 singleUnit；
- 食物和装备不能共享含糊的 `useItem(targetId?)`；
- 不在此阶段实现大量新道具；只使用 1 个单体、1 个族群、1 个全体、1 个装备和褪黑素作为代表样本；
- 不在此阶段调平衡。

## P4 验收

必须验证：

- 单体永久食品；
- 水域族群食品；
- formation 全体食品；
- formation + reserve 全体食品；
- 装备和替换；
- 褪黑素状态；
- market 买入仓库；
- 仓库拖出使用；
- 空目标、满仓、补给不足；
- 刷新/重载后状态一致。

---

# P5 — 战斗阶段、同步批次、位置模型与表现 Cue

P5 是全项目风险最高的阶段，拆成五个子阶段。

## P5A：黄金战例与事件 schema

在改规则前：

1. 选择 15–25 个代表性 BattleInput；
2. 保存当前 output/event trace 为 fixture；
3. 为每个战例写“哪些结果必须保持、哪些顺序会因新同步语义有意改变”；
4. 为事件增加 `phaseId`、`batchId`、`exchangeId`、`simultaneousGroupId`，暂不加动画时间。

目的：让重构不是盲飞。

## P5B：同步阶段解析

只做：

```text
environment
→ battleStart snapshot/resolve
→ exchange start
→ preAttack snapshot/resolve
→ paired impact
→ hurt/retreat waves
→ afterAttack
```

规则：

- 同一 phase snapshot 同时收集双方触发；
- 同批次已提交触发不会因另一侧同批次伤害而取消；
- 交换开始锁定两侧攻击者；
- 双方攻击前效果结束后才快照攻击力；
- 两次普通攻击伤害共享 simultaneousGroupId；
- 锁定攻击者在 preAttack 中退场时，该侧本交换不补位攻击；
- 受伤/退场连锁进入下一 wave；
- 技能伤害可触发 onHurt，但只有仍存活单位能执行反应。

## P5C：全局战场槽位与 BoardMutationService

先迁移为：

```text
L4 L3 L2 L1 L0 | R0 R1 R2 R3 R4
```

拆开：

- originOwner；
- current slot；
- current combat side（由 slot 推导）。

先保持现有同侧移动行为，不立刻开放正式跨阵营技能。

所有 move/swap/push/pull 必须经过一个 mutation service。

## P5D：跨中线交换实验开关

只在开发者工具中增加一个 sandbox：

- 手工构造 L0 ↔ R4；
- 验证 original owner 不变；
- 验证普通攻击目标；
- 验证 sameOriginOwner 与 sameCombatSide selector；
- 验证胜负与防停滞规则；
- 不把该机制放进正式 25 只动物，直到人工理解测试通过。

建议 feature flag：

```ts
experimentalCrossSideSwap: false
```

## P5E：领域事件到表现 Cue

新增 presentation compiler：

```text
BattleEvent[] → PresentationCue[]
```

领域层不得出现毫秒；Cue 才包含：

- startMs；
- durationMs；
- actors；
- simultaneous group；
- interrupt/skip behavior。

先做无美术的 timeline debug view，确认双方确实同批次，再交给 P7 做动画。

## P5 严格限制

- 不同时增加 25 只动物；
- 不同时改营地拖拽；
- 不把 CSS 时间写回 domain；
- 不允许物种代码直接 `splice` 战斗数组；
- 不为某只动物在 UI 特判移动；
- 不删除 safety cap；
- 不把事件日志当作唯一状态源回写规则；
- 不因动画需要改变战斗结果；
- 跨中线交换必须先 feature flag；
- 每个子阶段独立 commit。

## P5 自动验收

- 同 seed 精确相同 output；
- battleStart 双侧同 snapshot；
- preAttack 双侧同 snapshot；
- paired damage 同 simultaneous group；
- 技能伤害触发 onHurt；
- 退场单位不反伤；
- 预攻击退场不临时换前排补打；
- 位置交换无重复 slot/ID；
- 跨中线 sandbox 不悬挂；
- cue compiler 不修改 output；
- 10,000 场无 NaN、重复 ID、安全上限异常。

## P5 人工试玩

使用 0.25x 或单步调试视图检查：

- 战斗开始双方近似同时准备；
- 攻击前 buff 完成后才碰撞；
- 双方碰撞伤害同时出现；
- 连锁技能按 wave 可解释；
- 位置变化可追踪；
- 任意一场战斗能从日志解释“为什么赢/输”。

---

# P6 — Tier 5、25 只动物和模拟

## P6 的原则

先扩“内容承载能力”，再扩内容，不要直接手写 25 个特殊分支。

## 拆分

### P6A：Tier 与内容 validator

实现：

- 回合 1/T1；2/T2；4/T3；6/T4；8/T5；
- 邂逅位 3/3/4/4/5；
- 当前 Tier、下一升级回合和刚升级标志；
- `AnimalDef` validator；
- contentVersion；
- 自动玩家和对手生成器共用同一 camp level table。

### P6B：分批增加动物

建议顺序：

1. 先迁移现有动物到新 schema；
2. 每个 Tier 先放 2 只无新机制或复用机制的动物；
3. 跑测试和模拟；
4. 再增加位置/状态/环境类动物；
5. 最后补足 25 只。

每增加一种新 effect：

- 先写通用 effect；
- 写 engine 测试；
- 再让动物引用；
- 不允许 `if speciesId === ...`。

### P6C：模拟与异常检测

每批内容后运行固定 seed：

```bash
npm run sim -- --runs 10000 --seed 20260620
```

记录：

- 成功率；
- 平均远征章；
- 安全上限；
- 各 Tier 出现/招募/最终入队率；
- 各动物贡献、购买率、最终队伍率；
- 回合长度；
- 合成和升级发现；
- 各 item 使用率；
- 无效操作原因。

异常阈值只用于提醒，不作为机械平衡真理：

- 某动物购买率远高于同 Tier 中位数；
- 某动物几乎从不被买；
- 某机制显著提高 safety cap；
- 10 胜成功率仍为 0 或极低；
- 平均战斗事件数突然翻倍；
- 某 Tier 解锁后胜率断崖式变化。

### P6D：关键 UI 标识

只做可读性，不做华丽美术：

- 当前 T；
- 下一升级回合；
- 牌面 Tier；
- 水/陆/空；
- ✊ 攻击；
- 红 ♥ 体力；
- 等级；
- 装备/状态；
- 刚升级提醒。

## P6 严格限制

- 不把 Tier 当现实动物强弱或保护价值；
- 不一次添加 25 个未经测试的技能；
- 不用隐藏对手数值加成；
- 不为了“模拟成功率好看”伪造自动玩家；
- 不在 UI 写动物规则；
- 不在 P6 加正式动画；
- 不在 P6 启用跨中线正式内容，除非 P5D 已单独通过理解测试。

---

# P7 — 简单美术、动画和低刺激体验

## P7 的原则

P7 只改变“玩家如何看见领域事实”，不改变领域事实。

## 拆分

### P7A：视觉基础和横屏布局

- 1280×720 基准；
- 中央安全区；
- CSS variables/design tokens；
- 自绘 SVG 杭州湿地：远山、白墙黛瓦、水道、荷叶、芦苇、垂柳；
- 动物用统一几何头像框和中文名；
- 不使用外部图片。

### P7B：营地微反馈

通过 `CampTransition.events → CampCue[]`：

- drag lift；
- valid target glow；
- snap；
- recruit arrival；
- merge approach；
- level badge pop；
- stat delta；
- Tier upgrade banner。

动画失败或被跳过时，状态仍已正确提交。

### P7C：战斗动作

通过 `BattleCue[]`：

- paired windup；
- 同时后撤；
- 同时冲撞；
- impact pause；
- 同步伤害数字；
- 技能 cue；
- 抛物线非血腥击飞；
- return/compaction。

### P7D：单场和十胜结算

- 单场胜负短条幅；
- 报告页 MVP、高光、最长连锁；
- 十胜完整纪念卡；
- 领养、奖励、命名、冠军合影；
- 所有按钮防重复提交。

### P7E：舒缓模式与性能

必须有：

- reduceMotion；
- backgroundMotion；
- 关闭粒子；
- 跳过动画；
- 无震屏默认值；
- 无高频闪烁；
- 页面隐藏/切回后 cue 能安全恢复或跳到稳定状态。

## P7 严格限制

- 不在动画 callback 中修改领域状态；
- 不让 UI 等动画完成后才保存战斗结果；
- 不因视觉遮挡阻止核心操作；
- 不下载或临摹参考游戏素材；
- 不使用全屏白闪、持续呼吸光和强震屏；
- 不把动画时长写入 battle engine；
- 不在 P7 调整战斗数值。

## P7 验收

自动：

- cue compiler snapshot；
- skip animation 与正常播放最终 UI state 一致；
- reduceMotion 仍能完整完成流程；
- 重复点击按钮只提交一次；
- 关键页面可截图回归；
- test/lint/build/sim 全通过。

人工：

- 连玩 3–5 局不觉得反馈吵；
- 关闭背景动画后完全静止；
- 攻击前摇、碰撞、伤害三段可读；
- 合成与升级有爽感但不拖沓；
- 单场失败不羞辱玩家；
- 十胜明显比普通胜利特殊；
- 横屏窄屏和宽屏都没有核心按钮跑出安全区。

---

# 8. 每阶段统一停止条件

任一出现就停止，不进入下一阶段：

- 单位或物品复制/消失；
- 一次手势产生两条命令；
- 无效动作扣资源；
- 刷新后状态与刚完成的动作不一致；
- save migration 无测试；
- domain import React/DOM/storage/animation；
- UI 按 speciesId 或 itemId 写规则；
- 10,000 场出现 NaN、重复 ID 或无法解释的 safety cap；
- 相同 seed 无法重放；
- Codex 通过删除测试或改低断言“修复”；
- 当前阶段 diff 同时混入下一阶段大量功能。

---

# 9. 阶段复审通用 Prompt

每一阶段完成后，新开 Codex 会话：

```text
Act as an adversarial code reviewer for phase <PHASE> only.
Read AGENTS.md, PROJECT_IMPLEMENTATION.md, the phase plan, and the diff from the
last accepted tag to HEAD.

Do not add the next phase. Identify architectural boundary violations,
state-corruption risks, stale-ID/index bugs, non-atomic transitions,
non-determinism, missing migration, duplicate dispatch, and weak tests.

For every confirmed defect:
1. add or strengthen a regression test first,
2. make the smallest in-scope fix,
3. rerun test, lint, build, and the phase-specific simulation/E2E checks.

Report findings by severity, files changed, evidence, command results,
remaining risks, and commit. Stop after the review.
```

---

# 10. 最终推荐顺序

```text
P0-P2 acceptance
→ P3A
→ P3B
→ P3C
→ P4A
→ P4B
→ P4C
→ P5A
→ P5B
→ P5C
→ P5D sandbox
→ P5E
→ P6A
→ P6B in waves
→ P6C
→ P6D
→ P7A
→ P7B
→ P7C
→ P7D
→ P7E
→ complete regression + playtest
```

这条顺序刻意把“规则正确”“操作可靠”“内容规模”“演出爽感”分开。任何阶段出错，都能回到最近一个稳定标签，而不需要在混合改动中猜原因。
