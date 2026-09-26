import { describe, it, expect, vi } from 'vitest';
import { reflowLines } from '../src/ui/ReferenceMenu.js';
import { portraitListLayout, watchPortraitListLayout } from '../src/ui/portraitListLayout.js';
import { HOW_TO_PLAY_PAGES } from '../src/data/helpContent.js';

describe('reflowLines (portrait reference detail)', () => {
  it('rejoins a sentence the canvas panel had broken across lines', () => {
    expect(
      reflowLines(['Battles are fought on a grid. Your', 'turn: move units, then attack or wait.']),
    ).toEqual(['Battles are fought on a grid. Your turn: move units, then attack or wait.']);
    expect(
      reflowLines(['Tap Danger to toggle the danger zone', '(shows all threat ranges).']),
    ).toEqual(['Tap Danger to toggle the danger zone (shows all threat ranges).']);
  });

  it('keeps blank lines, list rows, new sentences and labelled lines apart', () => {
    const lines = [
      'The Weapon Triangle matters:',
      '  Sword > Axe > Lance > Sword',
      '  (+10 Hit, +1 Damage advantage)',
      '',
      'Gold, loot, and HP carry between nodes.',
      'Visit Church or Ruins nodes to heal.',
      'HP  Hit Points. Unit dies at 0.',
      'STR  Strength. Physical attack power.',
      'Mt:8  Ht:85  Cr:0',
      '1000g',
    ];
    expect(reflowLines(lines)).toEqual(lines);
  });

  it('never joins onto a blank line, and loses no words from the real guide', () => {
    expect(reflowLines(['', 'lowercase after a break'])).toEqual(['', 'lowercase after a break']);
    for (const page of HOW_TO_PLAY_PAGES) {
      const lines = page.lines.map((l) => l.text);
      const words = (list) => list.join(' ').split(/\s+/).filter(Boolean);
      expect(words(reflowLines(lines))).toEqual(words(lines));
    }
    const run = reflowLines(HOW_TO_PLAY_PAGES[0].lines.map((l) => l.text));
    expect(run).toContain(
      'You lead a party through 3 acts plus a final boss. Choose your path on a branching node map: battles, villages, churches, ruins, and recruit missions.',
    );
  });
});

function fakeEnv({ cls = [], portrait = true } = {}) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const classes = new Set(cls);
  const media = {
    get matches() {
      return env.portrait;
    },
    addEventListener: (_t, fn) => mediaListeners.add(fn),
    removeEventListener: (_t, fn) => mediaListeners.delete(fn),
  };
  const env = {
    portrait,
    document: { documentElement: { classList: { contains: (c) => classes.has(c) } } },
    matchMedia: (q) => (q === '(orientation: portrait)' ? media : { matches: false }),
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
    classes,
    fire: (t) => listeners.get(t)?.(),
    rotate(p) {
      env.portrait = p;
      for (const fn of mediaListeners) fn();
    },
    listeners,
    mediaListeners,
  };
  return env;
}

describe('portraitListLayout', () => {
  it('needs both the shell class and an upright viewport', () => {
    expect(portraitListLayout(fakeEnv({ cls: ['portrait-ui'], portrait: true }))).toBe(true);
    expect(portraitListLayout(fakeEnv({ cls: ['portrait-ui'], portrait: false }))).toBe(false);
    expect(portraitListLayout(fakeEnv({ cls: [], portrait: true }))).toBe(false);
    expect(portraitListLayout({})).toBe(false);
  });

  it('reports each flip once, from the shell event or a rotation, until unsubscribed', () => {
    const env = fakeEnv({ cls: ['portrait-ui'], portrait: true });
    const seen = vi.fn();
    const stop = watchPortraitListLayout(seen, env);
    env.fire('emblem-rogue:portrait-ui');
    expect(seen).not.toHaveBeenCalled();
    env.rotate(false);
    expect(seen).toHaveBeenLastCalledWith(false);
    env.classes.delete('portrait-ui');
    env.rotate(true);
    expect(seen).toHaveBeenCalledTimes(1);
    env.classes.add('portrait-ui');
    env.fire('emblem-rogue:portrait-ui');
    expect(seen).toHaveBeenLastCalledWith(true);
    stop();
    expect(env.listeners.size).toBe(0);
    expect(env.mediaListeners.size).toBe(0);
  });
});
