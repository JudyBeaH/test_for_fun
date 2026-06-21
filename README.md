# 野迹 / Project Wildtrail

本地浏览器轻策略原型，验证五格队列、营地选择、自动战斗、返程发现、成功登记和挑战码循环。

## Commands

```bash
npm install
npm run dev
npm run test
npm run test:watch
npm run lint
npm run build
npm run sim -- --runs 10000 --seed 20260620
```

## Notes

- UI 文案为简体中文。
- 领域规则位于 `src/domain`，不依赖 React、DOM、浏览器存储或网络。
- 存档使用 `localStorage`，损坏存档会备份到 `wildtrail_corrupt_backup`。
- README 截图位置：`docs/screenshot-placeholder.png`（原型阶段未生成）。
- 完整工程实现、架构和 bug 修复记录见 `PROJECT_IMPLEMENTATION.md`。
