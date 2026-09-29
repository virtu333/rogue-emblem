# Spec: Gaspar, the Veteran Knight

**Status:** Revised proposal, 2026-09-29. Documentation and calculations only.
Implementation starts after review of the provisional stat line and validation plan.
**Scope:** Default starting non-lord on all four difficulties; Rapier balance adjustment;
cosmetic no-meta victory badge; bespoke character presentation.
**Analysis baseline:** main at `f5f748f12b1e4e25150732f9974384f45a81a0d3`.
This replaces the earlier opt-in STR11 / full-Canto proposal and its uncommitted calculations.

## Intent and confirmed decisions

Gaspar is an experienced promoted Paladin with reliable opening combat, limited learning,
and poor long-term growth. He enables a less account-dependent opening and teaches weapon
choice and roster development. An extra competent action each turn is the main early benefit;
poor growths determine its duration. Normal may become easier, but must retain meaningful decisions.

Confirmed by the designer:

- Gaspar joins **every new ordinary run**, including the first run, on all four difficulties.
  No Veteran toggle, unlock or separate mode. The scripted tutorial retains its own roster.
- STR10 and SPD10 on every difficulty. Harder rungs receive modest defensive adjustments,
  rather than offensive scaling to reproduce Normal kill rates.
- Increase base SKL to reflect experience; increase DEF and reduce HP from the previous
  HP22 / DEF4 proposal. Exact numbers below are recommendations for discussion.
- Fixed, slightly higher but still poor growths; half-rate home-base growth bonuses.
- **Cannot reclass.** Promoted from arrival; cannot promote again.
- Iron Sword and Steel Lance, with Steel Lance initially equipped.
- Restricted Canto: remaining movement after permitted noncombat actions; none after initiating combat.
- Ordinary kill credit and Mentor's Band rules. No assist split or targeted anti-feeding penalty.
- In-run investment applies normally: blessings and their costs, forging, weapon trading,
  accessories, stat boosters and scrolls. Home-base join bonuses remain restricted.
- Gaspar counts toward opening Cavalier eligibility. Keep the Vanguard Paladin roll.
- **Rapier might 7 → 6**; all other Rapier fields remain unchanged.
- A no-meta victory earns a cosmetic badge, independent of Gaspar's survival or deployment.
- Bespoke art and character lines are part of delivery, not optional generic placeholders.
- Name: **Gaspar**, special-character id `old_knight`. He is not a lord.

## Recommended provisional numbers

These are candidates supported by the calculations below, not implemented or shipping-approved.

| Difficulty | HP | STR | MAG | SKL | SPD | DEF | RES | LCK | MOV |
|---|---|---|---|---|---|---|---|---|---|
| First Light | 18 | 10 | 0 | 12 | 10 | 6 | 2 | 3 | 6 |
| Dusk | 19 | 10 | 0 | 12 | 10 | 6 | 2 | 3 | 6 |
| Nightfall | 20 | 10 | 0 | 12 | 10 | 7 | 2 | 3 | 6 |
| Black Sun | 21 | 10 | 0 | 12 | 10 | 8 | 2 | 3 | 6 |

**Why HP18 / DEF6:** armor and technique rather than a large health pool. In the controlled
comparison, it improves three-round physical survival over HP22 / DEF4 without making him
as persistent as HP20 / DEF6 or HP18 / DEF7. Low HP / RES leaves magic dangerous.
HP20 / DEF5 is the conservative alternative if HP18 feels too brittle.

**Growths on every rung:** HP20 STR10 MAG0 SKL15 SPD10 DEF5 RES5 LCK5, total 70
(previously 60). No difficulty growth deltas initially: the small common increase addresses
the request without adding another scaling system. Revisit only if full-run evidence warrants it.

- Actual expected total gain is **1.17 points per level**, including the guaranteed-stat fallback.
- Expected HP gain is **0.67 per level**, not 0.20: all failed rolls fall back to the
  highest-growth stat, HP. Eight levels add roughly 5.4 HP in expectation.
- Max half-rate Normal meta growths add +13 percentage points per stat and raise expected
  total gain to **1.88 points per level**. Difficulty-scaled equivalents are about
  1.75 Dusk, 1.69 Nightfall and 1.45 Black Sun.
