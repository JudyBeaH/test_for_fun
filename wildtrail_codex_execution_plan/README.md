# Wildtrail Codex 执行规划包

包含：

- `P0_P2_ACCEPTANCE_CHECKLIST.md`：P0–P2 的机器、人工与 Reviewer 验收。
- `CODEX_PHASE_EXECUTION_PLAN_P3_P7.md`：P3–P7 的分阶段实现、限制、测试与停止条件。
- `CODEX_COPY_PASTE_PROMPTS_P3_P7.md`：每个子阶段可直接复制给 Codex 的 Prompt。

推荐顺序：

1. 先完成 P0–P2 验收并创建 `v0.3-p2-core-stable` 标签；
2. 一次只执行一个子阶段 Prompt；
3. 每个子阶段完成后，换新会话执行 Reviewer Prompt；
4. 人工试玩通过后再打标签进入下一阶段。
