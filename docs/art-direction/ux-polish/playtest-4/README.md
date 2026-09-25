# Playtest 4 polish — captures

Spec: [`docs/specs/playtest-polish.md`](../../../specs/playtest-polish.md) (§ Playtest 4).
Headless Chromium at DPR 1, palette-reduced to stay small. "Before" is `origin/main` at
98e44ac; "after" is `claude/recruit-note-and-wait`.

| File | What it shows |
|---|---|
| `recruit-start-844-before.png` | 844×390, recruit battle (seed 42, `devNode=recruit`), fresh save slot, Guidance Full, 2.5 s into turn 1: the old intro note is a modal "Field notes" dialog over the map. It opened in every recruit battle, also with Guidance Off. |
| `recruit-start-844-after-full.png` | The same moment after the fix: no dialog. The non-blocking field note names the recruit ("Garrick (Cavalier) under the gold banner can join you. Move a Lord next to them and choose Talk before enemies reach them."); the gold RECRUIT banner and the rail are unchanged. |
| `recruit-start-844-after-off.png` | Guidance Off: nothing opens; only the banner marks the recruit. |
| `rail-six-commands-844-before.png`, `rail-six-commands-667-before.png` | Support's action menu with Guidance Full: greyed Attack ("No target in range 1"), Shove, Pull, Trade, Swap, Wait. Wait is below the fold ("more ▾"). |
| `rail-six-commands-844-after.png`, `rail-six-commands-667-after.png` | Wait is pinned in the fixed dock beside a compact Danger, always in view; the list keeps its order (primary first) and still scrolls the rest under "more ▾". |