- Round once: `Math.round(rawMetaBonus * difficultyGrowthMultiplier * 0.5)`.
  Do not round at an intermediate step.
- Blessing bonuses/costs use the ordinary difficulty scaling, with no additional 0.5.
  Preserve ordinary behavior for negative growths; do not grant discounted pact costs.

Class curriculum and class mastery remain disabled in the proposed v1. This prevents
Wayfarer (+ATK / SPD), Ride Down (+3 ATK) and the inherited Sol curriculum from undoing
the authored role. Scrolls and other deliberately earned skill sources remain legal.
Aegis is retained; the Canto restriction does not remove his ordinary class identity.

## Reproducible combat analysis

Supporting files:

- [Executable calculation appendix](veteran-knight-calculations.md)
- [Full results and assumptions](veteran-knight-calculations-results.md)

The script calls the actual engine's `generateBattle`, `createEnemyUnit`,
`createPromotedEnemyUnit`, `getCombatForecast`, `resolveCombat`, skill resolution,
2RN hit probability and XP formulas. No gameplay files or source data are changed.

**Sample:** 595 generated rout maps per rung, 85 for each non-boss Act 1 row (0–6),
three deployed units, Cavaliers permitted. First row is Fighter-only. This weights each
prospective row equally; it is not a distribution of actual player routes or node choices.
Each offense/survival comparison uses 6,000 seeded trials over the generated enemy population.

**Definitions:**

- Potential ORKO: forecast damage × attack count reaches full enemy HP, assuming hits,
  ignoring crits and the possibility that a counter kills Gaspar before a follow-up.
- Actual kill: a resolved player-initiated combat, including real 2RN, crits, counters and Aegis.
- Forecast HP damage: average damage capped at 100% enemy HP; it is not realized expected
  damage, because misses and interrupted follow-ups are not deducted.
- Survival after N enemy rounds: fresh random enemies initiate successively; Gaspar counters
  when legal; bows attack at range 2; no healing. A round may contain two incoming strikes.
  These are **rounds**, not a guaranteed count of landed hits.

**Limits:** plain terrain except explicit sensitivity checks; no movement/Canto,
Sera healing, resource economy, random learned enemy skills, affixes, poison, status weapons,
throne or boss enrage. Act 2 uses equal weights across its 11 attacking base classes,
not map-weighted composition. Bosses include the runtime **+2 to every stat**
(`BOSS_STAT_BONUS`) after canonical creation and the boss crit reduction.
The model does not prove a boss cannot be soloed with healing or terrain.

At 6,000 independent trials, a 50% Monte Carlo proportion has approximately ±1.3 percentage
points of 95% sampling error. Enemy-population sampling and omitted systems add uncertainty.
Use these numbers to select a prototype, not as full-run shipping gates.
Earlier uncommitted percentages are superseded, not directly comparable under different samples.

The appendix contains the exact executable source used for this report; it is documentation,
not a gameplay module. To reproduce the recorded report, use engine checkout `f5f748f12b1e4e25150732f9974384f45a81a0d3`, copy this
appendix's JavaScript code block into `docs/specs/veteran-knight-calculations.mjs` there, then run from that checkout:

```sh
node docs/specs/veteran-knight-calculations.mjs > /tmp/gaspar-calculations.json
```

### HP / DEF tradeoff on First Light

All rows below hold STR10, SKL12 and all other non-HP/DEF stats constant.

| Candidate (HP / DEF) | Survive 2 rounds, sword / lance % | Survive 3, sword / lance % | Survive 4, sword / lance % |
|---|---|---|---|
| 22 / 4 | 96.9 / 85.6 | 36.7 / 29.6 | 9.9 / 6.6 |
| 20 / 5 | 96.9 / 86.1 | 41.4 / 33.9 | 12.2 / 8.3 |
| 20 / 6 | 99.6 / 93 | 60 / 53 | 23.1 / 18.1 |
| 18 / 6 | 97.1 / 86.5 | 47.4 / 39.8 | 15.5 / 11 |
| 19 / 6 | 99.1 / 91.1 | 53.2 / 47 | 18.9 / 14.4 |
| 18 / 7 | 99.8 / 93.3 | 69.6 / 60.3 | 31.3 / 25.3 |

