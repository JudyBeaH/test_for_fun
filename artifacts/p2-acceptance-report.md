# Project Wildtrail P0-P2 Acceptance Report

Date: 2026-06-22 22:19:11 CST

## Repository

- Branch: `refactor/v0.3-stability`
- Base HEAD before this acceptance pass: `1577520c3dbfe695908bdc94d9318390f62426ea`
- Node: `v25.6.1`
- npm: `11.9.0`
- Save schema version: `3`

## Scope

Validated and minimally tightened P0-P2 only:

- P0 repository hygiene, CI parity, clean install reproducibility.
- P1 ten-win terminal success flow and success registration validation.
- P2 fixed camp slots, ID-based atomic camp commands, save migration, and invariants.

No P3-P7 work was implemented.

## Changes Made In This Pass

- UI selected member focus now stores only stable `instanceId`; slot focus remains a slot target.
- `completeSuccessResolution` rejects duplicate registration for the same final `sourceRunId + sourceBattleId`.
- Added P1 invalid-input coverage: lingering `pendingBattle`, invalid adoption target, duplicate rewards, blank-name fallback, duplicate registration.
- Added P2 coverage: full-level merge rejection, different-species swap semantics, exact inventory placement, full inventory atomic failure.
- Replaced the small random camp move test with `1000 sequences x 100 commands`, checking invariants after every success or failure.
- Added save migration fixtures for full legacy reserve/inventory, partial legacy fields, idempotent remigration, and corrupt-save backup.

## Command Results

Local working tree:

```text
npm run test
8 files passed, 47 tests passed

npm run lint
passed

npm run build
passed
```

Clean dependency check:

```text
git clone --no-hardlinks <local repo> work/wildtrail-p2-check
git apply work/p2-current.diff
npm ci
npm run test
npm run lint
npm run build
```

Result:

```text
npm ci: 141 packages installed, 0 vulnerabilities
npm run test: 8 files passed, 47 tests passed
npm run lint: passed
npm run build: passed
```

Static checks:

```text
git diff --check: passed
git ls-files node_modules dist '*.tsbuildinfo': no tracked generated dependency/build outputs
.github/workflows/ci.yml: npm ci, npm run test, npm run lint, npm run build
```

Simulation:

```text
npm run sim -- --runs 1000 --seed 20260620
successRate=0.0% averageBadges=3.72 averageRounds=8.27
avgEvents=59.5 drawRate=6.6% safetyCaps=0
report=artifacts/sim-report.json
```

## Acceptance Notes

- P1 terminal flow is covered by the `9 badges -> prepare -> win -> finish report -> successResolution -> pendingBattle null -> complete success` domain test.
- Success registration now prevents repeated registration of the same final battle.
- P2 fixed slot and atomic command behavior is covered by targeted tests and deterministic random command pressure.
- Legacy save migration is covered for normal, full, partial, and corrupt-save cases.

## Remaining Risks

- Browser-level manual UI matrix was not fully automated in this pass because this thread did not expose a browser-control tool and the project does not include Playwright. The dev server booted successfully at `http://127.0.0.1:5174/`, and the terminal flow is covered at the domain level.
- Drag feel, drop registry, click/drag parity, and pointer cancellation remain P3 scope by design.
- Item group/all target UX remains P4 scope by design.

