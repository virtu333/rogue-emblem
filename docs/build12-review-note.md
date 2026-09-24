# Build 12 reviewer handoff

This release combines the story/gameplay and presentation slices following build 11 with the September 21 review fixes and U7 threat planning. Local-only saves remain the default.

## Review focus

- Mobile selection: select → move → Back → tap own tile → switch ally. Inspection and pinned enemy ranges must preserve planning without allowing a second committed move.
- Danger now darkens for 1 / 2 / 3+ damage sources. Purple outlines remain status-staff threats. Pin Range is red, capped at five with oldest replaced, and clears on death, fog loss or reload. Pins do not affect combat RNG, AI or saves.
- Enemy-phase level-ups appear at their combat; refresh must preserve resolved combat and subsequent random outcomes. Speed/quality/motion combinations must produce identical gameplay results. Hold-to-fast-forward persists between exchanges.
- Menu teaching hints defer until safe idle and require a real reading opportunity. Instant level-ups start revealed and close in one press.
- Balance/story scope includes 2RN hit rolls (including ballista), healer/anchor and enemy planning fixes, curated boss loot, Field Medic recruits, merchant art, victory records and story/economy/class content. See the implementation and gameplay-slice notes for the full change list.

## Verification

The combined suite passes 5,686 tests across 342 files. U7 received an independent adversarial review with lifecycle, fog, cap, movement, RNG and real checkpoint tests. Data/schema/reference/theme checks pass. Lint has zero errors (309 existing warnings). Production local-only build and iOS archive succeed.

47 distinct headed browser cases passed, including production offline smoke. Distribution status is recorded in `testflight-beta.md`. Physical-phone audio interruption, safe areas, thumb gestures and upgrading existing saves remain tester checks; browser emulation does not prove those behaviors.