Higher DEF protects every hit and makes each point of healing more valuable. Lowering HP
does not provide a one-for-one offset. This is why HP18 / DEF7 is not the recommendation.
The original STR11 / SKL7 / HP22 / DEF4 line was rerun separately in the JSON.

### Role by difficulty

| Difficulty | HP | DEF | Sword kill % | Lance kill % | Lance forecast HP damage % | Survive 2 rounds sword / lance % |
|---|---|---|---|---|---|---|
| First Light | 18 | 6 | 46.3 | 7 | 69.1 | 97.1 / 86.5 |
| Dusk | 19 | 6 | 42.4 | 3.2 | 65 | 95.9 / 83.7 |
| Nightfall | 20 | 7 | 1.5 | 0.9 | 51.8 | 93.7 / 76.1 |
| Black Sun | 21 | 8 | 0 | 0.1 | 38.3 | 82.2 / 41.2 |

Sword AS9 / lance AS4 are unchanged across rungs. On Normal/Dusk he can kill weak enemies
with the sword and train allies with the lance. On Nightfall/Black Sun he is a **reliable
helper**, not an opening one-round killer. Defensive boosts do not cancel the higher enemy
offense. Black Sun's lance exposure is particularly dangerous because enemy speed can
enable follow-ups; switching to the sword before baiting matters.

**Discussion point:** accept this support role on higher rungs? Restoring sword kills there
would require changing the confirmed STR/SPD constraint or providing stronger equipment.
A small late-game growth increase would not solve that opening threshold.

### Normal matchup detail

| Enemy class | Sword potential / actual kill % | Lance potential / actual kill % | Lance capped forecast HP damage % |
|---|---|---|---|
| Fighter | 98.4 / 98.5 | 0 / 3.6 | 60.9 |
| Soldier | 0 / 5.3 | 0 / 2.6 | 56.6 |
| Cavalier | 0 / 3.1 | 0 / 1.4 | 59.5 |
| Archer | 93.4 / 93.5 | 0 / 1.5 | 82.9 |
| Myrmidon | 0 / 0.5 | 27.1 / 27.1 | 93.9 |

The Steel Lance still kills level-1 Myrmidons through mastery weapon-triangle advantage.
It is not a universal feeding weapon. Higher SKL improves lance true hit from about 88.9%
at SKL7 to 96.2% at SKL12 in this sample. It also increases incidental crits:
mean forecast crit rises from roughly 0.3% to 2.3%, which can occasionally spoil a planned feed.
Aegis activation rises from 7% to 12% against magic.

### Support and terrain sensitivities

- Edric's nearby Charisma raises average lance true hit to **99.6%**.
- A forest defender lowers lance true hit to **77.5%**
  and sword actual kills to **39.5%**.
- Sera's adjacent Renewal Aura restores 3 HP per player turn. It is **not simulated here**;
  lower incoming physical damage can make repeated heal-and-bait play substantially stronger.
- A traded might-6 Rapier raises Gaspar's Normal actual kill rate to
  **66.9%** in this sample.
  `signatureOf` identifies the weapon's source; existing proficiency rules do not bind
  it to Edric. This is an **intended tradeoff from investing in the Rapier meta upgrade**. Trading
  it to Gaspar spends Edric's access to the same weapon and is not a loophole to suppress.
  Keep it in full-run validation to understand the resulting party choices, not to force
  meta-enabled damage back into the no-meta target band.

### Act 2 falloff, Normal, static starting stats

| Act 2 enemy level | Sword / lance actual kill % | Survive 2 rounds sword / lance % |
|---|---|---|
| 3 | 26.2 / 17.4 | 83.6 / 83.4 |
| 5 | 14.2 / 7 | 66.8 / 59.7 |
| 6 | 19.4 / 6.7 | 34.8 / 32.6 |
| 8 | 8.1 / 2.3 | 27.9 / 21.6 |

The level-6 Steel weapon transition changes both damage and attack-speed thresholds, so kill
rates need not decline monotonically. No level-ups or investment are included here.
Keeping Gaspar useful through items is a legitimate player decision; automatic act scaling is not.

