import { describe, it, expect } from 'vitest';
import { HELP_TABS } from '../src/data/helpContent.js';

function getWeaponArtsHelpPage() {
  const armsTab = HELP_TABS.find((tab) => tab?.label === 'Arms');
  if (!armsTab) return null;
  return armsTab.pages?.find((page) => page?.title === 'Weapon Arts') || null;
}

describe('Weapon Arts help content', () => {
  it('includes discovery path from battle action menu', () => {
    const page = getWeaponArtsHelpPage();
    expect(page).toBeTruthy();
    const lines = (page?.lines || []).map((line) => line?.text || '');
    expect(lines).toContain('  Attack -> Weapon Arts -> choose an art.');
  });

  it('clarifies proficiency requirements and unlock-source semantics', () => {
    const page = getWeaponArtsHelpPage();
    const lines = (page?.lines || []).map((line) => line?.text || '');
    expect(lines).toContain('  Status text shows why an art is unavailable.');
    expect(lines).toContain('  Req Prof = base proficiency for that weapon.');
    expect(lines).toContain('  Req Mast = mastery proficiency for that weapon.');
    expect(lines).toContain('  Act unlocks apply during the current run.');
    expect(lines).toContain('  Meta unlocks are active from run start.');
  });
});
