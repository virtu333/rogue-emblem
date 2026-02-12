# Manual QA Scene Sequence

Use these URLs in local dev (`npm run dev`) to jump directly to high-value QA checkpoints without replaying full runs.

## Notes
- These routes are dev-only (`import.meta.env.DEV`).
- Add `&devTools=1` to enable the backtick debug panel in NodeMap/Battle.
- Optional deterministic seed: `&seed=12345`.

## Sequence URLs
1. Step 1 (Home Base): `http://localhost:3000/?qaStep=1&devTools=1`
2. Step 2 (Difficulty Select): `http://localhost:3000/?qaStep=2&devTools=1`
3. Step 3 (Blessing Select): `http://localhost:3000/?qaStep=3&devTools=1`
4. Step 4 (Node Map weapon-art preset): `http://localhost:3000/?qaStep=4&devTools=1`
5. Step 5 (Battle smoke flow): `http://localhost:3000/?qaStep=5&devTools=1`
6. Step 6 (Late-act Node Map): `http://localhost:3000/?qaStep=6&devTools=1`
7. Step 7 (Late-act Battle): `http://localhost:3000/?qaStep=7&devTools=1`

## What To Check Per Step
1. Home Base: upgrade descriptions, prerequisite labels, purchase visibility.
2. Difficulty: lock states, copy legibility, keyboard/mouse navigation.
3. Blessing: selection + skip path, transition reliability.
4. Node Map: shop reroll, convoy overflow, roster overlay scroll application.
5. Battle smoke: weapon-art availability reasons, forecast, loot/exit routing.
6. Late Node Map: economy scaling, unlock banners, church/shop transitions.
7. Late Battle: enemy pacing, defeat/overlay lock-state handling, post-battle return.
