# Project Wildtrail — P3–P7 可直接复制给 Codex 的 Prompt

> 使用规则：一次只发一个 Prompt。Codex 汇报、人工验收、Reviewer 复审通过后，再发送下一条。

---

## P3A — Pointer Controller 骨架

```text
Read AGENTS.md, PROJECT_IMPLEMENTATION.md, and the accepted P2 report/tag.
Implement P3A only: a framework-appropriate pointer drag controller and drop
registry for moving an existing owned unit to an empty formation or reserve
slot.

Constraints:
- Do not change CampCommand domain semantics.
- Use pointer capture and ref-backed gesture state.
- Dispatch zero or one command per gesture.
- Support pointercancel, Escape, window blur, and trailing-click suppression.
- Do not implement item targeting, new battle rules, animals, or animation polish.
- The UI must not decide legality independently; ask the domain/preflight API.

Before production changes, add tests for stale closure, pointer release outside
the source, cancellation, and exactly-once dispatch.
Run test, lint, and build. Report in the AGENTS phase format and stop.
```

## P3B — 完整营地动作映射

```text
Continue with P3B only.
Map drag gestures to the existing ID-based CampCommands for:
- formation reorder/swap,
- formation <-> reserve,
- animal offer -> exact formation/reserve slot,
- same-species merge,
- item offer -> exact inventory slot,
- inventory reorder.

Drag and click are not yet required to be visually polished. Do not add new
item target semantics. Every invalid drop must be a no-op with a Chinese reason.
Add integration tests proving that each gesture emits exactly one expected
command and preserves camp invariants. Run test, lint, build, report, and stop.
```

## P3C — 单击等价路径与浏览器测试

```text
Continue with P3C only.
Implement click-source -> highlight legal targets -> click-target using the
same command builder as drag. Add keyboard cancellation and basic touch-size
viewport verification. Add a minimal browser-level test harness if unit tests
cannot faithfully cover pointer capture.

Prove drag and click produce structurally identical CampCommands for all core
camp actions. Do not change domain rules or add animation polish.
Run all checks, report, and stop.
```

---

## P4A — Item Target Model

```text
Read the accepted P3 tag. Implement P4A only: a data-driven ItemTargetSpec and a
pure resolveItemTargets/preview API supporting singleUnit, group, allOwned, and
none, with explicit allowedZones.

Do not change resources or consume items in the preview API. Do not infer target
semantics from item names or IDs. Add representative definitions/tests for one
single food, one habitat-group food, one all-formation food, one equipment, and
melatonin. Report target IDs and readable invalid reasons.

Do not implement UI animation or add many items. Run test, lint, build, report,
and stop.
```

## P4B — 原子购买、存仓与使用

```text
Continue with P4B only.
Implement atomic commands for:
- market item -> exact inventory slot,
- market item -> direct valid target,
- inventory item -> valid target,
- equipment replacement,
- one-shot food consumption,
- persisted temporary/multi-battle status data required by melatonin.

Validate targets before charging supply or consuming offers/items. Invalid
commands must have zero side effects. Add migration if the save schema changes.
Add tests for insufficient supply, full inventory, empty groups, replacement,
reload, and duplicate submission. Run test, lint, build, report, and stop.
```

## P4C — 目标预览 UI

```text
Continue with P4C only.
Connect item target previews to the camp UI:
- single target highlights legal units,
- group target highlights every affected unit and displays the affected count,
- all target exposes an explicit team drop zone,
- equipment highlights single units and previews replacement.

Drag and click must share the same command path. Preview must never mutate or
save state. Do not change item balance or add new battle mechanics.
Run tests including pointer/click item use, lint, build, report, and stop.
```

---

## P5A — 黄金战例与事件元数据

```text
Start P5A only. Do not change battle outcomes yet.
Create 15-25 deterministic golden BattleInput fixtures covering start effects,
before-attack effects, skill damage, onHurt, retreat chains, movement, equipment,
and draws. Document which observable behavior must remain and which future
ordering changes are intentional.

Add phaseId, batchId, exchangeId, and simultaneousGroupId to domain events in a
backward-compatible way. Do not add milliseconds or presentation timing to the
domain. Run test, lint, build, report, and stop.
```

## P5B — 同步阶段和成对攻击

```text
Continue with P5B only.
Refactor battle resolution into explicit snapshot/resolve phases for both sides:
environment, battleStart, exchangeStart, preAttack, paired impact, hurt/retreat
waves, afterAttack, battleEnd.

Freeze semantics:
- both sides collect start/pre-attack triggers from the same phase snapshot,
- committed triggers survive same-batch opposing damage,
- attackers are locked at exchange start,
- attack stats are snapshotted only after both pre-attack batches finish,
- normal attack damage shares one simultaneousGroupId,
- an attacker removed during pre-attack does not get replaced for that exchange,
- skill damage can trigger onHurt, but only a surviving unit may react.

Update golden fixtures only for documented intentional changes. Add regression
and soak tests. Do not change board representation, add animals, or animate.
Run test, lint, build, and 10k simulation; report and stop.
```

## P5C — 全局槽位与位置服务

```text
Continue with P5C only.
Migrate battle position to global fixed slots L4..L0 | R0..R4, preserving
originOwner separately and deriving combatSide from slot. Implement a single
BoardMutationService for move, swap, push, pull, compaction, and occupancy
validation.

First preserve existing same-side gameplay. Do not enable cross-side content.
No species-specific array splice or UI-side movement rules are allowed.
Add property tests for unique occupancy, stable IDs, deterministic replay, and
all existing movement cases. Run checks and 10k simulation, report, and stop.
```

## P5D — 跨中线实验沙盒

