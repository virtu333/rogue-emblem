// Phase 3B data (docs/specs/phase3.md): the five new skills, their scrolls, where they drop,
// who teaches them and which deeds swear them.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  classifyActivation,
  classifySkillEventName,
  PROC_CATEGORY,
} from '../src/ui/ProcVisualTheme.js';
import { promotionOathCandidates } from '../src/engine/DeedSystem.js';
import { createEnemyUnit, getClassInnateSkills } from '../src/engine/UnitManager.js';

const data = loadGameData();
const NEW_SKILLS = ['lifetaker', 'speedtaker', 'uncanny_blow', 'warding_blow', 'defiant'];
const skill = (id) => data.skills.find((s) => s.id === id);
const scrollFor = (id) => data.weapons.find((w) => w.type === 'Scroll' && w.skillId === id);

describe('the skills', () => {
  it('exist once each, with the specified trigger, condition and effect', () => {
    for (const id of NEW_SKILLS) expect(data.skills.filter((s) => s.id === id)).toHaveLength(1);
    expect(skill('lifetaker')).toMatchObject({
      trigger: 'on-kill',
      effects: { healPercentMaxHp: 25 },
    });
    expect(skill('speedtaker')).toMatchObject({
      trigger: 'on-kill',
      effects: { spdPerKill: 1, spdMax: 5 },
    });
    expect(skill('uncanny_blow')).toMatchObject({
      trigger: 'on-combat-start',
      condition: 'initiating',
      effects: { hitBonus: 30 },
    });
    expect(skill('warding_blow')).toMatchObject({
      trigger: 'on-combat-start',
      condition: 'initiating',
      effects: { resBonus: 6 },
    });
    expect(skill('defiant')).toMatchObject({
      trigger: 'on-combat-start',
      condition: 'below25',
      effects: { defBonus: 4, resBonus: 4 },
    });
  });

  it('are plain skills: no class innate, no personal skill, no action', () => {
    for (const id of NEW_SKILLS) {
      expect(skill(id).classInnate).toBeUndefined();
      expect(skill(id).personal).toBeUndefined();
      expect(skill(id).actionAbility).toBeUndefined();
    }
    const innate = new Set(data.classes.flatMap((c) => getClassInnateSkills(c.name, data.skills)));
    for (const id of NEW_SKILLS) expect(innate.has(id)).toBe(false);
  });

  it('are never handed to enemies, and no class curriculum teaches them', () => {
    // Every class (promoted ones carry their innate skills) at a level where skills roll,
    // with the skill roll forced on (Math.random 0 is under every act's chance).
    const roll = Math.random;
    Math.random = () => 0;
    try {
      for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
        for (const classData of data.classes.filter((c) => c.baseStats)) {
          const foe = createEnemyUnit(classData, 12, data.weapons, 1.0, data.skills, act);
          for (const id of NEW_SKILLS)
            expect(foe.skills, `${act} ${classData.name}`).not.toContain(id);
        }
      }
    } finally {
      Math.random = roll;
    }
    const learnable = new Set(
      data.classes.flatMap((c) => (c.learnableSkills || []).map((l) => l.skillId)),
    );
    for (const id of NEW_SKILLS) expect(learnable.has(id)).toBe(false);
  });

  it('an on-kill skill shows as an offense proc, not an unknown neutral one', () => {
    for (const id of ['lifetaker', 'speedtaker']) {
      expect(classifyActivation({ id, name: skill(id).name }, data.skills)).toBe(
        PROC_CATEGORY.OFFENSE,
      );
      expect(classifySkillEventName(skill(id).name, data.skills)).toBe(PROC_CATEGORY.OFFENSE);
    }
  });
});