### Boss safety

| Normal boss | Sword / lance forecast HP damage % | Survive one enemy round, sword / lance % |
|---|---|---|
| Iron Captain | 27.7 / 43.9 | 99.4 / 99.4 |
| Warchief | 74.7 / 44.4 | 100 / 100 |
| Knight Commander | 2.3 / 15.7 | 5.9 / 25.8 |
| Archmage | 31.2 / 46.2 | 12.3 / 4.5 |
| Dark Rider | 2.3 / 15.7 | 15.8 / 39.8 |

Gaspar cannot kill either Act 1 boss from full HP in one ordinary round in this baseline.
The Act 2 bosses are dangerous to initiate against: the mean counter damage against
Knight Commander is about 20 with the sword, exceeding Gaspar's starting HP18.
Do not describe all bosses as unconditional one-shots: enemy growth rolls, hit rolls,
follow-ups, weapon choice and Aegis change the outcome.

## Rapier adjustment and feeding

**Proposed future data edit:** `data/weapons.json`, Rapier `might: 7 → 6`, then normal
data sync/schema/parity validation. No change to weight2, hit95, crit5, range, price,
effectiveness, rank or identity.

Effectiveness multiplies weapon might, so the nerf is **-1 damage per hit normally,
-2 against Armored/Cavalry**, before other modifiers. On a double, those become -2 / -4.

L1 Edric, no stat meta, Rapier equipped, plain terrain, L1 Normal enemies:

| L1 Normal enemy | HP | Edric Rapier 7 → 6: damage per hit | Potential round damage 7 → 6 |
|---|---|---|---|
| Fighter | 22 | 10 → 9 | 20 → 18 |
| Soldier | 21 | 6 → 5 | 12 → 10 |
| Cavalier | 20 | 13 → 11 | 26 → 22 |
| Knight | 22 | 8 → 6 | 16 → 12 |

Edric still potentially kills a fresh L1 Cavalier with the nerfed Rapier. After one
Gaspar lance hit, that Cavalier has 7 HP, so either Rapier version finishes in one hit.
The nerf trims the combination but does not eliminate its basic safety.

Two sequential player actions against the same sampled Normal Act 1 enemies:
Gaspar's Steel Lance first, then fresh L1 Edric if the enemy and Gaspar survived;
no aura/terrain/healing, actual crits and 2RN included:

| Edric's weapon | Edric kills: % of all starting targets | Edric kills: % of surviving chipped targets | Combined two-action kill % |
|---|---|---|---|
| Iron Sword | 53.8 | 57.7 | 60.5 |
| Rapier 7 | 84.6 | 90.7 | 91.3 |
| Rapier 6 | 79.2 | 84.9 | 85.9 |

This measures a local kill opportunity, **not** Edric's full-run XP ceiling, safe positioning
or enemy-phase exposure. The Iron Sword row is the relevant ordinary no-meta starter.
Rapier normally enters through Deadly Arsenal, so its nerf primarily trims a meta-enabled
opening; do not count it as a universal offset for adding Gaspar. The designer explicitly
accepts transferring this meta-earned advantage to Gaspar as an intended equipment tradeoff.

**Existing saves:** weapons are stored as instance snapshots. Proposed v1 policy is that
new runs/newly created Rapiers use might6; ongoing saved weapons keep their existing stats
and forge history. No retroactive item migration in this feature. Confirm this policy before
implementation if balancing all resumed runs is required.

Keep full normal kill credit. Allow Mentor's Band under its existing adjacency/effective-level
rules; it is a later acquired accessory, **not an added starting item**.
Test party-wide XP, not only commander XP. A different starting lord must remain supported.

## XP, meta and roster side effects

Promoted effective XP level is visible level +12. At promoted L1, base awards against
base-tier enemies are:

| Enemy level | Kill XP | Non-kill formula XP |
|---|---|---|
| 8 | 1 | 1 |
| 9 | 9 | 2 |
| 10 | 25 | 10 |
| 12 | 35 | 20 |

