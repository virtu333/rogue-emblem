// Shared rendering substitutions for CLI and scripted journey suites.
import { vi } from 'vitest';
vi.mock('phaser', () => ({
  default: { Scene: class {}, Math: { Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } },
}));
vi.mock('../../src/ui/MenuSurface.js', async () => {
  const { MenuSurface, element, button } = await import('./JourneyPresentation.js');
  return { MenuSurface, element, button };
});
vi.mock('../../src/ui/ChoicePicker.js', async () => ({
  ChoicePicker: (await import('./JourneyPresentation.js')).ChoicePicker,
}));
vi.mock('../../src/ui/PauseOverlay.js', async () => ({
  PauseOverlay: (await import('./JourneyPresentation.js')).PauseOverlay,
}));
vi.mock('../../src/ui/HintDisplay.js', () => ({
  showMinorHint: vi.fn(),
  showImportantHint: vi.fn(),
}));
vi.mock('../../src/ui/serviceSave.js', async (original) => {
  const actual = await original();
  return { ...actual, saveServiceRun: vi.fn(actual.saveServiceRun) };
});
vi.mock('../../src/utils/domUI.js', async (original) => ({
  ...(await original()),
  hasDOMHost: () => true,
}));
vi.mock('../../src/utils/SceneRouter.js', async (original) => {
  const actual = await original();
  return {
    ...actual,
    transitionToSceneWithBlockedRetry: vi.fn(async () => ({
      status: actual.TRANSITION_RESULTS.STARTED,
    })),
  };
});
vi.mock('../../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    constructor(scene) {
      this.scene = scene;
    }
    show() {
      return this.scene._journeyPopup?.() ?? Promise.resolve();
    }
  },
}));
