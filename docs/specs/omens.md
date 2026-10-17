# Omens (Heat), shown as Knots

Player-facing name: **Knots** (the thread motif; the owner, 2026-10-17). Ids, data keys
(`difficulty.json` `omens`), the run-format capability, saves and storage keys keep `omens`.

Opt-in challenge modifiers for a run, in the style of Hades' Heat. Design and measurements:
`/mnt/project-files/reviews/ascension-true-ending.md` §3 (project files). This page is the
contract as built.

## Who sees them

- Rungs: Nightfall (`hard`) and Black Sun (`lunatic`), NG+ or not (`difficulty.json`
  `omens.rungs`; `Omens.omensAllowedOn`).
- Unlock: a Black Sun win on the slot (the `beatLunatic` milestone, `OMENS_UNLOCK_MILESTONE`).
- Echo (NG+, `docs/specs/ng-plus.md` §13) is separate and never counts as Heat.

## Data

`data/difficulty.json` top-level `omens = { rungs, list }`. Each Omen is
`{ id, name, lore, ranks: [{ heat, text, effects }] }`. A rank's entry is whole (rank 2 lists
rank 2's total heat and effect, not the step from rank 1). `validateOmensConfig`
(`npm run validate:data`) requires rising heat, text of 1-90 characters, known effects, and that
every effect makes the run harder (an Omen is never a boon).

| Omen | Ranks | Effect |
|---|---|---|
| Hardened | 3 | enemy stats +1/+2/+3 |
| Iron Tide | 2 | +1/+2 enemies per map |
| Keen Foes | 1 | every foe carries a combat skill (skill chance 1) |
| Marked Foes | 2 | affixes ×1.5/×2, +1 most affixes per foe |
| Short Fuse | 2 | par inflation −1/−2 (bosses enrage sooner, as enrage reads par) |
| Hunting Party | 1 | a Hunted wave in every non-boss battle |
| Long Night | 2 | the Eclipse gains 25%/50% faster |
| Thin Ranks | 1 | deploy 1 fewer |
| Lean Purse | 2 | gold ×0.8/×0.6 |
| Dear Market | 2 | shop prices ×1.2/×1.4 |
| Spent Thread | 3 | 1/2/3 fewer Vision at run start |
| Grave Road | 1 | the Ruins revive no one |
| The Rite Listens | 1 | the Descent's Rite starts 3 words higher |
| Stone-hearted | 1 | +1 Revival Stone on every boss kind and elite captain (never the Entity) |

## As built

- **Choice to record.** `RunManager.startRun({ omens })` (ranks `{ id: rank }`) calls
  `overlayRunOmens` right after the rung is applied: `run.omens = { v: 1, ranks, heat, effects }`
  (null for none, or a rung that has no Omens), saved by `RunSerialization`, read back by
  `sanitizeOmensRecord`.
- **Levers.** `enemyStatBonus`, `enemyCountBonus`, `enemySkillChance`, `deployLimitBonus` and
  `parInflation` are added, `goldMultiplier` and `shopPriceMultiplier` multiplied, onto the run's
  difficulty modifiers (`applyOmenModifiers`, a copy); an add also reaches every `actOverrides`
  entry that sets the key (Black Sun's Act I). The modifiers are saved with the run, so every
  reader (scene, scout, harness) plays them unchanged. `deployLimitBonus` is read by
  `RunManager.getDeployBonus`.
- **Run effects** (`omenEffect(run, key)`): `huntedWave` and `affixChanceMultiplier` /
  `affixMaxBonus` (the extra slot rides `battleParams.eclipseAffix.extraMaxAffixes`) in
  `engine/HeatParams.js`, the one place NG+ Echo and Omens touch a battle's params (last in
  `getBattleParams`); `visionDelta` and `shadowGainDelta` once at run start (`applyOmensAtStart`:
  the shadow share is laid on the quarter-step `eclipseGainDelta` Darkened Dawn raises, so its
  saved carry keeps the gain exact); `noRuinsRevive` in `RuinsCommands.ruinsReviveBlock`;
  `riteStartDelta` in `RunManager._riteStart`.
- **Run format.** Capability `omens` (`run.omens`): an older client would keep the levers but
  drop the rest, so the run is refused there and stays local-only while
  `CLOUD_SAFE_RUN_FORMAT` is 1.
- **Records.** A won run with Heat records the meta milestone `heat:<rung>:<heat>`
  (`heatVictoryMilestone`; milestones union across copies and the cloud, so a best is never lost)
  and its victory record carries `heat`. `bestHeatOn(milestones, rung)` reads the best.
- **UI.** The difficulty screen's Knots picker ("Knots: Heat N", remembered per slot on the
  device), the pause list's "Knots · Heat N" entry. The route map calls a node a "stop", never a
  knot, so the word means only these.

## Not built yet

Armed Host, Far Reach, Shieldbearers (with the accessory thread's shield rule), Captains' Roll,
Stone-hearted rank 2 (Hollow Hearts: Entity health bars), Grave Road's dearer church revives,
Heat rewards (slot-card trims, more veterans), the true ending.

Tests: `tests/Omens.test.js`.
