import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { DialogueOverlay } from '../src/ui/DialogueOverlay.js';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { seenDialogueKey, mergeSeenDialogueKeys } from '../src/utils/seenDialogue.js';
const entries = [{ speaker: 'Sera', line: 'The road bends north.' }];
const options = { category: 'actTransition', key: 'act1_to_act2' };
let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  });
});
function fixture(enabled = false) {
  const meta = new MetaProgressionManager([], 'test_meta');
  const settings = new SettingsManager();
  settings.setSkipSeenDialogue(enabled);
  const scene = {
    registry: { get: (key) => ({ meta, settings })[key] },
    events: { once: vi.fn() },
  };
  return { meta, settings, overlay: new DialogueOverlay(scene) };
}
describe('opt-in seen story skipping', () => {
  it('defaults off, ignores truthy malformed settings, and persists explicit opt-in', () => {
    expect(normalizeSettings().skipSeenDialogue).toBe(false);
    expect(normalizeSettings({ skipSeenDialogue: 'true' }).skipSeenDialogue).toBe(false);
    const { settings } = fixture(true);
    expect(new SettingsManager().getSkipSeenDialogue()).toBe(true);
    settings.setSkipSeenDialogue(false);
    expect(new SettingsManager().getSkipSeenDialogue()).toBe(false);
  });
  it('records completion in slot meta and skips only the same acknowledged content when enabled', async () => {
    const { meta, settings, overlay } = fixture();
    overlay._showEntry = vi.fn(async () => true);
    await overlay.showSequence(entries, options);
    const key = seenDialogueKey(options.category, options.key, entries);
    expect(new MetaProgressionManager([], 'test_meta').hasSeenDialogue(key)).toBe(true);
    await overlay.showSequence(entries, options);
    expect(overlay._showEntry).toHaveBeenCalledTimes(2);
    settings.setSkipSeenDialogue(true);
    await overlay.showSequence(entries, options);
    expect(overlay._showEntry).toHaveBeenCalledTimes(2);
    await overlay.showSequence([{ ...entries[0], line: 'The road bends south.' }], options);
    expect(overlay._showEntry).toHaveBeenCalledTimes(3);
    expect(meta.seenDialogueKeys).toHaveLength(2);
  });
  it('never suppresses boss, recruit, tutorial, or node toast categories', async () => {
    const { overlay, meta } = fixture(true);
    overlay._showEntry = vi.fn(async () => true);
    for (const category of ['boss', 'recruit', 'tutorial', 'nodeFlavor']) {
      await overlay.showSequence(entries, { ...options, category });
      await overlay.showSequence(entries, { ...options, category });
    }
    expect(overlay._showEntry).toHaveBeenCalledTimes(8);
    expect(meta.seenDialogueKeys).toEqual([]);
  });
  it('does not burn a story on external hide or shutdown', async () => {
    for (const cancel of ['hide', 'destroy']) {
      const { overlay, meta } = fixture();
      overlay._showEntry = vi.fn(
        () =>
          new Promise((resolve) => {
            overlay._pendingResolve = resolve;
          }),
      );
      const showing = overlay.showSequence(entries, options);
      overlay[cancel]();
      expect(await showing).toBe(false);
      expect(meta.seenDialogueKeys).toEqual([]);
    }
  });
  it('manual Skip is an acknowledgement, without displaying remaining entries', async () => {
    const { overlay, meta } = fixture();
    overlay._showEntry = vi.fn(async (_name, _line, _portrait, _auto, entryOptions) => {
      entryOptions.onSkip();
      return true;
    });
    await overlay.showSequence([...entries, ...entries], options);
    expect(overlay._showEntry).toHaveBeenCalledTimes(1);
    expect(meta.seenDialogueKeys).toHaveLength(1);
  });
  it('normalizes and bounds persisted history while keeping additions', () => {
    expect(mergeSeenDialogueKeys(['a', null, 'a'], ['b'])).toEqual(['a', 'b']);
    const history = mergeSeenDialogueKeys(Array.from({ length: 205 }, (_, i) => `story-${i}`));
    expect(history).toHaveLength(200);
    expect(history.at(-1)).toBe('story-204');
  });
});
