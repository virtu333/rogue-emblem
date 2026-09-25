# Choice screens — the draft (2026-09-25)

Owner feedback (iPhone landscape playtest, boss recruit screen): *"I think we can also spice
up more of these menus and make them compelling and exciting for the player."* The boss
recruit screen was a plain list of three names and a text pane (description sliced at the top
of its scroll area, `HP 25 · STR 9 · …`, `Lance Prof`, trait lines).

## Brief (as given)

Turn every "choose one" moment of a run into a draft moment worth savoring, in the house style
of the growth rites (`docs/art-direction/growth/README.md`) and the Ink & Ember art bible.

- **Screens:** boss recruit, recruit/NPC join choices, colosseum mercenary board, lord arrival,
  blessing select, difficulty select, battle reward/loot choice (and act-end/boss reward picks),
  promotion path chooser (already styled — the reference).
- **Candidates** as tall cards side by side: large PC-98 portrait, class crest, the traced map
  sprite idling, level + HP, a compact stat chart comparing candidates with the best in each
  stat highlighted, growth hints, proficiency weapon glyphs, trait and skill chips with one-line
  effects; a quiet "your army lacks a flier / a healer" cue computed from the roster, never
  pushy; a selection that feels physical (card lifts, ember rim, portrait brightens, others
  dim); a confirm beat that hands off to the existing join ceremony.
- **Rewards:** cards with rarity frames, item art where it exists (slots ready for the
  items/icons study), a clear "for whom" and comparison vs equipped.
- **Blessings:** tier frames and cost seals (tarot-like); boon vs cost readable at a glance.
- **Everywhere:** 844×390 (three candidates without scrolling; soft fade edges, never
  hard-sliced text), 667×375, ~1000×460, 1280×800; touch + keyboard/gamepad (focus rings);
  reduced motion; canvas fallbacks keep working. Design tokens only, Cinzel only for
  ceremonial words, Press Start 2P for kickers, the body face for reading; escPriority and
  uiDepths; presentation only — the same engine commands as before, no RNG, no save changes.
- Consume trait text through the existing helpers (a traits audit runs concurrently),
  portraits through the resolver (portrait variety runs concurrently), leave a hook for Deeds
  epithets. After the story pass merged (#70): a unit's per-run temperament may show as flavor
  through `unitVoiceDisplay`.

## As built

One kit, `src/ui/choiceCards.js` + `src/ui/choice.css`, fed by pure content in
`src/ui/choiceContent.js` (no DOM, no RNG, never mutates; unit-tested).

| Screen | Before | After |
|---|---|---|
| Boss recruit / lord arrival (`PartyMenus.showArrivalMenu`) | list + text pane | three candidate cards; footer: legend, Full unit details, Recruit / Welcome |
| Mercenary board (`ArenaMenu.mercs`) | one text button per merc | candidate cards with a gold price seal ("604 G · 2396 G after"), Hired stamp |
| Hire (`ArenaMenu.hire`) | stat dump + cost line | the chosen card beside a contract: cost, gold after, roster, the cue, traits and skills in full, the class's recruit line |
| Battle rewards (`MobileRewards.render`) | list + text pane | reward cards: item art, rarity frame and label, what it does (fading scroll), for whom; notes strip for mastery / fallen / weapon art; Claimed stamp for elite picks |
| Blessings (`RunSetupMenu`, blessing) | list + text pane | tarot: tier numeral, Hollow Sun medallion (rings grow with tier), Cinzel name, Boon (scrolls) and Cost (always in view); "No blessing" is a face-down card beside Confirm; the chosen blessing's lore reads in the footer |
| Difficulty (`RunSetupMenu`, difficulty) | list + text pane | hanging banners: threads per rank, Cinzel name, a tagline, what pays back, the lock and why; the chosen mode's terms beneath (one `article`) |
| Recipient step (rewards) | text rows | rows gain the unit's face |

### Candidate card anatomy

Portrait (PC-98 96 px on phones, 64 px ≤ 700 px, 192 px on desktop — one `<picture>`, integer
scales, faction plate), class crest badge, the map sprite idling on the portrait (traced strips:
four frames at the battlefield's own 260 ms cadence; others: first frame), kicker
(`Lord` · move type · temperament), **NAME** in Cinzel (fitted to the card, down to 12 px), class,
`Lv · HP` with bar, weapon seals with rank letters (P / M), `MOV`; the stat chart (STR MAG SKL SPD
DEF RES LCK): bars against the draft's highest value, the draft's best in ember gold, a verdigris
chevron on the unit's two fastest growths (≥ 40%); then the class role, trait and skill lines
(name + one line of effect) in a scroll with soft fade edges; and at the foot the roster cue.

**Roster cue** (`candidateCue`): the highest-priority role nobody in the current roster covers
that this candidate would — healer (Staff), flier, mage (Tome/Light), archer (Bow), cavalry,
armor, dancer — as a quiet verdigris line "Your army lacks a flier". Never ranks candidates, never
says "pick".

**Selection:** the chosen card lifts 4 px on an ember rim (gold thread along its top, warm
plate, brighter portrait); the others step back (0.84 opacity, desaturated figure) but stay
readable. Focus is a separate ivory ring inside the plate. **Confirm beat:** the chosen card
flares (260 ms, other cards fade), then the same `resolve(unit)` as before runs — which the
battle flow follows with the existing "joins your army" ceremony (`_presentJoin`). Under
reduced motion the resolve is immediate. While sealing, Skip / Escape / Reroll are ignored so a
late tap cannot change the outcome.

**For whom** (`rewardForWhom`, reads only): weapons name the wielder who gains the most attack
(`For Edric · Atk 11 → 14 · 2 can wield`, ties go to the harder hitter) or say `No one can wield
it · Needs Lance rank`; staves the healer with most uses; forge stones count the weapons that
can take them; boosters name who grows that stat best; gold and skipping talk about the vault.

### Hooks for concurrent work

- **Traits audit:** trait text comes only from `TraitSystem.getUnitTraits` (name/description).
- **Portrait variety:** portraits come only from `portraitIdForUnit` / `ceremonyPortrait`.
- **Deeds:** `choiceEpithet(unit)` + `.ch-epithet[data-epithet-hook="deeds"]` (hidden when
  empty); swap in the epithet display helper after merge.
- **Items/icons study:** every reward card has `.ch-item-art[data-item-art-hook="item-icon"]`
  with `data-item-id`, `data-item-name`, `data-item-category`; until then the existing
  `assets/sprites/ui/icon_*.png` art (by name, then kind), else a category glyph.
- **Unit voices:** kicker temperament via `unitVoiceDisplay.unitTemperament` (deterministic).

## Deviations from the brief

- **Recruit/NPC join choices:** Talk recruits and recruit nodes have no choice to make (one NPC,
  one Talk); they already play the join ceremony, so nothing changed there.
- **Act-end/boss reward picks** are the battle reward screen (boss battles use the same pending
  reward record); the footer names "the boss's spoils".
- **"No blessing"** is a footer toggle styled as a face-down card instead of a fifth card, so
  four tarot cards fit 667 px without scrolling.
- **Trait/skill "chips"** became lines (name + effect) — at 844×390 a chip row plus a separate
  effect line cost more height than the combined line.
- **Canvas fallbacks** (`BossRecruitOverlay`, `LordArrivalOverlay`, `LootScreenController`,
  `BlessingSelectScene`, `DifficultySelectScene` canvas branches) are untouched and keep working;
  they only run without a DOM host (headless tests).
- **Mercenary board:** a card opens the contract screen (the existing Back-able confirmation of
  a gold spend) rather than hiring from the board.