Actual awards additionally apply chip ratio, survival minimum, reward/turn/difficulty modifiers.
Normal ordinary enemies remain at ≤8 in Act 2; Dusk/Nightfall can reach9, Black Sun10.
Bosses and promoted enemies use their own effective levels. Team XP from gold choices and
arena rewards are additional sources. No special XP multiplier initially.

| Source | Gaspar rule |
|---|---|
| Home-base recruit growth upgrades | Half rate × ordinary difficulty multiplier |
| Home-base recruit flat stats and join loadout/perks | None; deterministic fixed join state |
| Training Doctrine | Ordinary non-lord combat XP bonus |
| In-run blessings, pacts, forges, accessories, boosts, traded weapons, scrolls | Ordinary scope/effects/costs; no Gaspar-specific penalty |
| Lord-only effects | Do not apply |
| Class curriculum/mastery | Disabled in proposed v1 |
| Reclass seals | Cannot target Gaspar; explanation shown before spending |
| Church revival | Ordinary non-lord rules and cost |

Exclude Gaspar from recruit-node join-level averages and revival catch-up target averages.
At creation he otherwise counts as level11 for recruit-node averaging and would inflate
early recruits. Audit shared team-level helpers for the same exclusion.
His own revival catch-up remains ordinary; reduced revival growth rolls still have the
guaranteed-stat fallback, and can sometimes grant more than one point.

Let him count toward opening cavalry eligibility, including the persisted fallen roster.
The first Fighter-only battle remains Fighter-only under the existing rule.
Keep Vanguard's Paladin pool and allow both units to coexist.

Do not assume an additional deployment always adds an enemy:
Normal/Dusk Act 1 deployment scaling caps at3; Nightfall/Black Sun enemy-count bases are
floors5/6; density caps can bind. This is an existing rule, not a targeted counterbalance.
Four-starter and larger-party tests are required.

## Identity, presentation and authored content

Gaspar is a named non-lord with ordinary recruit death/revival and no lord-only Talk/Seize rights.
Use stable `specialCharId`, not display-name checks. Reserve Gaspar from generic name rolls.
No special lord entry or automatic insertion into lord recruitment pools.

**Required art scope:**

1. Bespoke portrait, matching the current portrait renderer (128×128 target), readable in
   roster/details/dialogue and on mobile. Do not reuse a Cavalier face as the final asset.
2. Bespoke mounted map/battle sprite matching the active renderer and its action states.
   Maintain a readable old-knight silhouette: grey hair, worn practical armor, restrained
   crest, visibly experienced rather than decrepit. Sword/lance presentation must be coherent.
3. Use the current rebuilt-sprite source/manifest/bake/sync path: source art is retained,
   shipped textures follow the current 64×64 tile texture footprint. Match current asset
   contracts and texture lookup behavior; do not load an oversized raw render at runtime.
4. Verify transparent edges, alignment, selection/acted/death appearance and portrait-mode
   battle presentation. Asset lookup follows `specialCharId`, independent of `isLord`.
5. No requirement for a new audio voice actor or new combat animation system. Text and art
   must have their own character identity while using the existing presentation machinery.

**Required text scope:** one run-start introduction, a character bio, combat/bait acknowledgments,
minor and major level-up lines, low-HP warnings, last words, revival acknowledgment,
victory/ending presence where appropriate, and the restriction/help text.
Use a dedicated special-character voice namespace with ordinary class fallback.
Lines that mention a specific lord require that lord's presence; Gaspar joins alternate pairs too.
Do not put him in the lord voice-count, recruit or finale-rally pools by accident.

Draft tone and lines for review (authoring proposals, not final content):

- Bio: "The wars taught Gaspar what armor stops, and what it does not. He has little
  left to learn and younger soldiers left to teach."
- Introduction: "Let me take the first blow. You decide where the second lands."
- Lance acknowledgment: "Watch the opening. It is yours."
- Sword acknowledgment: "Some lessons are best ended quickly."
- Minor level-up: "A little left in these old bones."
- Major level-up: "Apparently I am not finished."
- Low HP: "Armor has its limits. So do I."
- Last words: "Keep the line. You know how."
- Revival: "Once more, then. Do not make a habit of it."
- Victory: "You carried the last mile. That was always the plan."

