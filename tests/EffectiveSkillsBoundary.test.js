// A unit's skills in battle come from one read: engine/EffectiveSkills.js (unit.skills, the
// weapon in use's `_grantedSkill`, the equipped accessory's `_boundSkill`; docs/specs/phase3.md
// 3A). Battle code that read `unit.skills` directly could not see a lent skill, which is how a
// Bond Ring's skill would have been dead on every path but four. This test holds the line, as
// HpWriteBoundary does for HP.
//
// What it scans, and what it deliberately does not:
//  - SCANNED: the battle files below, for any read of `.skills` that is not the catalog
//    (`gameData.skills`, the skills.json list). A new read there fails until it either moves to
//    effectiveSkills / hasEffectiveSkill or earns an entry in ALLOWED with the reason it is not
//    a unit's battle skills.
//  - NOT SCANNED: the roster, loadout and learning code (SkillLoadout, UnitManager.learnSkill,
//    RunManager, the Roster*/Mobile* UIs, UnitDetailOverlay, PartyMenus, serialization, run
//    records). Those edit or show the equipped list (`n/MAX_SKILLS`) and `knowsSkill` stays
//    their test. A destructured `{ skills }` read is not caught by a text scan.
//  - SEPARATELY: only EffectiveSkills.js may read a weapon's `_grantedSkill` or an accessory's
//    `_boundSkill` anywhere in src; writers are listed in BOUND_SKILL_WRITERS.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BATTLE_FILES = [
  'src/scenes/BattleScene.js',
  'src/engine/SkillSystem.js',
  'src/engine/Combat.js',
  'src/engine/ActionAbilitySystem.js',
  'src/engine/CantoRule.js',
  'src/engine/AIController.js',
  'src/engine/Guidance.js',
  'src/ui/MovementActionController.js',
  'src/ui/ForecastOverlay.js',
  'src/ui/MobileBattleHUD.js',
];

// `.skills` that is not the skills.json catalog (`gameData.skills`, `gameData?.skills`).
const UNIT_SKILLS_READ = /(?<!gameData\??)\??\.skills\b/;

// Each allowed read: the file, a pattern for the line, and why it is not a unit's skills.
const ALLOWED = [
  {
    file: 'src/ui/ForecastOverlay.js',
    match: /forecast\.(attacker|defender)\.skills/,
    why: 'the forecast side’s activated-skill list: what getSkillCombatMods already resolved (lent skills included), not a unit',
  },
  {
    file: 'src/ui/ForecastOverlay.js',
    match: /\binfo\.skills\b/,
    why: 'the same activated-skill list, drawn for one side',
  },
  {
    file: 'src/ui/MobileBattleHUD.js',
    match: /\binfo\.skills\b/,
    why: 'the same activated-skill list, drawn for one side',
  },
];

// The only places that write a bound skill; nothing outside EffectiveSkills.js reads one.
const BOUND_SKILL_WRITERS = [
  {
    file: 'src/engine/LootSystem.js',
    why: 'generateRandomLegendary rolls a legendary weapon’s _grantedSkill when it is created',
  },
];
const BOUND_SKILL = /_grantedSkill|_boundSkill/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.js') ? [path.replace(/\\/g, '/')] : [];
  });
}

function codeLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({ at: i + 1, code: text.replace(/\/\/.*$/, '').trim() }))
    .filter((l) => l.code && !l.code.startsWith('*') && !l.code.startsWith('/*'));
}

function skillReads() {
  return BATTLE_FILES.flatMap((file) =>
    codeLines(file)
      .filter((l) => UNIT_SKILLS_READ.test(l.code))
      .map((l) => ({ file, ...l })),
  );
}

const allowed = (read) => ALLOWED.some((a) => a.file === read.file && a.match.test(read.code));

describe('battle code reads a unit’s skills only through effectiveSkills', () => {
  it('has no direct read of unit.skills outside the allow-list', () => {
    const unexpected = skillReads().filter((r) => !allowed(r));
    expect(unexpected.map((r) => `${r.file}:${r.at}  ${r.code}`)).toEqual([]);
  });

  it('every allowed read still exists (the list cannot go stale)', () => {
    const reads = skillReads();
    for (const entry of ALLOWED)
      expect(
        reads.some((r) => r.file === entry.file && entry.match.test(r.code)),
        `${entry.file} ${entry.match}`,
      ).toBe(true);
  });

  it('every scanned battle file exists and uses the shared read or has nothing to read', () => {
    for (const file of BATTLE_FILES) expect(statSync(file).isFile()).toBe(true);
    // The files that were migrated import the helper; a revert to unit.skills drops the import.
    for (const file of [
      'src/engine/SkillSystem.js',
      'src/engine/Combat.js',
      'src/engine/ActionAbilitySystem.js',
      'src/engine/CantoRule.js',
      'src/engine/AIController.js',
      'src/engine/Guidance.js',
      'src/scenes/BattleScene.js',
      'src/ui/MovementActionController.js',
      'src/ui/ForecastOverlay.js',
      'src/ui/MobileBattleHUD.js',
    ])
      expect(readFileSync(file, 'utf8'), file).toMatch(
        /from '(\.\.?\/)+(engine\/)?EffectiveSkills\.js'/,
      );
  });

  it('the pattern catches the forms a read takes and ignores the catalog', () => {
    for (const line of [
      'u.skills.includes(id)',
      'unit.skills?.includes("dance")',
      'for (const id of ally.skills) {',
      'const n = (target.skills || []).length;',
      'unit?.skills',
    ])
      expect(UNIT_SKILLS_READ.test(line), line).toBe(true);
    for (const line of [
      'getTerrainCostReduction(unit, this.gameData?.skills);',
      'const skills = scene.gameData.skills;',
      'if (!this.gameData.skills) this.gameData.skills = [];',
    ])
      expect(UNIT_SKILLS_READ.test(line), line).toBe(false);
  });
});

describe('only EffectiveSkills reads a bound skill', () => {
  const mentions = () =>
    sourceFiles('src')
      .filter((file) => file !== 'src/engine/EffectiveSkills.js')
      .flatMap((file) =>
        codeLines(file)
          .filter((l) => BOUND_SKILL.test(l.code))
          .map((l) => ({ file, ...l })),
      );

  it('no other source file mentions _grantedSkill or _boundSkill except the listed writers', () => {
    const unexpected = mentions().filter(
      (m) => !BOUND_SKILL_WRITERS.some((w) => w.file === m.file),
    );
    expect(unexpected.map((m) => `${m.file}:${m.at}  ${m.code}`)).toEqual([]);
  });

  it('a listed writer only assigns, never reads', () => {
    for (const m of mentions())
      expect(m.code, `${m.file}:${m.at}`).toMatch(/\._(?:grantedSkill|boundSkill)\s*=(?!=)/);
  });

  it('every listed writer still mentions a bound skill (the list cannot go stale)', () => {
    const files = new Set(mentions().map((m) => m.file));
    for (const w of BOUND_SKILL_WRITERS) expect(files.has(w.file), w.file).toBe(true);
  });

  it('EffectiveSkills itself reads both sources', () => {
    const src = readFileSync('src/engine/EffectiveSkills.js', 'utf8');
    expect(src).toMatch(/_grantedSkill/);
    expect(src).toMatch(/_boundSkill/);
  });
});
