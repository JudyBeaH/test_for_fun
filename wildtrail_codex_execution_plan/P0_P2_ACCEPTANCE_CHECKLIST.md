# Project Wildtrail — P0–P2 验收清单

> 目标：确认仓库基线、十胜终局、固定槽位与原子命令已经真正稳定，再进入 P3 手势层。
> 
> 重要边界：P2 只证明“规则层能正确移动和保存”，不证明拖拽已经丝滑。拖拽体验属于 P3。

---

## A. 验收前准备

1. 在实际完成 P0–P2 的分支执行，不要直接在未知状态的 `main` 上继续。
2. 工作区必须干净：

```bash
git status --short
git log --oneline --decorate -10
```

3. 创建验收标签前，记录：
   - 当前 commit；
   - Node/npm 版本；
   - save schema version；
   - 测试数量；
   - 已知限制。

建议输出到：

```text
artifacts/p2-acceptance-report.md
```

---

## B. P0：仓库与 CI 验收

### 自动检查

从一个全新目录做 clean clone：

```bash
git clone <repo-url> wildtrail-p2-check
cd wildtrail-p2-check
npm ci
npm run test
npm run lint
npm run build
```

必须满足：

- `node_modules/`、`dist/`、`*.tsbuildinfo` 未被 Git 跟踪；
- `package-lock.json` 存在；
- GitHub Actions 与本地命令一致；
- 无“仅在原开发机器可运行”的隐式文件；
- CI 真实通过，而不是 workflow 没有触发。

### 失败即停止

- clean clone 不能构建；
- CI 与本地结果不同；
- 生成目录仍被提交；
- 为通过构建而跳过测试。

---

## C. P1：十胜与终局状态机验收

### 必须存在的自动测试

从 9 胜固定存档开始：

```text
9 badges
→ prepare battle
→ fixed winning output
→ settle battle
→ finish report
→ phase === successResolution
→ pendingBattle === null
→ choose adopted unit
→ choose two distinct rewards
→ name team
→ completeSuccessResolution
→ registered team exists
→ activeExpedition === null
```

还应覆盖：

- success phase 中存在 `pendingBattle` 时，invariant/validation 失败；
- 领养目标不在第十胜战前快照中时拒绝；
- 两个奖励重复时拒绝；
- 队伍名为空时使用默认名；
- 最终登记不包含战斗临时攻击、当前体力、护盾和触发次数；
- 页面路由只由 `phase` 决定；
- 刷新浏览器后仍停留在正确终局状态；
- 成功提交重复点击不会登记两支相同队伍。

### 人工 UI 脚本

使用开发者工具注入一个 9 胜存档：

1. 点击出发；
2. 播放、暂停、跳过战斗各验证一次；
3. 查看战斗报告；
4. 进入成功页；
5. 刷新页面；
6. 选择领养对象；
7. 选择两件纪念物；
8. 输入队名；
9. 连续快速点击登记按钮两次；
10. 查看冠军陈列；
11. 返回主页；
12. 再次刷新。

必须观察到：

- 不回到旧战斗；
- 不出现两个冠军队；
- 不丢失奖励；
- 不保留 active expedition；
- 第十胜战前队伍和 seed 正确保存。

---

## D. P2：固定槽位、原子命令和存档迁移验收

### 结构审查

必须确认：

- formation 固定 5 格；
- reserve 固定 3 格；
- inventory 固定 3 格；
- animal offers 固定 5 格；
- item offers 固定 2 格；
- 空位使用 `null`，不会自动压缩；
- UI/选择状态不再把 `area + index` 当作实体身份；
- 移动、招募、合成、释放、物品移动统一经过 `applyCampCommand` 或等价唯一入口；
- camp reducer 中不依赖 DOM、React、屏幕坐标或动画；
- 每个成功命令只触发一次保存；
- 每个失败命令零副作用。

建议静态搜索：

```bash
rg "Math\.random|Date\.now|localStorage|document\.|window\." src/domain
rg "splice\(" src/domain/camp src/domain/campEngine.ts
rg "area.*index|index.*area" src/app src/domain
```

注意：`splice` 不是全项目绝对禁止，但不应继续承担“固定槽位移动”的核心语义。

### 必须存在的领域测试

动物操作：