The UI must explain low growth/XP, half-rate home-base growths, fixed starting kit,
no reclass, restricted Canto and no class curriculum/mastery.
Avoid describing him merely as a regular Paladin with hidden exceptions.

## Restricted Canto contract

Gaspar alone uses the restricted policy; all other Paladins retain normal Canto.

- Remaining MOV only: pre-action and post-action movement share one terrain-cost budget.
- Combat initiation blocks Canto for that activation even if it misses, kills nothing,
  uses a weapon art or gains a level.
- Permitted noncombat actions (item use, support/interaction actions available to this
  non-lord, and Wait where the current flow supports it) can allow remaining movement.
- Forecast/cancel does not count as initiated combat.
- A later trade/equip/menu step must not reopen Canto after an attack.
- Enemy-phase counters do not permanently disable the next player activation.
- A legal dance refresh starts a fresh activation under normal rules.
- Suspend/resume, rewind and queued level-up continuations preserve the action category and
  remaining movement. Use the shared action-completion policy and serialize facts where needed.
- Root/status restrictions still apply. Do not special-case only the visible Attack menu.

## No-meta victory badge and saves

Badge condition: **victory && run.noMetaMode === true**. No Gaspar-alive/deployed test.
It is cosmetic: no additional currency, stat unlock or gameplay payout.

Persist the provenance from run start through save/cloud/settlement/run history.
Add `noMetaMode` to the run-record whitelist and render the badge with difficulty.
Optional account-level "first no-meta clear" may mirror this cosmetic achievement.
Do not infer no-meta from an empty upgrade tree or zero bonuses. Old unknown records do not
receive the badge retroactively.

Every newly created ordinary roster appends Gaspar after the starting lords, before Vanguard.
Creation and blessing-screen rebuilds must be deterministic and idempotent.
**Existing runs remain unchanged:** do not inject him on load or into a suspended battle.
There is no player-facing Veteran mode to persist; analysis-only with/without arms are separate.
His identity, rules and authored stat/growth state survive normal serialization and revival.

## Future implementation map (no implementation in this revision)

| Area | Planned change |
|---|---|
| Special-character data/schema/loader | Authored Gaspar entry; every difficulty id present; defensive deltas; explicit policies |
| Pure creation module | Deterministic special-character construction and meta-growth application |
| Run start/rebuild/fast path | Default inclusion once on new ordinary runs; no toggle; no old-save injection |
| UnitManager/reclass UI | Shared cannot-reclass guard, preview/target filters and mutation protection; message before seal consumption |
| Action completion and harness | Shared restricted-Canto policy; attack facts preserved through saves/rewinds/level-up continuations |
| Mastery/curriculum | Explicit opt-out; earned skill sources remain functional |
| Recruit/revival scaling | Exclude Gaspar from target averages |
| Weapons data | Rapier might6 for new item instances; existing snapshot policy as above |
| Records/settlement/UI | No-meta provenance and cosmetic victory badge, difficulty retained |
| Special art/voice | Bespoke assets, manifest routing, dedicated lines, generic fallback |
| Data/content pipeline | Source data + runtime sync, schemas/parity/content checks when implemented |

Illustrative special-character policies (names are provisional, not an existing schema):

```json
{
  "id": "old_knight",
  "name": "Gaspar",
  "className": "Paladin",
  "baseClass": "Cavalier",
  "level": 1,
  "baseStats": {"HP":18,"STR":10,"MAG":0,"SKL":12,"SPD":10,"DEF":6,"RES":2,"LCK":3,"MOV":6},
  "statDeltasByDifficulty": {
    "normal": {},
    "dusk": {"HP":1},
    "hard": {"HP":2,"DEF":1},
    "lunatic": {"HP":3,"DEF":2}
  },
  "growths": {"HP":20,"STR":10,"MAG":0,"SKL":15,"SPD":10,"DEF":5,"RES":5,"LCK":5},
  "inventory": ["Steel Lance","Iron Sword"],
  "equipped": "Steel Lance",
  "metaGrowthScale": 0.5,
  "canReclass": false,
  "classMastery": false,
  "classCurriculum": false,
  "cantoPolicy": "noncombat",
  "countsTowardRosterLevel": false,
  "portraitId": "special_old_knight",
  "spriteId": "special_old_knight",
  "voiceId": "old_knight",
  "temperament": "grim",
  "traits": ["old_guard"]
}
```

