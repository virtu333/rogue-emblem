import { describe, it, expect } from 'vitest';
import {
  teachRosterScroll,
  giveRosterItem,
  giveRosterItemBlock,
} from '../src/engine/RosterTransfers.js';
function fixture() {
  const sword = { name: 'Sword', type: 'Sword' };
  const a = { skills: [], inventory: [sword], consumables: [], weapon: sword, proficiencies: [] };
  const b = { skills: [], inventory: [], consumables: [], proficiencies: [] };
  const scroll = { name: 'Wrath scroll', skillId: 'wrath' };
  return {
    a,
    b,
    sword,
    scroll,
    run: { roster: [a, b], scrolls: [scroll] },
    skills: [{ id: 'wrath' }],
  };
}
describe('roster teaching and transfers', () => {
  it('teaches once and consumes the team scroll, rejecting stale replay', () => {
    const { a, b, scroll, run, skills } = fixture();
    expect(teachRosterScroll(run, a, scroll, skills).ok).toBe(true);
    expect(a.skills).toEqual(['wrath']);
    expect(run.scrolls).toEqual([]);
    expect(teachRosterScroll(run, b, scroll, skills).ok).toBe(false);
    expect(b.skills).toEqual([]);
  });
  it('preserves scrolls for duplicate skills and full slots', () => {
    const { a, scroll, run, skills } = fixture();
    a.skills = ['wrath'];
    expect(teachRosterScroll(run, a, scroll, skills).ok).toBe(false);
    a.skills = ['a', 'b', 'c', 'd', 'e'];
    expect(teachRosterScroll(run, a, scroll, skills).ok).toBe(false);
    expect(run.scrolls).toEqual([scroll]);
  });
  it('allows carrying unusable equipment and rejects repeated transfer', () => {
    const { a, b, sword, run } = fixture();
    expect(giveRosterItem(run, a, b, sword).ok).toBe(true);
    expect(a.inventory).toHaveLength(0);
    expect(b.inventory).toHaveLength(1);
    expect(giveRosterItem(run, a, b, sword).ok).toBe(false);
    expect(b.inventory).toHaveLength(1);
  });
  it('rejects full bags and self transfers without losing items', () => {
    const { a, b, sword, run } = fixture();
    b.inventory = Array(5).fill({ name: 'Other' });
    expect(giveRosterItem(run, a, b, sword).ok).toBe(false);
    expect(giveRosterItemBlock(run, a, a, sword)).toBeTruthy();
    expect(a.inventory).toEqual([sword]);
  });
});
