// guide_first_church (docs/specs/prologue-chapter.md §7): a real run's first church says
// what a church is as its status line (never over the services), once per save slot,
// honouring Guidance; the prologue's chapel teaches it and marks it read, and its
// watchtower (a ruins sanctuary) says what the watchtower holds instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));

import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { ChurchMenu } from '../src/ui/ChurchMenu.js';
import { guidanceText } from '../src/engine/Guidance.js';
import { PROLOGUE_SERVICE_LINES } from '../src/data/prologueContent.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function church({ mode = 'standard', guidance = 'full', ruins = false, seen = new Set() } = {}) {
  const hints = { hasSeen: (id) => seen.has(id), markSeen: vi.fn((id) => seen.add(id)) };
  const settings = { getHints: () => true, getGuidance: () => guidance };
  const run = {
    mode,
    roster: [],
    fallenUnits: [],
    gold: 1000,
    currentAct: 'act1',
    getDifficultyModifier: (_k, d) => d,
    getChurchPromotionCount: () => 0,
    getRuinsChoice: () => null,
    ruinsChoices: {},
  };
  const scene = {
    gameData,
    runManager: run,
    events: { on: vi.fn(), once: vi.fn(), off: vi.fn() },
    registry: { get: (k) => ({ hints, settings, meta: { runsCompleted: 0 } })[k] },
    textures: { exists: () => false },
    _churchNode: { id: 'church-1' },
    _churchRuinsMode: ruins,
  };
  const menu = new ChurchMenu({ scene, leaveChurchNode: vi.fn() });
  return { menu, hints, seen };
}

beforeEach(() => {
  installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
  vi.clearAllMocks();
});

describe('guide_first_church', () => {
  it("a real run's first church: the note is the status line, once per slot", () => {
    const first = church();
    expect(first.menu.status).toBe(guidanceText('guide_first_church'));
    expect(first.hints.markSeen).toHaveBeenCalledWith('guide_first_church');
    first.menu.surface?.destroy?.();
    const again = church({ seen: first.seen });
    expect(again.menu.status).toBe('');
  });

  it('Guidance Off: no note; a ruins sanctuary never shows it', () => {
    expect(church({ guidance: 'off' }).menu.status).toBe('');
    const ruins = church({ ruins: true });
    expect(ruins.menu.status).toBe('');
    expect(ruins.hints.markSeen).not.toHaveBeenCalled();
  });

  it("the prologue's chapel teaches it (marked read); its watchtower says what it holds", () => {
    const chapel = church({ mode: 'prologue' });
    expect(chapel.menu.status).toBe(PROLOGUE_SERVICE_LINES.church);
    expect(chapel.seen.has('guide_first_church')).toBe(true);
    const tower = church({ mode: 'prologue', ruins: true });
    expect(tower.menu.status).toBe(PROLOGUE_SERVICE_LINES.ruins);
    expect(tower.seen.has('guide_first_church')).toBe(false);
  });
});
