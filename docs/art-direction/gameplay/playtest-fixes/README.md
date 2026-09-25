# Playtest fixes — 2026-09-25

Screenshots for `docs/specs/playtest-fixes-2026-09-25.md`. Captured by the e2e specs
with `PLAYTEST_FIX_SHOTS=docs/art-direction/gameplay/playtest-fixes` (PNG, quantized
to 256 colors).

| File | Spec | What it shows |
| --- | --- | --- |
| `forecast-triangle-desktop-1280x800.png` | `tests/e2e/forecast-triangle.spec.js` | The playtest matchup (Daska, Iron Sword, vs Cavalier, Iron Lance, 9/20 HP) at triangle disadvantage: 3 per hit, "If all hits land: 6 HP". The projected loss is now a dark, hatched segment on both HP bars, visible on the amber 40–70% band where it used to vanish. |
| `forecast-triangle-desktop-640x480.png` | same | The same panel at the 640×480 design size. |
| `forecast-triangle-phone-844x390.png` | same | The phone forecast (DOM), for comparison: the canvas bar now matches its hatched `.re-health-projection`. |
| `timeline-desktop-1280x800.png`, `timeline-desktop-1440x900-2x.png` | `tests/e2e/timeline-preview.spec.js` | The Battle timeline after several turns (enemy phase included) and a reload, with a traced corrupt enemy whose sprite key the frame validator used to reject: the rendered battlefield, not the text sketch. |
| `timeline-rebuilt-desktop-1280x800.png`, `timeline-rebuilt-desktop-1440x900-2x.png` | same | The same after the optional frame archive was shed: the board is rebuilt from the row's rewind state. The text sketch ("Preview unavailable — map sketch") appears only for rows with no board data at all. |
| `church-revive-recruit-1280x800.png` | `tests/e2e/fallen-recruit.spec.js` | Daska, recruited by Talk and fallen in the same battle, offered for revival at the next church. The disabled Kindle button reads "Kindle · 700 G" (no "−0 shadow") when the sun is clear. |