describe('the scrolls', () => {
  it('each skill has one Rare, 2500 G Scroll that resolves back to it', () => {
    for (const id of NEW_SKILLS) {
      const scrolls = data.weapons.filter((w) => w.type === 'Scroll' && w.skillId === id);
      expect(scrolls, id).toHaveLength(1);
      expect(scrolls[0]).toMatchObject({
        name: `${skill(id).name} Scroll`,
        tier: 'Rare',
        price: 2500,
        special: `Teaches ${skill(id).name}`,
        might: 0,
        hit: 0,
        crit: 0,
        weight: 0,
        range: '0',
      });
    }
  });

  it('carry every field the older skill scrolls carry', () => {
    const reference = data.weapons.find((w) => w.name === 'Death Blow Scroll');
    for (const id of NEW_SKILLS) {
      expect(Object.keys(scrollFor(id)).sort()).toEqual(Object.keys(reference).sort());
    }
  });

  it('every scroll in the catalog teaches a skill that exists', () => {
    const ids = new Set(data.skills.map((s) => s.id));
    for (const w of data.weapons.filter((entry) => entry.type === 'Scroll' && entry.skillId))
      expect(ids.has(w.skillId), w.name).toBe(true);
  });

  it('drop from the act 2 to 4 skill-scroll pools, never in act 1', () => {
    const names = NEW_SKILLS.map((id) => scrollFor(id).name);
    for (const act of ['act2', 'act3', 'act4']) {
      const pool = data.lootTables[act].skillScroll;
      for (const name of names) expect(pool, `${act} ${name}`).toContain(name);
    }
    const act1 = JSON.stringify(data.lootTables.act1);
    for (const name of names) expect(act1).not.toContain(name);
  });

  it('every skill-scroll pool entry is a real Scroll', () => {
    for (const [act, table] of Object.entries(data.lootTables)) {
      for (const name of table.skillScroll || []) {
        const weapon = data.weapons.find((w) => w.name === name);
        expect(weapon?.type, `${act} ${name}`).toBe('Scroll');
        expect(weapon.skillId, `${act} ${name}`).toBeTruthy();
      }
    }
  });
});

describe('the teachers', () => {
  const teaching = (eventId) => {
    const event = data.events.events.find((e) => e.id === eventId);
    return event.choices.flatMap((choice) =>
      choice.outcomes.flatMap((outcome) =>
        (outcome.effects || []).filter((effect) => effect.type === 'learnSkill'),
      ),
    );
  };

  it('the Old Swordmaster teaches Uncanny Blow to swords and Warding Blow to lances', () => {
    const effects = teaching('old_swordmaster');
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) {
      expect(effect.poolByType.Sword).toContain('uncanny_blow');
      expect(effect.poolByType.Lance).toContain('warding_blow');
      expect(effect.poolByType.Axe).not.toContain('uncanny_blow');
    }
  });

  it('the Chained Shelf teaches Lifetaker', () => {
    const effects = teaching('chained_shelf');
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) expect(effect.pool).toContain('lifetaker');
  });

  it('every teaching pool names real skills, none personal or class innate', () => {
    const ids = new Set(data.skills.map((s) => s.id));
    for (const event of data.events.events) {
      for (const choice of event.choices)
        for (const outcome of choice.outcomes)
          for (const effect of outcome.effects || []) {
            if (effect.type !== 'learnSkill') continue;
            const pooled = [
              ...(effect.skillId ? [effect.skillId] : []),
              ...(effect.pool || []),
              ...Object.values(effect.poolByType || {}).flat(),
            ];
            for (const id of pooled) {
              expect(ids.has(id), `${event.id} ${id}`).toBe(true);
              expect(skill(id).personal, `${event.id} ${id}`).toBeFalsy();
            }
          }
    }
  });
});

describe('the oaths', () => {
  const earnedDeed = (id) => {
    const def = data.deeds.deeds.find((d) => d.id === id);
    return {
      isLord: false,
      skills: [],
      deeds: {
        stats: {},
        earned: [
          { id, epithet: def.epithet.text, form: def.epithet.form, prestige: def.prestige, seq: 1 },
        ],
      },
      name: 'Oathbearer',
      faction: 'player',
    };
  };

  it('no Phase 3B skill is an Oath: Oath skills are the ones nothing else teaches', () => {
    // docs/specs/deeds-epithets.md: an Oath skill has no scroll and no curriculum. The five
    // new skills all have scrolls, so none may be sworn, and The Last Dance and The Last
    // still swear nothing.
    const newSkills = ['lifetaker', 'speedtaker', 'uncanny_blow', 'warding_blow', 'defiant'];
    for (const deed of data.deeds.deeds)
      expect(newSkills.includes(deed.oathSkill), deed.id).toBe(false);
    for (const deed of ['tempo', 'last_of_them']) {
      expect(data.deeds.deeds.find((d) => d.id === deed).oathSkill, deed).toBeUndefined();
      expect(promotionOathCandidates(earnedDeed(deed), data.deeds, data.skills), deed).toEqual([]);
    }
  });

  it('every oath skill in deeds.json exists', () => {
    const ids = new Set(data.skills.map((s) => s.id));
    for (const deed of data.deeds.deeds.filter((d) => d.oathSkill))
      expect(ids.has(deed.oathSkill), deed.id).toBe(true);
  });
});
