// Skill display names (src/engine/SkillNames.js). Skill ids never change; names did in the naming
// pass. The ways it can fail, each caught below:
//   - a proc banner or timeline fact says a name from a copy in code, not skills.json's;
//   - a caller without skills.json says an old name ("Sol"), or a name the data no longer has.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import {
  RENAMED_SKILL_NAMES,
  fallbackSkillName,
  grantedSkillSpecial,
  renameGrantedSkillSpecial,
} from '../src/engine/SkillNames.js';
import { checkAstra, rollStrikeSkills } from '../src/engine/SkillSystem.js';
import { boundSkillName } from '../src/engine/AccessorySkillNames.js';

const gameData = loadGameData();
afterEach(() => vi.restoreAllMocks());

const inWords = (id) =>
  id
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

describe('skill names without the data', () => {
  it('RENAMED_SKILL_NAMES says every skill as skills.json does, and lists every one it must', () => {
    for (const [id, name] of Object.entries(RENAMED_SKILL_NAMES))
      expect(gameData.skills.find((s) => s.id === id)?.name, id).toBe(name);
    for (const skill of gameData.skills)
      expect(fallbackSkillName(skill.id), skill.id).toBe(skill.name);
    expect(inWords('uncanny_blow')).toBe(fallbackSkillName('uncanny_blow'));
  });

  it('an accessory card names its lent skill as the data does, even without the data', () => {
    expect(boundSkillName('vantage')).toBe('Forestall');
    expect(boundSkillName('crit_plus_15')).toBe('Cold Eye');
  });

  it("a random legendary's special says the skill's name today, and an old one is reworded", () => {
    expect(grantedSkillSpecial('sol')).toBe('Grants Reclaim to wielder');
    expect(grantedSkillSpecial('sol', gameData.skills)).toBe('Grants Reclaim to wielder');
    expect(renameGrantedSkillSpecial('Grants Wrath to wielder')).toBe('Grants Seethe to wielder');
    expect(renameGrantedSkillSpecial('Grants Reclaim to wielder')).toBe(
      'Grants Reclaim to wielder',
    );
    expect(renameGrantedSkillSpecial('Effective vs. armor')).toBe('Effective vs. armor');
  });
});

describe('proc names come from skills.json', () => {
  // Renamed in the data only: the event must follow it.
  const renamed = (id, name) => gameData.skills.map((s) => (s.id === id ? { ...s, name } : s));
  const unit = (skills) => ({
    name: 'Edric',
    faction: 'player',
    skills,
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 40, SPD: 10, LCK: 40, DEF: 5, RES: 5, MOV: 5 },
    currentHP: 30,
  });

  it('Constellation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(checkAstra(unit(['astra']), renamed('astra', 'Star Test')).name).toBe('Star Test');
  });

  it('Umbra', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const target = unit([]);
    const result = rollStrikeSkills(unit(['luna']), 10, target, renamed('luna', 'Moon Test'));
    expect(result.activated.map((a) => a.name)).toContain('Moon Test');
  });
});