```text
Continue with P5D only, behind an experimentalCrossSideSwap=false feature flag.
Add a developer sandbox that can construct and resolve cross-line swaps such as
L0 <-> R4. Specify and test originOwner vs combatSide selectors, normal attack
targeting, victory ownership, and the no-stall rule.

Do not attach this mechanic to production animals or normal runs. Add a visual
or textual debug trace so a human can inspect every slot after each mutation.
Run tests, lint, build, simulation, report unresolved design ambiguities, and
stop.
```

## P5E — Battle Cue Compiler

```text
Continue with P5E only.
Create a presentation-only compiler from BattleEvent[] to PresentationCue[].
Domain events must remain timing-free. Build a debug timeline view showing
simultaneous batches, paired windup/impact, chain waves, movement, and retreat.

The compiler must be deterministic, skippable, and unable to alter BattleOutput.
Add snapshot tests for representative cue timelines. Do not add polished art or
change battle rules. Run all checks, report, and stop.
```

---

## P6A — Tier 5 与内容基础设施

```text
Start P6A only from the accepted P5 tag.
Implement one shared data-driven camp-level table:
round 1=T1, 2=T2, 4=T3, 6=T4, 8=T5 and animal offer slots 3/3/4/4/5.
Use it in the camp, opponent generator, simulator, and UI. Add current tier,
next upgrade round, and just-upgraded state.

Expand AnimalDef/content validation to Tier 5 and contentVersion. Do not add all
25 animals yet. Add tests for every boundary round and locked offer slot.
Run test, lint, build, simulation, report, and stop.
```

## P6B — 分批扩充动物

```text
Continue with P6B batch <N> only.
Read docs/CONTENT_ROSTER_ZHEJIANG.md. Add no more than five animals in this
batch, prioritizing abilities already expressible by the generic DSL.

For every required new mechanic, implement a generic effect/selector and its
engine tests before referencing it from an animal. Never branch UI or engine on
speciesId. Keep all text/numbers in content data.

Update simulator reporting and content validation. Run all checks and 10k
simulation. Report each animal, reused/new mechanics, anomalies, and stop.
```

重复 P6B，直到 25 只动物全部加入。

## P6C — 模拟与初步平衡审计

```text
Continue with P6C only. Do not add features.
Run deterministic simulation cohorts across multiple fixed seeds and report
success rate, badges, run length, safety caps, tier appearance/recruitment,
animal purchase/final-team/contribution, item usage, merges, invalid commands,
and event counts.

Identify outliers and likely causes. Make only conservative data-level tuning
with before/after reports; do not hide failures by changing the auto-player to
cheat or by adding opponent-only modifiers. Keep a written balance changelog.
Run all checks and stop.
```

## P6D — 可读性标识

```text
Continue with P6D only.
Add clear placeholder UI labels for current/next tier, offer tier, habitat,
attack with a fist icon, health with a red heart, level, equipment, statuses,
and tier-up notification. Keep the art minimal and do not start P7 animation.
No domain rule may be duplicated in the UI.
Run checks, report, and stop.
```

---

## P7A — 横屏视觉基础

```text
Start P7A only from the accepted P6 tag.
Create a 1280x720 landscape visual foundation with safe-area layout and design
tokens. Draw an original Hangzhou/Jiangnan wetland placeholder background using
local CSS/SVG only: distant hills, white-wall dark-roof silhouettes, waterways,
lotus/reeds, and willow. Create reusable geometric animal portrait frames.

Do not change domain behavior, download external assets, or add complex
animation. Verify wide and narrow landscape layouts. Run checks and stop.
```

## P7B — 营地反馈

```text
Continue with P7B only.
Compile CampTransition events into presentation cues for drag lift, valid target,
snap, recruit arrival, merge approach, level badge, stat delta, and tier upgrade.
Animations must not commit domain state and must be safely skippable. Reload or
reduced-motion mode must show the already committed stable state.

Add cue snapshot tests and duplicate-click protection tests. Do not modify game
balance or battle rules. Run checks and stop.
```

## P7C — 战斗演出

```text
Continue with P7C only.
Render the accepted BattleCue timeline with paired rearward windup, simultaneous
lunge/impact, synchronized damage numbers, readable ability cues, compaction,
and non-gory fly-out retreat. Preserve pause, step, speed, and skip controls.

No domain mutation is allowed in animation callbacks. reduceMotion must replace
movement with short fades while preserving event readability. Add visual/timeline
regression tests, run checks, and stop.
```

## P7D — 结算与冠军登记表现

```text
Continue with P7D only.
Polish the single-battle result ribbon, report highlights, 10-win success page,
adoption/reward/team naming flow, and champion team card. Protect every terminal
action against duplicate submission. Keep failure wording as early return and
show discoveries before loss framing.

Do not change terminal domain rules. Add refresh/reload and rapid-double-click
regressions. Run checks and stop.
```

## P7E — 低刺激与最终回归

```text
Continue with P7E only.
Implement and verify reduceMotion, backgroundMotion, particle disable, skip
animation, no-shake default, and safe recovery after tab hide/show. Remove
high-frequency flashes and ensure the background can become completely static.

Run the complete suite, lint, build, 10k simulation, browser interaction tests,
and final manual-check documentation. Report remaining product issues rather
than silently changing rules. Stop after the final review.
```

---

## 通用 Reviewer Prompt

```text
Act as an adversarial reviewer for the just-completed phase only.
Compare the accepted previous tag to HEAD. Do not add the next phase.
Audit domain/UI boundaries, determinism, ID stability, atomicity, save migration,
exactly-once dispatch, stale pointer state, event ordering, and test quality.
For confirmed defects, add a failing regression first and make the smallest
in-scope fix. Run all phase-required commands and report severity, evidence,
remaining risks, and commit. Stop.
```
