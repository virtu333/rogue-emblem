import { describe, it, expect, vi } from 'vitest';

import { HelpOverlay } from '../src/ui/HelpOverlay.js';
import { HELP_TABS } from '../src/data/helpContent.js';

function makeDisplayObject(extra = {}) {
  return {
    handlers: {},
    style: {},
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor(color) { this.style.color = color; return this; },
    on(event, handler) { this.handlers[event] = handler; return this; },
    destroy: vi.fn(),
    ...extra,
  };
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (_x, _y, _w, _h, _color, _alpha) => makeDisplayObject(),
      graphics: () => ({
        ...makeDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      }),
      text: (_x, _y, text, style = {}) => makeDisplayObject({ text, style: { ...style } }),
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    game: {
      events: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
  };
}

describe('HelpOverlay search', () => {
  it('querying "Par" jumps to a matching section and highlights the matched term', () => {
    const overlay = new HelpOverlay(makeScene(), vi.fn());
    overlay.show();

    overlay.searchInputActive = true;
    overlay._setSearchQuery('Par');

    expect(overlay.searchResults.length).toBeGreaterThan(0);
    expect(overlay.activeTabIndex).toBe(overlay.searchResults[0].tabIndex);
    expect(overlay.currentPage).toBe(overlay.searchResults[0].pageIndex);

    const parLine = overlay.objects.find((obj) => String(obj?.text || '').includes('Par: target turns'));
    expect(parLine).toBeTruthy();
    expect(parLine.style.color).toBe('#66ff66');
  });

  it('shows "No matches" when no help entries match the query', () => {
    const overlay = new HelpOverlay(makeScene(), vi.fn());
    overlay.show();

    overlay.searchInputActive = true;
    overlay._setSearchQuery('zzzz_no_result_term');

    const noMatches = overlay.objects.find((obj) => obj?.text === 'No matches');
    expect(noMatches).toBeTruthy();
  });

  it('tab navigation still works after a search', () => {
    const overlay = new HelpOverlay(makeScene(), vi.fn());
    overlay.show();

    overlay.searchInputActive = true;
    overlay._setSearchQuery('Par');

    const nextTab = (overlay.activeTabIndex + 1) % HELP_TABS.length;
    const nextLabel = HELP_TABS[nextTab].label;
    const tabText = overlay.objects.find((obj) => obj?.text === nextLabel && obj.handlers?.pointerdown);
    expect(tabText).toBeTruthy();

    tabText.handlers.pointerdown();

    expect(overlay.activeTabIndex).toBe(nextTab);
    expect(overlay.currentPage).toBe(0);
  });

  it('ESC in search mode exits search only and keeps overlay open', () => {
    const overlay = new HelpOverlay(makeScene(), vi.fn());
    overlay.show();
    overlay.searchInputActive = true;
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    overlay._onEsc(null, event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(overlay.searchInputActive).toBe(false);
    expect(overlay.visible).toBe(true);
  });
});
