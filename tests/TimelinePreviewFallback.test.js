// Playtest 2026-09-25 (Alex, desktop Mac): "rewind interface reverted to this lo
// fi version" — the Battle timeline showed the text sketch (terrain initials
// and numbered markers) instead of the rendered battlefield. The rendered view
// needs the optional frame archive; three things dropped it wholesale:
//  1. keyframes were scheduled by record id, so records appended after a
//     rewind branch extended a delta chain past what hydration accepts — the
//     next reload discarded the whole archive;
//  2. one frame that failed validation (a traced sprite key such as
//     `traced-enemy_fighter~corrupt`) nulled the entire archive;
//  3. the view only rendered rows that still had an archived frame.
// Rows now render from their archived frame, else a board rebuilt from their
// rewind state or compact preview; only rows with no board data show the
// sketch, labelled "Preview unavailable — map sketch".
import { describe, expect, it } from 'vitest';
import {
  appendHistoryPresentation,
  branchHistoryPresentation,
  frameFromCompactPreview,
  historyFrameAt,
  hydrateHistoryPresentation,
  MAX_DELTA_CHAIN,
  validHistoryFrame,
} from '../src/engine/BattleHistoryPresentation.js';
import { packPreviewTiles } from '../src/engine/BattleTimelineFacts.js';

function frame(n, spriteKey = 'fighter') {
  return {
    version: 2,
    cols: 3,
    rows: 1,
    biome: '',
    tiles: [0, 1, 2].map((col) => ({
      col,
      row: 0,
      label: 'Plain',
      known: true,
      fog: 'visible',
      details: [],
    })),
    units: [
      {
        id: 'u1',
        name: 'Edric',
        className: 'Lord',
        spriteKey,
        faction: 'player',
        col: n % 3,
        row: 0,
        hp: 10 + (n % 50),
        maxHP: 99,
        conditions: [],
        size: 1,
      },
    ],
    summary: [],
    enemiesActNext: false,
  };
}
const info = (n) => ({
  entryId: n,
  anchorId: n,
  revision: 0,
  generation: 0,
  kind: 'recovery',
  turnNumber: 1,
  phase: 'player',
  parentId: null,
  actorId: null,
  parents: {},
  beats: [],
  facts: [],
  gap: false,
  endpointOnly: true,
  enemiesActNext: false,
});
const maxChain = (archive) => {
  let chain = 0;
  let worst = 0;
  for (const record of archive.records) {
    chain = record.frame ? 0 : chain + 1;
    worst = Math.max(worst, chain);
  }
  return worst;
};

describe('history frame archive', () => {
  it('records appended after a rewind branch keep every chain hydratable', () => {
    let archive = null;
    for (let n = 1; n <= 40; n++) archive = appendHistoryPresentation(archive, frame(n), info(n));
    archive = branchHistoryPresentation(archive, 31); // rewind to the 31st record
    for (let n = 41; n <= 90; n++) archive = appendHistoryPresentation(archive, frame(n), info(n));
    expect(maxChain(archive)).toBeLessThanOrEqual(MAX_DELTA_CHAIN);
    expect(hydrateHistoryPresentation(archive, [])).not.toBeNull();
    for (let i = 0; i < archive.records.length; i++)
      expect(historyFrameAt(archive, i)).not.toBeNull();
  });

  it('accepts traced sprite variants (`~corrupt`) instead of rejecting the frame', () => {
    expect(validHistoryFrame(frame(1, 'traced-enemy_fighter~corrupt'))).toBe(true);
    expect(validHistoryFrame(frame(1, 'rebuilt-lord_edric_promoted'))).toBe(true);
    expect(validHistoryFrame(frame(1, 'bad key'))).toBe(false);
  });
});

describe('frameFromCompactPreview', () => {
  const compact = {
    cols: 3,
    rows: 2,
    tiles: [
      { col: 0, row: 0, label: 'Plain' },
      { col: 1, row: 0, label: 'Forest' },
      { col: 2, row: 0, label: 'Unknown' },
      { col: 0, row: 1, label: 'Wall' },
      { col: 1, row: 1, label: 'Plain' },
      { col: 2, row: 1, label: 'Plain' },
    ],
    units: [
      {
        id: 'u1',
        name: 'Edric',
        faction: 'player',
        col: 0,
        row: 0,
        hp: 18,
        maxHP: 20,
        level: 3,
        acted: true,
        weapon: 'Iron Sword',
        items: ['Iron Sword', 'Vulnerary (3)'],
        conditions: [],
      },
      { id: 'u5', name: 'Cavalier', faction: 'enemy', col: 1, row: 1, hp: 9, maxHP: 20 },
    ],
    summary: ['Turn 3 · Enemy phase', '40 battle gold'],
    enemiesActNext: false,
  };

  it('rebuilds a renderable board from a stored (packed) preview', () => {
    const packed = packPreviewTiles(compact);
    expect(packed.tiles).toBeUndefined();
    const looks = { u1: { className: 'Lord', spriteKey: 'rebuilt-lord_edric', size: 1 } };
    const built = frameFromCompactPreview(packed, { biome: 'plains', unitLook: (id) => looks[id] });
    expect(validHistoryFrame(built)).toBe(true);
    expect(built.tiles.map((t) => t.label)).toEqual([
      'Plain',
      'Forest',
      'Unknown',
      'Wall',
      'Plain',
      'Plain',
    ]);
    expect(built.tiles[2]).toMatchObject({ known: false, fog: 'unseen' });
    expect(built.tiles[1]).toMatchObject({ known: true, fog: 'visible' });
    expect(built.units[0]).toMatchObject({
      id: 'u1',
      className: 'Lord',
      spriteKey: 'rebuilt-lord_edric',
      hp: 18,
      acted: true,
    });
    // Unknown units draw as their faction marker (no sprite, no class).
    expect(built.units[1]).toMatchObject({ id: 'u5', className: '', spriteKey: '', size: 1 });
    expect(built.summary).toEqual(compact.summary);
  });

  it('never invents a board from missing or malformed data', () => {
    expect(frameFromCompactPreview(null)).toBeNull();
    expect(frameFromCompactPreview({ cols: 0, rows: 2, tiles: [] })).toBeNull();
    expect(frameFromCompactPreview({ cols: 2, rows: 2, units: [] })).toBeNull(); // no terrain
    const hostile = frameFromCompactPreview(
      { ...compact, units: [{ id: 'x', name: 'Bad', faction: 'enemy', col: 9, row: 9 }] },
      { unitLook: () => ({ spriteKey: 'bad key' }) },
    );
    expect(hostile.units).toEqual([]);
  });

  it('drops a sprite key the renderer would reject rather than the whole board', () => {
    const built = frameFromCompactPreview(compact, {
      unitLook: () => ({ spriteKey: 'has spaces', className: 'Lord' }),
    });
    expect(validHistoryFrame(built)).toBe(true);
    expect(built.units.every((u) => u.spriteKey === '')).toBe(true);
  });
});
