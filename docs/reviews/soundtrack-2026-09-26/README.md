# Soundtrack review handoff

Start with [the complete review](soundtrack-review.md). It covers 49 compositions and 88 music exports, including all 43 compositions in the main-branch inventory at review time and the six field themes added by PR #134.

## What was reviewed

- Music: [PR #134](https://github.com/virtu333/rogue-emblem/pull/134), pinned to `00dde90133ed18cb2d56e0f6f8591f7ccff4befe`.
- Directional lore: [PR #119](https://github.com/virtu333/rogue-emblem/pull/119), pinned to `7d5c1af8f849139352a79715a5d1c30f84774e3b`.
- Written notes, harmony, form, instrumentation, adaptive arrangements, renderer, and runtime routing.
- Objective measurements of all 88 MP3s in the music snapshot.

This branch contains review documents and measurements only. Its base is main at handoff time; it does not bring in PR #134's game changes or audio. Use the pinned revision above when checking the findings, rather than assuming this branch's music matches the reviewed snapshot.

## Important evidence boundary

The review did **not** include firsthand listening. Composition observations come from the scores; loudness, spectrum, stereo, and endpoint observations come from decoded audio. Claims about possible masking, harshness, fatigue, realism, or codec artifacts are audition hypotheses. The world bible is directional and may be stale. Preserve the owner's preference for clean violin articulation without artificial slides and account for the percussion reductions already made in #134.

## Suggested review for the next agent

1. Validate or challenge the prioritized recommendations against the pinned scores and actual playback where audio perception is available.
2. Check the concrete timing/register findings: Iron Rain calm violin C7 at bar 34, Lieutenant solo at bars 41–42, and The Last Light's resolving bell at approximately 79.1 seconds.
3. Review the proposed simplification of calm and enrage arrangements, ensuring each cue keeps its distinctive rhythm and motif.
4. Distinguish useful artistic proposals from actual defects. Do not treat low loudness range, intentional dissonance, or nonidentical MP3 loop windows as proof of bad audio.
5. Return agreements, disagreements, and items requiring listening, with source/bar references and an ordered revision shortlist. Review first; this handoff does not ask for implementing every proposal.

## Included evidence

| File | Contents |
| --- | --- |
| [soundtrack-review.md](soundtrack-review.md) | Complete review, coverage, priorities, per-track feedback, and source links |
| [music-metrics.csv](music-metrics.csv) | 88 rows of file measurements for comparison |
| [music-metrics.json](music-metrics.json) | The same measurements in structured form |
| [spectral-metrics.json](spectral-metrics.json) | Selected cues' unweighted spectral-energy measurements |
| [loop-jump-metrics.json](loop-jump-metrics.json) | Decoded loop-boundary diagnostics; these do not independently establish audible clicks |

Integrated loudness, loudness range, true peak, and stereo statistics use the configured loop region. Sample peaks use the entire decoded file. The report describes the limits of those measurements. Files were captured from the reviewed revision, not recomputed from the branch's main baseline.
