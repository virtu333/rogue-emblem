// The Dark Omen's page (docs/specs/event-nodes-phase2.md §2B), played through the real
// EventController and EventMenu with the rendering-only presentation.
//
// Ways this can fail, a test each:
//   1. a Dark Omen's page looks like the plain event (the kicker, the intro, the choices);
//   2. a plain event's page claims to be dark.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { EventDriver } from './harness/EventDriver.js';
import { findEvent } from '../src/engine/EventSystem.js';
import { baseData } from './eventKit.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

describe('the event page', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new JourneyStorage());
    vi.stubGlobal('document', { activeElement: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a Dark Omen shows its kicker, its dark intro and its dark choices', () => {
    const d = new EventDriver({ eventId: 'twin_altar' });
    const altar = findEvent(baseData.events, 'twin_altar');
    d.run.eventStateByNodeId[d.node.id].dark = true;
    d.open();
    const text = d.text();
    expect(text).toContain('DARK OMEN');
    expect(text).toContain(altar.dark.intro);
    expect(text).not.toContain(altar.intro);
    expect(d.choice('kneel')).toBeTruthy();
    expect(d.choice('offerings')).toBeTruthy();
    expect(d.choice('dawn')).toBeUndefined();
    expect(d.menu.surface.root.classList.contains('is-dark-omen')).toBe(true);
  });

  it('the same event on a plain node is the plain page', () => {
    const d = new EventDriver({ eventId: 'twin_altar' });
    const altar = findEvent(baseData.events, 'twin_altar');
    d.open();
    const text = d.text();
    expect(text).toContain(altar.intro);
    expect(text).not.toContain('DARK OMEN');
    expect(d.choice('dawn')).toBeTruthy();
    expect(d.menu.surface.root.classList.contains('is-dark-omen')).toBe(false);
  });
});
