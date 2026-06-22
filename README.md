# Wildtrail v0.3 重构资料包

文件：

- `PROJECT_AUDIT_AND_REFACTOR_PLAN.md`：面向产品与工程的完整审计结论。
- `AGENTS_v0.3_REFACTOR.md`：可供 Codex 执行的分阶段约束。
- `CONTENT_ROSTER_ZHEJIANG.md`：25 只浙江主题动物与 Tier 1–5 草案。
- `CODEX_START_PROMPT.txt`：建议的首轮指令。

使用方式：

1. 将 `AGENTS_v0.3_REFACTOR.md` 复制为项目根目录的 `AGENTS.md`。
2. 将动物内容文档放到 `docs/CONTENT_ROSTER_ZHEJIANG.md`。
3. 先只让 Codex 完成 P0、P1。
4. 每阶段人工验证后再继续，禁止一次性大改。
