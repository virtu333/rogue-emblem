# The draft — choice screens

Every "choose one" moment of a run was a list and a text pane. The owner's playtest (iPhone,
landscape, the boss recruit screen) asked for them to be compelling. They are now one kit: the
options stand side by side as cards in the house style of the growth rites
([growth/README.md](../growth/README.md)), and the choice itself is a small beat.
Spec: [`docs/specs/choice-screens.md`](../../specs/choice-screens.md).

Captures are `?mobilePreview=1` iPhone landscape at DPR 2 (`*-844x390`, `*-667x375`), a
touch device at 1000×460, and desktop 1280×800 at DPR 1, made with
`tools/art/captureChoices.mjs` against the dev server. "Before" is `main` at 403507a.

| | Before | After |
|---|---|---|
| Boss recruit | ![](before/boss-recruit-844x390.webp) | ![](after/boss-recruit-844x390.webp) |
| Lord arrival | ![](before/lord-arrival-844x390.webp) | ![](after/lord-arrival-844x390.webp) |
| Mercenary board | ![](before/mercenary-board-844x390.webp) | ![](after/mercenary-board-844x390.webp) |
| Battle rewards | ![](before/rewards-844x390.webp) | ![](after/rewards-844x390.webp) |
| Blessings | ![](before/blessing-844x390.webp) | ![](after/blessing-longest-844x390.webp) |
| Difficulty | ![](before/difficulty-844x390.webp) | ![](after/difficulty-844x390.webp) |

The playtest screenshot that started it: [before/playtest-iphone.webp](before/playtest-iphone.webp).

## Candidates (boss recruit, lord arrival, mercenaries)

![Second candidate chosen](after/boss-recruit-select2-844x390.webp)

- **The figure:** PC-98 portrait on its faction plate (96 px; 64 px on small phones; 192 px on
  desktop — integer scales, one `<picture>`), the class **crest** on its corner, and the unit's
  **map sprite idling** at its foot (the traced strip's four idle frames at the battlefield's
  260 ms cadence).
- **Who:** kicker (`Lord` · mount · temperament from the story pass's unit voices), the
  **NAME** in Cinzel fitted to the card, class, `Lv · HP` bar, weapon seals with rank letters,
  `MOV`.
- **The comparison:** seven stat bars scaled to the draft; the best of the draft in ember gold;
  a verdigris chevron on the unit's two fastest growths. Legend in the footer.
- **What it brings:** the class role, then each trait and skill with one line of what it does,
  in a scroll with soft fade edges (never a hard slice).
- **The cue:** a verdigris thread at the foot — "Your army lacks a healer / a flier / a mage /
  an archer / cavalry / armor / a dancer" — computed from the roster. It states a fact and never
  ranks the candidates.
- **Choosing:** the chosen card lifts on an ember rim with a gold thread along its top and a
  brighter portrait; the others step back but stay readable. Focus is an ivory ring inside the
  plate, distinct from the gold. **Recruit / Welcome** seals the card (a short flare) and hands
  the unit to the existing *joins your army* ceremony. Reduced motion: no lift, no idle, no
  flare — the choice resolves at once.

Longest names at 667×375: ![](after/boss-recruit-longest-667x375.webp)
One lord (random mode): ![](after/lord-arrival-single-844x390.webp)

**Mercenaries** carry a gold price seal (`604 G · 2396 G after`) and a *Hired* stamp. A card
opens the **contract**: the chosen card beside the cost, gold after, roster count, the cue, the
traits and skills in full and the class's own recruit line.

![Contract](after/mercenary-contract-844x390.webp)

## Rewards

![Elite rewards](after/rewards-legend-844x390.webp)

Each spoil is a card: **item art** (the existing icon set by name, then by kind; the slot is
`[data-item-art-hook="item-icon"]` with the item's id, name and category for the icons study to
fill), a **rarity frame** (corner brackets and top rule in the tier colour; Rare and Legend gild
the art; Legend carries a slow sheen), the tier · category label, what it does (fading scroll),
and **for whom** — `For Edric · Atk 11 → 14 · 2 can wield`, `No one can wield it · Needs Lance
rank`, `For Sera · 3 uses per map`, `2 weapons can take it`, `+25 XP to every unit`. Elite picks
stamp the claimed card *Claimed*. Mastery news, the fallen and a weapon's art ride in a notes
strip under the cards. The recipient step shows each unit's face:
[after/rewards-recipient-844x390.webp](after/rewards-recipient-844x390.webp).

Five spoils at 667×375 keep the tier word and drop the category from view (it stays in the
text): ![](after/rewards-legend-667x375.webp)

## Blessings — tarot

![Tarot](after/blessing-longest-844x390.webp)

A tier-coloured frame, the **Hollow Sun** with the tier numeral burning inside (a second ring
from tier III), the name in Cinzel, then **Boon** (gold rule; scrolls if long) over **Cost**
(crimson; always in view — "None: a clean gift" for free blessings). "No blessing" is a
face-down card beside Confirm; the chosen blessing's lore reads in the footer.
667×375: ![](after/blessing-longest-667x375.webp)

## Difficulty — banners

![Banners](after/difficulty-844x390.webp)

Hanging banners with a swallow tail: taut threads per rank, the mode's colour along the top,
the name in Cinzel, a tagline, what pays back (`+50% meta currency`) and, when locked, a lock
and why. The chosen mode's full terms read beneath.

## Desktop and large phones

| | |
|---|---|
| ![](after/boss-recruit-1280x800.webp) | ![](after/rewards-legend-1280x800.webp) |
| ![](after/blessing-longest-1280x800.webp) | ![](after/mercenary-contract-1280x800.webp) |
| ![](after/difficulty-1280x800.webp) | ![](after/boss-recruit-1000x460.webp) |

Desktop cards stand tall: the 192 px portrait with the sprite beside it, 128 px item art, a
96 px Hollow Sun.

## Implementation map

| Piece | File |
|---|---|
| Content (pure: comparisons, cue, for whom, tarot, banners) | `src/ui/choiceContent.js` |
| Card kit (portrait, sprite strip, item art slot, fit, seal beat) | `src/ui/choiceCards.js` |
| Styles | `src/ui/choice.css` |
| Boss recruit, lord arrival | `src/ui/PartyMenus.js` (`showArrivalMenu`) |
| Mercenary board, contract | `src/ui/ArenaMenu.js` |
| Battle rewards | `src/ui/MobileRewards.js` |
| Blessings, difficulty | `src/ui/RunSetupMenu.js` |
| Captures | `tools/art/captureChoices.mjs` |

Tests: `tests/ChoiceContent.test.js` (content, purity: no `Math.random`, no mutation) and
`tests/e2e/choice-screens.spec.js` (every screen in its real flow: cards in view without
horizontal scroll at 844×390, 667×375, 1000×460 and 1280×800, selection, keyboard, the join
hand-off, one hire, an elite second pick, the blessing cost always visible, locked banners,
reduced motion).
