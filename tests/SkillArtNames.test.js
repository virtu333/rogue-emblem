// Skill and weapon-art display names (naming pass round two, docs/specs/item-names.md).
// Ids never change; names can, and a name shows up in more places than the name
// field. The ways a rename can go wrong, each caught below:
//   - a scroll keeps teaching under its old name, or its "Teaches X" line does;
//   - an art's activation record (what banners and the Legendary cut-in look the
//     art back up by) keeps the old name;
//   - combat labels a proc with a hardcoded old name, so the banner shows it and
//     ProcVisualTheme can no longer classify it;
//   - a random legendary says "Grants Sol" while the skill is called something else;
//   - an FE name survives in the catalog or the help pages.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadGameData } from './testData.js';
import { rollDefenseSkills, rollStrikeSkills, checkAstra } from '../src/engine/SkillSystem.js';
import { grantedSkillSpecial } from '../src/engine/LootSystem.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { classifySkillEventName, PROC_CATEGORY } from '../src/ui/ProcVisualTheme.js';
import { HELP_TABS } from '../src/data/helpContent.js';

const gameData = loadGameData();
const skills = gameData.skills;
const arts = gameData.weaponArts.arts;
const skillName = (id) => skills.find((s) => s.id === id).name;

// Fire Emblem's own skill and art names this pass moved off. Canto stays (owner's call).
const RETIRED_SKILLS = [
  'Sol',
  'Luna',
  'Astra',
  'Aether',
  'Vantage',
  'Wrath',
  'Adept',
  'Miracle',
  'Cancel',
  'Desperation',
  'Quick Riposte',
  'Death Blow',
  'Darting Blow',
  'Armored Blow',
  'Fiendish Blow',
  'Pavise',
  'Aegis',
  'Lethality',
  'Colossus',
  'Sure Shot',
  'Critical +15',
  'Flare',
];
const RETIRED_ARTS = [
  'Wrath Strike',
  'Grounder',
  'Windsweep',
  'Hexblade',
  'Seal Speed',
  'Finesse Blade',
  'Dragonhaze',
  'Astra Strike',
  'Tempest Lance',
  'Hit and Run',
  'Knightkneeler',
  'Shatter Slash',
  'Glowing Ember',
  'Longearche',
  'Helm Splitter',
  'Diamond Axe',
  'Wild Abandon',
  'Rushing Blow',
  'Armored Strike',
  'Curved Shot',
  'Encloser',
  'Ward Arrow',
  'Break Shot',
  'Waning Shot',
  'Seal Magic',
  'Heavy Draw',
  "Hunter's Volley",
  'Burning Quake',
  'Nosferatu',
  'Seraphim',
  'Galeforce Assault',
];

afterEach(() => vi.restoreAllMocks());

describe('the catalog', () => {
  it('no retired name is a skill, an art or a scroll', () => {
    const names = new Set([...skills.map((s) => s.name), ...arts.map((a) => a.name)]);
    const scrolls = new Set(gameData.weapons.filter((w) => w.type === 'Scroll').map((w) => w.name));
    for (const old of [...RETIRED_SKILLS, ...RETIRED_ARTS]) {
      expect(names.has(old), old).toBe(false);
      expect(scrolls.has(`${old} Scroll`), old).toBe(false);
    }
  });

  it('every scroll is named for what it teaches, and says so', () => {
    for (const scroll of gameData.weapons.filter((w) => w.type === 'Scroll')) {
      if (scroll.skillId) {
        const name = skillName(scroll.skillId);
        expect(scroll.name).toBe(`${name} Scroll`);
        expect(scroll.special).toBe(`Teaches ${name}`);
      } else {
        const art = arts.find((a) => a.id === scroll.teachesWeaponArtId);
        expect(art, scroll.name).toBeTruthy();
        expect(scroll.name).toBe(`${art.name} Scroll`);
        expect(scroll.special).toBe(`Teaches ${art.name} (Weapon Art)`);
      }
    }
  });

  it("every art's activation record carries the art's own name", () => {
    for (const art of arts)
      for (const act of art.combatMods?.activated || []) expect(act.name, art.id).toBe(art.name);
  });

  it('the help pages name no retired skill', () => {
    const text = JSON.stringify(HELP_TABS);
    for (const old of RETIRED_SKILLS.filter((n) => n !== 'Cancel'))
      expect(text, old).not.toMatch(new RegExp(`\\b${old.replace('+', '\\+')}\\b`));
    // "Cancel" is also the back button; only the skill line is checked.
    expect(text).not.toContain('Cancel: SPD%');
  });
});

describe('combat labels procs with the data name', () => {
  const unit = (skillIds, stats = {}) => ({
    name: 'Tester',
    skills: skillIds,
    stats: { SKL: 99, SPD: 99, LCK: 99, DEF: 10, RES: 10, ...stats },
    weapon: { type: 'Sword', might: 5 },
    currentHP: 30,
  });

  it('strike and defence procs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const strike = rollStrikeSkills(unit(['sol']), 10, unit([]), skills);
    expect(strike.activated).toContainEqual({ id: 'sol', name: skillName('sol') });
    const guard = rollDefenseSkills(unit(['pavise']), 10, true, skills);
    expect(guard.activated).toContainEqual({ id: 'pavise', name: skillName('pavise') });
    const astra = checkAstra(unit(['astra']), skills);
    expect(astra.name).toBe(skillName('astra'));
    // And the banner can still classify them.
    expect(classifySkillEventName(astra.name, skills)).toBe(PROC_CATEGORY.OFFENSE);
  });

  it('pre-combat events (Vantage, Desperation) use the data name', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attacker = {
      ...unit([]),
      name: 'Attacker',
      stats: { STR: 5, SKL: 5, SPD: 5, LCK: 0, DEF: 0, RES: 0, HP: 30 },
      weapon: {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 100,
        crit: 0,
        weight: 0,
        range: '1',
      },
    };
    const defender = {
      ...attacker,
      name: 'Defender',
      currentHP: 10,
      stats: { ...attacker.stats, HP: 30 },
    };
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      {
        atkMods: null,
        defMods: { vantage: true },
        skillsData: skills,
      },
    );
    const named = result.events.filter((e) => e.type === 'skill').map((e) => e.name);
    expect(named).toContain(skillName('vantage'));
  });

  it('no activation in the combat engine carries a hardcoded name', () => {
    // A literal name drifts from skills.json the next time a skill is renamed.
    const skillSystem = readFileSync(
      new URL('../src/engine/SkillSystem.js', import.meta.url),
      'utf8',
    );
    expect(skillSystem).not.toMatch(/activated\.push\(\{ id: '[a-z_]+', name: '/);
    const combat = readFileSync(new URL('../src/engine/Combat.js', import.meta.url), 'utf8');
    expect(combat).not.toMatch(/type: 'skill',\s*name: '/);
  });
});

describe('weapons that grant a skill', () => {
  it('name it as skills.json does, with or without the data at hand', () => {
    for (const id of ['sol', 'luna', 'vantage', 'wrath', 'adept']) {
      expect(grantedSkillSpecial(id, skills)).toBe(`Grants ${skillName(id)} to wielder`);
      expect(grantedSkillSpecial(id)).toBe(`Grants ${skillName(id)} to wielder`);
    }
  });
});