Use class normalization/promotion helpers, but do not roll random growths, traits, names or
join perks merely to overwrite them: that consumes RNG and obscures deterministic creation.
Set both `stats.HP` and `currentHP` correctly after authored stat application.
The non-lord remains able to acquire standard in-run equipment and skills.

## Validation before gameplay delivery

Focused behavioral checks:

- New runs on every rung and first-run fast path receive exactly one Gaspar; tutorial and
  existing/suspended saves retain their original roster.
- Blessing rebuild, save round trip, revival and cloud resume preserve identity and policies.
- Exact fixed stats; all difficulty keys populated; half meta growths rounded once;
  flat/perk exclusion; ordinary boon and pact effects; in-run investment works.
- Reclass preview, target list and direct mutation path all refuse him without spending a seal.
- Sword/lance default loadout and correct HP; curriculum/mastery restrictions; scrolls still work.
- Every combat-completion path blocks his Canto; noncombat paths respect remaining movement;
  other Paladins unaffected; cancel, dance, rewind/resume and queued level-up cases covered.
- Recruit/revival target averages exclude him, including empty/one-unit boundary cases.
- Rapier damage pin with and without effectiveness; instance/forge save policy verified.
- Normal kill credit/Band parity; no-meta badge settlement/history/cloud idempotence and provenance.
- Bespoke portrait/sprite/voice lookup, fallback and mobile presentation.

Full-run validation uses the real-engine harness with shared Canto, XP, healing and equipment rules.
Deploy selection must use battlefield value/role; neither raw level nor promoted effective XP
level alone reliably values a fading veteran.

Compare paired seed sets across all four difficulties and meta off/early/endgame:
baseline; Gaspar only; Rapier nerf only; Gaspar + Rapier nerf.
For no-meta arms where Rapier is unavailable, explain why the Rapier-only intervention is inert.
Include Vanguard four-starter parties and alternate commanders.

Policies: competent ordinary play, aggressive sword play, deliberate feeding across the party,
Sera-assisted baiting, and investment/trading including the nerfed Rapier and Mentor's Band.
Start with at least 200 paired runs per important arm; extend when confidence intervals or
failure patterns prevent a useful conclusion. Do not infer a precise 5-point win-rate effect
from an underpowered sample.

Report win/act-clear rates with paired uncertainty, losses, turns/par/clock, resource spending,
recruit/village rescue success, whole-roster XP/promotions, Gaspar deployment and contribution
by act, and survival conditional on exposure. Inspect early Black Sun maps separately.

Shipping judgments:

- Normal opening still requires positioning, weapon choice and objective decisions.
- No-meta play is more accessible without requiring every kill to go to the commander.
- The veteran's offensive advantage fades; better recruits become attractive deployments.
- Proper protection or benching is rewarded. **No minimum death-rate requirement.**
- Late relevance through deliberate investment/support is permitted.
- Do not require Gaspar to be weaker than all endgame meta or cap Edric at an arbitrary level delta.
- Do not add targeted commander/Band penalties or a Gaspar-specific enemy surcharge without
  evidence and a separate design discussion.

## Remaining discussion

1. **Stat candidate:** HP18 / DEF6 / SKL12 is recommended; HP20 / DEF5 is the conservative
   alternative. Confirm after reviewing the physical-vs-magic tradeoff.
2. **Harder-rung role:** current STR10/SPD10 makes Nightfall/Black Sun a chip/support unit.
   Defensive boosts preserve survivability, not Normal kill thresholds.
3. **Save balance policy:** new Rapiers use might6, saved instances preserve existing stats.
4. **Presentation:** approve character direction and draft lines before final art/text production.
5. **Curriculum/mastery opt-out:** retained from the previous proposal and surfaced clearly;
   revisiting it requires recalculating Wayfarer/Ride Down thresholds.

These discussion items do not reopen the confirmed default-inclusion, no-reclass, restricted-Canto,
ordinary in-run investment, kill-credit, Band, cavalry, Vanguard or no-meta badge decisions.
