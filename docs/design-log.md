# Design Log

Running log of design discussions, decisions, and deferred ideas. Newest entries first.
Each entry links to specs in `docs/specs/` when an idea graduates to implementation.

---

## 2026-07-04 — Early-game difficulty vs. Edric juggernaut

### Problem statement

Two symptoms, one cause:

1. The early game is hard with only Edric + Sera.
2. Funneling everything into Edric (the juggernaut line) is often the dominant strategy — and because the early game is hard with two units, it's also the *taught* strategy.

Heavy-handed anti-juggernaut effects (ambush spawns, % damage, RNG status on your best unit,
"targets your strongest unit" mechanics) are feelbads and are off the table.

### Design principles adopted

- **Pay secondary objectives in a different currency than kills.** Gold, items, recruits,
  and meta-currency reward a second flank without competing with the juggernaut's XP.
  If side objectives paid combat XP, the juggernaut would just collect them too.
- **Punish the clock, not the unit.** The turn-par system (XP/gold decay, boss enrage)
  is the sanctioned juggernaut tax. Effects that make solo play *slower* rather than
  *deadlier* funnel into a pressure system players already understand.
- **Distance-gate + turn-gate split objectives** so one unit mathematically cannot do
  everything; the opportunity cost is visible on the map, never a targeted nerf.
- **No effect that scales off the unit being strong** (e.g. % max-stat damage,
  "targets highest level"). Reads as the game cheating.
- **Make recruits attractive through utility the lord doesn't have** (fliers, thieves,
  tools) and through positive XP incentives — not by nerfing the lord.

### Decisions (graduating to specs / PRs)

| # | Idea | Notes | Spec |
|---|------|-------|------|
| 1 | **Village & bandit secondary objectives** | Classic FE: village/cache tile on the far side of the map; scripted bandit squad beelines for it; player reaching it first earns gold/item, bandits raze it. Optional, no punishment for ignoring. Builds on the Merchant Caravan micro-objective framework (PR #54). ~1 secondary objective per map max — avoid checklist fatigue. | `specs/village-bandit-objectives.md` |
| 2 | **Recruit-focused meta upgrades + lord upgrade cost rebalance** | New expensive recruit upgrades (flagship: recruits join with a forged weapon). Lord base-stat and growth upgrades become more expensive than the recruit equivalents, tilting long-term meta investment toward roster width. | `specs/recruit-meta-upgrades.md` |
| 3 | **Weapon imbues** | Rare weapon blessings that attach a special effect to a specific weapon (lifesteal, anti-armor, on-hit status chance, etc.). Delivered like whetstones / via forge-adjacent flow. Persist through save/load. | `specs/weapon-imbues.md` |
| 4 | **Legendary accessories (incl. EXP Share, Mercury Sandals)** | EXP Share: the *strong* unit equips it and gives up their accessory slot; adjacent lower-level allies siphon XP from the holder's combats. Turns juggernaut turns into roster development with a real cost. Mercury Sandals: infantry holder gains flying-type movement. Plus 2-4 more build-around legendaries. | `specs/legendary-accessories.md` |
| 5 | **Utility abilities (single-use action skills)** | New battle actions alongside Fight/Item/Weapon Art/Wait: Teleport N tiles, Rally (temp party buff), AOE heal, AOE root. Weapon-art-like but utility-driven; charge-limited per battle or per run. Granted via rare loot (scroll-like items) and/or legendary accessories. | `specs/utility-abilities.md` |

### Liked, deferred (revisit later)

- **Full support/bond system** (adjacency-accrued ranks granting hit/avoid auras).
  Very FE-coded and the strongest long-term "roster > one unit" lever, but a large
  system (pair tracking, rank UI, balance). The EXP Share accessory (#4) is the
  cheap probe of the same design space — ship it first, see how adjacency play feels.
- **Mentor/assist XP** (adjacent lower-level ally gains trickle XP on lord kills)
  as a baseline mechanic. Overlaps with EXP Share; if EXP Share proves the loop,
  consider promoting a small baseline version later.
- **Wary AI** — enemies that can't hurt the juggernaut stop suiciding into him and
  instead hold chokes / guard objectives / drift toward squishies. Deep fix (the AI
  currently *feeds* the juggernaut) and reads as "smart enemies," not a nerf; slower
  solo clears get taxed by the existing par system. Needs careful AIController work +
  sim validation — schedule as its own investigation.
- **Rescue-recruits** (green unit escort → joins roster). Merchant Caravan (#54)
  already probes escort mechanics; extend to recruit rewards once villages land.
- **Hold-point bonus objectives** (hold a shrine N turns → blessing shard/discount).
- **Twin-pincer rout template** (two converging enemy clusters — geometry-driven
  anti-turtle pressure).
- **Underdog XP surfacing** — the +6-level underdog XP bonus already exists in
  `calculateCombatXP` but is invisible; add a "Underdog!" toast so it works as an
  incentive. Cheap; bundle into any XP-adjacent PR.
- **Raise Corrosive/Thorns/Rally affix weights**, and consider low-chance tier-1
  affixes on Normal in act 3+ (currently Normal = 0% — Normal players juggernaut
  hardest). Pure data tweak; wants sim validation.
- **Weapon-economy pressure on soloists** (occasional `sunderWeapon` enemies outside
  scripted boss waves). Taxes juggernauts through gold, not death.

### Explicitly rejected

- End-of-battle ratings scoring "distinct units used" — checklist feelbad.
- Untelegraphed ambush spawns, flat % damage, RNG sleep-lock on the player's carry,
  and anything that targets "your strongest unit" by rule.

### Existing systems these build on

- Turn par / late pressure: `data/turnBonus.json`, `TurnBonusCalculator.js` (XP/gold
  decay 2+ turns over par, boss enrage) — the sanctioned slow-play tax.
- XP diminishing returns: `UnitManager.calculateCombatXP` (steep decay at +4..+6
  level advantage, flat minimum at +7; underdog bonus capped at +6).
- Affix engine (`data/affixes.json`) — telegraphed anti-solo-tank effects already
  exist (Corrosive, Thorns, Rally).
- Micro-objective framework from Merchant Caravan (PR #54).
- Class Mastery + Trait system (PR #53) — new accessories/skills must compose with it.
