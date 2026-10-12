// The run-format guard on a client that plays every capability (a later build: 04 §12.1 step 4,
// test 26). RunFormat's client list is widened by a mock so the save loads; what is checked is
// the ratchet across a load: the ids a save carries are the floor its next save writes.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/RunFormat.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CLIENT_CAPABILITIES: actual.CAPABILITY_IDS,
    runFormatBlock: (saved, client = {}) =>
      actual.runFormatBlock(saved, { clientCapabilities: actual.CAPABILITY_IDS, ...client }),
  };
});

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { requiredRunFormat } from '../src/engine/RunFormat.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';

const gameData = loadGameData();

function newRun(seed = 26) {
  const previous = Math.random;
  Math.random = createSeededRng(seed);
  try {
    const run = new RunManager(gameData);
    run.startRun({ runSeed: seed, difficultyId: 'normal' });
    return run;
  } finally {
    Math.random = previous;
  }
}

describe('test 26: the ratchet across a load', () => {
  it('a loaded run writes the ids it was saved with, though it holds none now', () => {
    const run = newRun();
    run.difficultyModifiers = { ...run.difficultyModifiers, bossKits: { enabled: true } };
    const first = run.toJSON();
    expect(first.requiresCapabilities).toEqual(['bossKit']);
    // The act advances: the snapshot that held kits is gone from the payload.
    first.difficultyModifiers.bossKits = { enabled: false };
    expect(requiredRunFormat(first).capabilities).toEqual([]);
    const loaded = RunManager.fromJSON(structuredClone(first), gameData);
    expect(loaded.requiredCapabilityFloor).toEqual(['bossKit']);
    const second = loaded.toJSON();
    expect(second.requiresClient).toBe(2);
    expect(second.requiresCapabilities).toEqual(['bossKit']);
  });

  it('a stored id from a build this client never heard of is refused even here', async () => {
    const { runFormatBlock } = await import('../src/engine/RunFormat.js');
    const saved = { ...newRun().toJSON(), requiresCapabilities: ['tides'] };
    expect(runFormatBlock(saved)).toMatchObject({ missing: ['tides'] });
    expect(() => RunManager.fromJSON(saved, gameData)).toThrow(/tides/);
  });
});
