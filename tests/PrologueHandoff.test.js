// The handoff out of the tutorial's protection (ui/PrologueHandoff.js, the copy in
// prologueContent's prologueHandoffContent; docs/specs/prologue-chapter.md §9 "The
// handoff"): one screen between the ending and Home Base that says, in plain words,
// which loss ends a run, what a fall costs, what starts over, what stays and how long
// Vision lasts. It shows once with the ending (PrologueEnding.test.js holds the once),
// continues on its button or Escape, and never holds a scene that left.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { showPrologueHandoff } from '../src/ui/PrologueHandoff.js';
import {
  prologueCompleteCard,
  prologueHandoffContent,
  prologueThreadCard,
} from '../src/data/prologueContent.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function sceneFor() {
  const handlers = new Map();
  return {
    sys: { isActive: () => true },
    registry: { get: () => null },
    events: {
      once: (name, fn) => handlers.set(name, fn),
      on: (name, fn) => handlers.set(name, fn),
      off: (name) => handlers.delete(name),
      emit: (name) => handlers.get(name)?.(),
    },
  };
}

let dom;
beforeEach(() => {
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('the handoff copy', () => {
  const content = prologueHandoffContent({ lead: data.prologue.ending.titleCard, won: true });
  const text = content.rows.map((r) => `${r.term} ${r.text}`).join('\n');

  it('says the five rules a first run lives by, in plain words', () => {
    // Which loss ends a run: the commander's fall, and who that is.
    expect(text).toMatch(/A run ends only when your commander falls\. Edric leads your first run\./); // prettier-ignore
    // A fallen ally: down until a Church revives them, for gold.
    expect(text).toMatch(/Fallen allies stay down until a Church revives them for gold\./);
    // What starts over: the army, levels, items, gold.
    expect(text).toMatch(/fresh army, with levels, items and gold reset/);
    // What stays: Valor, Supply and the Home Base upgrades.
    expect(text).toMatch(/Stays Valor and Supply you earn, and the Home Base upgrades they buy\./);
    // Vision lasts the run.
    expect(text).toMatch(/Vision charges last the whole run\./);
    expect(content.rows).toHaveLength(5);
  });

  it('is one short screen: each rule one line, the lead the ending card', () => {
    for (const row of content.rows) {
      expect(`${row.term} ${row.text}`.length, row.term).toBeLessThanOrEqual(90);
      expect(row.text).not.toMatch(/\n/);
    }
    expect(content.lead).toBe(data.prologue.ending.titleCard);
    expect(content.kicker).toBe('Prologue complete');
    expect(prologueHandoffContent({ won: false }).kicker).toBe('The prologue ends');
    expect(prologueHandoffContent({ commander: 'Kira' }).rows[0].text).toContain('Kira leads');
  });

  it("the ending reads as the player's win and the world's break, never a game over", () => {
    const thread = prologueThreadCard({ won: true });
    expect(thread.word).toBe('THE THREAD BREAKS');
    expect(thread.word).not.toMatch(/CUT/);
    expect(thread.sub).toBe('The gate held. The world did not.');
    expect(thread.meta).toMatch(/^Prologue complete/);
    // After a skip nothing claims a win.
    const skipped = prologueThreadCard({ won: false });
    expect(`${skipped.sub} ${skipped.meta}`).not.toMatch(/held|complete/i);
    expect(prologueCompleteCard({ chapters: 4 })).toEqual({
      tone: 'holds',
      word: 'PROLOGUE COMPLETE',
      sub: 'The Quarry Gate is held',
      meta: '4 chapters won',
    });
    // The title card that leads the handoff says the break was not theirs.
    expect(data.prologue.ending.titleCard).toMatch(/not by your hand\.$/);
    expect(data.prologue.ending.titleCard.length).toBeLessThanOrEqual(240);
  });
});

describe('the handoff screen', () => {
  it('shows the rules and continues on its button', async () => {
    const scene = sceneFor();
    const shown = showPrologueHandoff(scene, { lead: 'Every run is a thread.', won: true });
    const dialog = dom.doc.querySelector('.re-handoff');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-label')).toBe('From here, it counts');
    expect(dialog.textContent).toContain('Prologue complete');
    expect(dialog.textContent).toContain('Every run is a thread.');
    const terms = dialog.querySelectorAll('dt').map((dt) => dt.textContent);
    expect(terms).toEqual(['A run ends', 'Fallen allies', 'Starts over', 'Stays', 'Vision']);
    const go = dialog.querySelectorAll('button').find((b) => b.textContent === 'To Home Base');
    go.click();
    expect(await shown).toBe(true);
    expect(dom.doc.querySelector('.re-handoff')).toBeNull();
  });

  it('a scene that shuts down under it settles it, false', async () => {
    const scene = sceneFor();
    const shown = showPrologueHandoff(scene, {});
    scene.events.emit('shutdown');
    expect(await shown).toBe(false);
    expect(dom.doc.querySelector('.re-handoff')).toBeNull();
  });
});
