# Mobile rebuild checkpoint — 2026-09-16

## Local commit boundaries
1. Capacitor native project and build dependencies.
2. Explicit local-only startup, bundled pixel font and offline checks.
3. Touch battle/roster/pause UI plus rebuilt terrain and character integration. Shared scene hooks keep these in one dependency-complete commit.
4. Review tools, art direction, mobile backlog and planning notes.

The rebuilt art remains development-lab gated. This checkpoint is not a TestFlight release. Native generated public files, build output, secrets and per-user Xcode state are ignored. Source/public art mirrors follow the repository's existing asset workflow. Only integrated art is included; the external concept galleries and unused generated candidates remain in the local design workspace.

## Validation before checkpoint
- 17 offline/font/Supabase unit tests passed.
- 16 roster-inventory/terrain unit tests passed.
- 41 targeted browser tests passed: local play, battle lab, character identity, HUD, pause, roster and rebuilt sprites.
- Production build passed.
- Source/public copies of all 71 integrated art files matched.
- Map generator review: 60 valid configurations and 30 deterministic repeats.
- Commit hooks run Prettier and ESLint on staged supported files.

## Next work
Retain 16×10 and 18×13 battle sizes. Improve deployment-aware camera framing, readable tactical zoom and selected-unit recentering, preserving pan/pinch and Overview. Extend map review to all act sizes, higher difficulties, full playable parties and additional objectives before claiming campaign-wide coverage. Upgrade-menu reference is recorded separately for the following UI pass.
