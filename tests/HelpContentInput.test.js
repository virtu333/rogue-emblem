import { describe, it, expect } from 'vitest';
import { HELP_TABS } from '../src/data/helpContent.js';

const inputTab = HELP_TABS.find((tab) => tab?.label === 'Input');

describe('Input (controls) help content', () => {
  it('has an Input tab with a gamepad page and a keyboard/mouse page', () => {
    expect(inputTab).toBeTruthy();
    const titles = (inputTab.pages || []).map((page) => page?.title);
    expect(titles).toEqual(['Gamepad Controls', 'Keyboard & Mouse']);
  });

  it('documents every gamepad verb wired in InputActions', () => {
    const gamepadLines = inputTab.pages[0].lines.map((line) => line?.text || '').join('\n');
    // One entry per binding in src/utils/InputActions.js
    for (const binding of ['D-Pad/Stick', 'A ', 'B ', 'X ', 'Y ', 'LB / RB', 'LT', 'Start']) {
      expect(gamepadLines).toContain(binding);
    }
    // Verb mapping over letters: warn about the Nintendo A/B swap
    expect(gamepadLines).toContain('Nintendo');
  });

  it('documents every battle keyboard shortcut bound in BattleScene', () => {
    const kbLines = inputTab.pages[1].lines.map((line) => line?.text || '').join('\n');
    // One entry per keyboard.on('keydown-*') gameplay binding in BattleScene
    for (const key of ['ESC', 'E ', 'D ', 'O ', 'V ', 'W ', 'R ', 'Left/Right']) {
      expect(kbLines).toContain(key);
    }
    expect(kbLines).toContain('Right click');
  });

  it('is searchable via controls/gamepad tags and fits the page line budget', () => {
    expect(inputTab.tags).toEqual(expect.arrayContaining(['controls', 'gamepad', 'keyboard']));
    for (const page of inputTab.pages) {
      // Overlay budget: ~15 lines per page, ~42 chars per 9px monospace line
      expect(page.lines.length).toBeLessThanOrEqual(15);
      for (const line of page.lines) {
        expect((line?.text || '').length).toBeLessThanOrEqual(42);
      }
    }
  });
});
