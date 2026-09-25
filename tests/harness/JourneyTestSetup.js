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
vi.mock('../../src/ui/PromotionPathChooser.js', async () => ({
  PromotionPathChooser: (await import('./JourneyPresentation.js')).PromotionPathChooser,
}));
vi.mock('../../src/ui/PauseOverlay.js', async () => ({
  PauseOverlay: (await import('./JourneyPresentation.js')).PauseOverlay,
}));
// Item art is presentation only: icons, heroes and vignettes render as inert nodes.
vi.mock('../../src/ui/itemIcons.js', async (original) => {
  const actual = await original();
  const { element } = await import('./JourneyPresentation.js');
  const node = (cls) => (subject) => {
    const n = element('span', '', cls);
    n.dataset.iconId = actual.itemIconId(subject);
    return n;
  };
  return { ...actual, itemIcon: node('ia-icon'), itemHero: node('ia-hero') };
});
vi.mock('../../src/ui/itemMoments.js', async (original) => {
  const actual = await original();
  const { element } = await import('./JourneyPresentation.js');
  return {
    ...actual,
    applyServiceVignette: (root, service) => {
      root.dataset.vignette = service;
      return element('div', '', 'ia-band');
    },
    vignetteMotes: () => null,
    motes: () => element('span', '', 'ia-motes'),
    prefersStill: () => true,
  };
});
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