- formation A → formation 空位；
- formation A ↔ formation B；
- formation → reserve 第 1/2/3 任意空位；
- reserve → formation 任意空位；
- reserve 第 1 格 → reserve 第 3 格；
- formation ↔ reserve；
- offer → 指定 formation 空位；
- offer → 指定 reserve 空位；
- 同种拖到同种执行合成；
- 不同种拖到占用位执行交换，或按冻结规则明确拒绝；
- 满级不能合成；
- offer 被消费后立即变空；
- 招募补给不足时 offer、槽位、补给都不变；
- 合成后 source unit 删除，target unit ID 保持稳定。

物品结构：

- item offer → inventory 指定空位；
- inventory 第 1 格 → 第 3 格；
- 满仓时购买失败且不扣补给；
- item ID 不会重复引用。

### 不变量和随机命令测试

至少增加一个固定种子的随机命令测试：

```text
1000 sequences × 100 commands
```

每条成功/失败命令后检查：

- 每个 unitId 最多出现一次；
- 每个 itemInstanceId 最多出现一次；
- 每个 owned unit 恰好由一个槽位引用；
- 每个库存物品恰好由一个槽位引用；
- 无悬空 ID；
- 无一个槽位包含两个实体；
- 补给不是 NaN，不因非法操作减少；
- offer 不会被消费两次；
- 所有容量固定不变。

### 存档迁移

用至少三份 fixture：

1. 正常旧存档；
2. reserve/inventory 满的旧存档；
3. 部分字段缺失但仍可迁移的旧存档。

验证：

- 顺序不变；
- 实体 ID 不变；
- 新 schema 保存后可再次读取；
- 迁移只执行一次；
- 无法迁移时备份旧存档并给出可理解错误。

---

## E. P0–P2 统一人工操作矩阵

在桌面浏览器中连续重复以下动作，每项至少 20 次：

| 场景 | 预期 |
|---|---|
| 招募到指定战斗空位 | 精确落位，不跳到第一个空位 |
| 招募到替补第 3 格 | 第 3 格被占用，前两格不压缩 |
| 战斗位互换 | 不复制、不消失 |
| 战斗位与替补互换 | 两个 ID 各出现一次 |
| 同种合成 | 源消失、目标升级、属性可见 |
| 满级合成 | 明确拒绝，状态不变 |
| 空仓库存入物品 | 精确落位 |
| 满仓继续购买 | 不扣补给、不清空 offer |
| 每个动作后刷新页面 | 与动作完成后的状态完全一致 |
| 快速连续点击两次 | 不重复提交命令 |

P2 阶段可以暂时用按钮或单击模式完成这些操作。拖拽偶发丢 pointer 的问题不作为 P2 失败，但任何规则层复制、消失、错位都属于 P2 失败。

---

## F. 第二次 Codex 复审 Prompt

P0–P2 实现后，不要直接进入 P3。开启新的 Codex 会话执行：

```text
Act as a strict reviewer, not a feature implementer.
Read AGENTS.md, PROJECT_IMPLEMENTATION.md, and the complete diff from the
pre-P0 baseline to the current P2 commit.

Audit P0-P2 only:
1. clean-clone reproducibility and CI,
2. the 9-to-10-win terminal flow,
3. phase as the single routing source,
4. fixed camp slots,
5. ID-based atomic CampCommand transitions,
6. save migration,
7. camp invariants and exactly-once persistence.

First reproduce or add tests for every issue you find. Make only minimal fixes
inside P0-P2 scope. Do not implement pointer dragging, item targeting, battle
phase refactors, new animals, or animation.

Run test, lint, and build. Report:
- violations found,
- tests added,
- fixes made,
- command results,
- remaining risks,
- exact commit.
Stop after the review.
```

---

## G. 签署门槛

只有同时满足以下条件才允许进入 P3：

- clean clone 三项命令通过；
- CI 通过；
- 9→10 胜人工流程通过；
- 所有固定槽位操作的领域测试通过；
- 旧存档迁移通过；
- 随机命令不变量测试通过；
- 连续刷新不会回滚或重复动作；
- Reviewer 会话未发现 P0–P2 范围内的高风险问题；
- 创建标签，例如：

```bash
git tag -a v0.3-p2-core-stable -m "P0-P2 core accepted"
git push origin v0.3-p2-core-stable
```
