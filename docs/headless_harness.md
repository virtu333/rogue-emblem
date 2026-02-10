# Headless Battle Harness

A headless battle testing system that runs tactical grid combat without Phaser, enabling deterministic testing, fuzz testing, and replay-based debugging.

## Quick Start

```bash
# Run all harness unit tests (43 tests, ~350ms)
npm run test:harness

# Run scripted agent on 20 seeds (PR gate, ~5s)
npm run test:harness:pr

# Fuzz 100 seeds on act1_rout_basic
npm run fuzz

# Fuzz all scenarios with 500 seeds (nightly)
npm run fuzz:nightly
```

## Commands

| Command | What it does | Speed |
|---------|-------------|-------|
| `npm run test:harness` | Unit tests: HeadlessBattle, GridParity, Determinism, Fuzz | ~350ms |
| `npm run test:harness:pr` | 20 seeded scripted runs on act1_rout_basic | ~5s |
| `npm run fuzz` | 100 seeded scripted runs on act1_rout_basic | ~30s |
| `npm run fuzz:nightly` | 500 seeds × all scenarios (scripted) | ~5min |

### CLI Options

```bash
node tests/agents/fuzz-runner.js [options]
  --seeds N           Number of seeds to run (default: 10)
  --scenario NAME     Fixture name (default: act1_rout_basic)
  --all-scenarios     Run all fixtures
  --agent TYPE        "scripted" or "fuzz" (default: scripted)
  --max-actions N     Max actions per run (default: 2000)
```

## Architecture

```
tests/harness/
  HeadlessGrid.js      Pure Grid algorithms (extracted from Grid.js)
  HeadlessBattle.js    7-state battle machine using real engine functions
  GameDriver.js        Action API: listLegalActions/step/snapshot
  Invariants.js        Post-step invariant checks + phase watchdogs

tests/agents/
  ScriptedAgent.js     Priority-based tactical policy (deterministic)
  FuzzAgent.js         Random legal action selection
  ScenarioRunner.js    Seed + fixture + agent → run loop + replay
  fuzz-runner.js       CLI entry point

tests/fixtures/battles/
  act1_rout_basic.json   Default 2-lord roster, rout objective
  act2_seize_basic.json  4-unit roster, seize objective, boss battle
  healer_heavy.json      Tests staff mechanics
```

### Key Design Decisions

- **Not mocking Phaser.** HeadlessBattle calls the same pure engine functions (Combat.js, SkillSystem.js, UnitManager.js, etc.) that BattleScene uses, but resolves everything synchronously.
- **7 MVP states:** PLAYER_IDLE, UNIT_SELECTED, UNIT_ACTION_MENU, SELECTING_TARGET, SELECTING_HEAL_TARGET, ENEMY_PHASE, BATTLE_END
- **Canto disabled** (`CANTO_DISABLED = true`). Always passes `skipCanto: true`.
- **Deferred actions** (Equip, Promote, Item, Trade, etc.) are listed in `getAvailableActions()` but marked `supported: false`. Agents skip them.
- **Deterministic via SeededRNG** — all randomness goes through `Math.random()` which is overridden with Mulberry32 PRNG.

## Invariants Checked

After every action step:

1. **HP bounds** — every unit has `0 < currentHP <= stats.HP`
2. **No orphan dead** — no unit with HP≤0 in arrays
3. **Position uniqueness** — no two units at same (col, row)
4. **Weapon consistency** — equipped weapon is in inventory
5. **State legality** — battleState is in MVP enum
6. **Turn monotonicity** — turn number never decreases
7. **Edric alive** — Edric in playerUnits unless BATTLE_END
8. **Canto disabled** — CANTO_DISABLED flag is true

Phase watchdogs:
- Enemy phase processes ≤ `enemyCount × 3` actions
- Same unit selected 5+ times without any unit acting → loop
- Same state hash for 30+ consecutive steps → stuck

## Replay Artifacts

Failed runs write JSON to `tests/artifacts/replays/`:

```json
{
  "schemaVersion": 1,
  "harnessVersion": "0.1.0",
  "seed": 12345,
  "scenarioId": "act1_rout_basic",
  "initialHash": "...",
  "periodicSnapshots": { "10": "...", "20": "..." },
  "actions": [{"i":0,"type":"select_unit","payload":{"unitName":"Edric"}}],
  "result": "victory",
  "failure": null
}
```

Results: `victory`, `defeat`, `timeout`, `stuck`, `error`, `invariant_violation`

## Triage Flow

1. Check the replay JSON for `failure.invariant` and `failure.message`
2. The `failure.actionIndex` tells you which step triggered the violation
3. Replay actions 0..N-1 with the same seed to reproduce
4. `periodicSnapshots` (every 10 steps) help narrow divergence

## Acceptance Gates

- Deterministic replay parity on fixed seeds
- Zero invariant violations on agreed seed set
- Bounded runtime (harness tests < 1s, PR gate < 10s)

## Scope & Limitations

**In scope (MVP):** select, move, attack, heal, wait, seize, talk, end_turn, cancel

**Deferred:** Equip, Item, Promote, Accessory, Trade, Swap, Dance, Shove, Pull, Canto, Fog of war, Loot, Shops, Boss recruit
