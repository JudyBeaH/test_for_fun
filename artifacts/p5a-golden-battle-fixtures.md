# P5A Golden Battle Fixtures

Date: 2026-06-24 CST

Scope: P5A only. These fixtures freeze representative current `BattleInput -> BattleOutput` behavior before P5B changes battle phase resolution. They are mechanism fixtures, not animal-specific product tests, and contain no millisecond timing.

## Event Metadata Schema

`BattleEvent` now accepts optional top-level metadata:

- `phaseId`: coarse domain phase such as `environment`, `battleStart`, `preAttack`, `impact`, `hurt`, `retreat`, `afterAttack`, `battleEnd`.
- `batchId`: current deterministic batch label.
- `exchangeId`: normal-attack exchange label such as `x1`.
- `simultaneousGroupId`: group label for events that should be read as simultaneous, currently normal attack damage.

Existing `metadata` remains available for backwards compatibility.

## Fixtures

The canonical fixtures live in:

```text
tests/fixtures/battleGoldenFixtures.ts
```

The regression tests live in:

```text
tests/battleGoldenFixtures.test.ts
```

Current fixture count: 15.

## Maintenance Rule

Fixtures are organized around mechanics. `tests/fixtures/battleGoldenFixtures.ts` uses `MECHANIC_CARRIERS` to map each mechanism to one current content animal that happens to express it. The fixture title, coverage, and must-remain text should describe the mechanism, not the animal.

When P6 adds animals or a mechanic moves to a different representative animal:

- Do not add one golden fixture per animal.
- Add or update a fixture only when a new generic effect, selector, status, trigger, or board mutation semantics appears.
- If the carrier animal changes, update `MECHANIC_CARRIERS` and refresh the expected summary intentionally.
- Keep animal-specific balance and content coverage in content validation or simulation reports, not in golden battle fixtures.

## Coverage Map

| ID | Coverage | Must Remain |
|---|---|---|
| `golden_01_basic_draw` | draw, normal attack, simultaneous impact | Same input produces a draw with paired normal damage. |
| `golden_02_start_shield` | battleStart, shield | A battle-start shield mechanic grants front ally shield. |
| `golden_03_start_stat_buff` | battleStart, stat modification | A battle-start buff mechanic strengthens the ally ahead. |
| `golden_04_skill_damage_triggers_onhurt` | skill damage, onHurt | Skill damage can trigger a surviving target's onHurt reaction. |
| `golden_05_skill_kill_no_onhurt` | skill damage, retreat, onHurt guard | Units defeated by skill damage do not react with onHurt. |
| `golden_06_sleep_wake_empower` | status, sleep, wake, empowered attacks | Sleeping skips attack, wakes after real damage, then consumes empowered attacks. |
| `golden_07_equipment_start_damage` | equipment, battleStart damage | Equipment start damage triggers via the damage pipeline. |
| `golden_08_after_attack_move` | movement, afterAttack | An after-attack movement mechanic produces both self and promoted-ally movement events. |
| `golden_09_before_attack_buff` | beforeAttack, stat modification | A before-attack buff occurs before ordinary damage. |
| `golden_10_before_attack_lowest_damage` | beforeAttack, lowest-health skill damage | A before-attack damage selector targets the lowest-health enemy. |
| `golden_11_self_retreat_buff` | selfRetreat, retreat chain | A self-retreat buff chain remains explainable. |
| `golden_12_ally_retreat_buff` | allyRetreat, retreat chain | An ally-retreat responder reacts to ally retreat. |
| `golden_13_self_retreat_shield` | selfRetreat, shield | A self-retreat shield mechanic shields a surviving front ally. |
| `golden_14_environment_meadow` | environment, stat modification, shield | Meadow buffs the first land unit on each side. |
| `golden_15_canopy_air_support` | environment, air habitat support | Canopy uses air units to support the front. |

## Intentional Future Ordering Changes

P5B is expected to update fixture expectations only where explicitly documented:

- Battle-start equipment and abilities should be collected from clearer phase snapshots.
- Before-attack effects should be resolved for both sides before paired impact.
- Normal attack impact should share one explicit simultaneous group.
- Hurt, retreat, self-retreat, and ally-retreat reactions should be represented as waves.

P5B should not silently change:

- `BattleOutput.result`.
- Final unit health, attack, shield, position, status, and retreat state unless a fixture documents that semantic change.
- Whether guarded triggers fire, especially `onHurt` only for actual damage on surviving units.
- Deterministic replay for identical `BattleInput`.
