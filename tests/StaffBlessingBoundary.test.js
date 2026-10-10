// Where a staff's uses, heal and reach are counted (Saint's Reserve, docs/specs/blessings-v3.md
// §5.3; Saint's Reliquary, §6.1).
//
// The battle menu, the heal's own check, the heal preview, the roster and unit sheets, the trade
// panes, the reward card, the shop comparison and the harness each ask Combat for a staff's uses,
// heal or reach. Saint's Reserve adds a use and Saint's Reliquary 5 HP and a tile of reach, all
// through `StaffBlessings.staffRunOptions(run, unit)`; a caller that forgets it shows "3/3" while
// the heal allows a fourth, previews "+12" for a heal of 17, or offers a target the heal's own
// check refuses (or hides one it accepts).
//
// Ways this can fail, a test each:
//   1. a call that counts a staff's uses (getStaffMaxUses / getStaffRemainingUses /
//      validateStaffAction), heal (resolveHeal / calculateHealAmount / calculateStaffHealOutput /
//      settleStaffHeal) or reach (getEffectiveStaffRange / findRelocateTargets /
//      getRelocationDestinations) is made without the run's staff options, outside the enemy AI,
//      the balance sims' own models and the files that define and forward them;
//   2. a display helper that counts a staff's uses is called without the run;
//   3. the scan itself is blind (the pattern matches nothing, or an allowlist entry is stale).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
const read = (path) => readFileSync(path, 'utf8');
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

const SCANNED = [
  ...sourceFiles(join(ROOT, 'src')),
  ...sourceFiles(join(ROOT, 'tests/harness')),
  ...sourceFiles(join(ROOT, 'sim')),
];

// The options argument of each call, by position (0-based).
const OPTIONS_ARG_INDEX = {
  getStaffMaxUses: 2, // (staff, healer, opts)
  getStaffRemainingUses: 2, // (staff, healer, opts)
  resolveHeal: 3, // (staff, healer, target, opts)
  calculateHealAmount: 3, // (staff, healer, target, opts)
  calculateStaffHealOutput: 2, // (staff, healer, opts)
  getStaffHealBase: 1, // (staff, opts): the "MAG+N" a display shows
  getEffectiveStaffRange: 2, // (staff, healer, opts)
  findRelocateTargets: 5, // (staff, caster, playerUnits, grid, getUnitAt, staffOptions)
  getRelocationDestinations: 5, // (staff, caster, ally, grid, getUnitAt, staffOptions)
};
// Calls that take the options as a named property of their one argument.
const OPTIONS_PROPERTY = {
  validateStaffAction: 'staffOptions',
  settleStaffHeal: 'healOpts',
};
// Display helpers that count a staff's uses: their options must carry the run.
const RUN_ARG_INDEX = {
  battleItemBrief: 2, // (item, unit, { run })
  battleItemSummary: 2, // (item, unit, { run })
  tradeItemBrief: 2, // (item, unit, { run })
  equipmentComparison: 3, // (unit, item, before, { ..., run })
};

// Files that may count uses without the run's options, each with the reason. A file listed here
// must still contain such a call (the last test), so a stale entry fails.
const ALLOWED = {
  'src/engine/Combat.js':
    'defines the rules: getStaffRemainingUses forwards the caller’s opts to getStaffMaxUses',
  'src/engine/AIController.js':
    'enemy AI: a foe’s staves never take a player blessing (staffRunOptions returns {} for a foe)',
  'src/engine/StaffSettlement.js':
    'defines validateStaffAction and settleStaffHeal: each forwards the caller’s options (`staffOptions`, `healOpts`) to Combat',
  'src/engine/StaffRelocation.js':
    'defines findRelocateTargets and getRelocationDestinations: each forwards the caller’s `staffOptions` to getEffectiveStaffRange',
  'src/ui/healTargetPreview.js':
    'defines healTargetPreview: it forwards the caller’s opts to resolveHeal (sceneHealPreview, its scene caller, passes staffRunOptions)',
  'sim/fullrun.js':
    'the balance sim’s own simplified battle model: no run, no blessings, the catalog staff as written',
  'sim/lib/TacticianAgent.js':
    'a sim agent’s target-picking estimate; the heal itself is settled by the harness with staffRunOptions',
};

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'this', 'new', 'typeof']);

/** Blank out comments (keeping offsets and newlines) so prose never counts as a call. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/** The text between the parenthesis at `open` and its match, split at top-level commas. */
function callArguments(text, open) {
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      if (depth === 1) continue;
    } else if (')]}'.includes(ch)) {
      depth--;
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  return args;
}

/** Where `name` (a local or a method) is defined in `text`: the 400 characters from each. */
function definitionsOf(text, name) {
  const escaped = name.replace(/\$/g, '\\$');
  const definition = new RegExp(
    `(?:(?:const|let|var)\\s+${escaped}\\s*=|\\b${escaped}\\s*\\([^)]*\\)\\s*\\{)`,
    'g',
  );
  return [...text.matchAll(definition)].map((m) => text.slice(m.index, m.index + 400));
}

/**
 * Is `name` defined from staffRunOptions in this file, directly or through one more local or
 * method (`const options = this.staffOptions(unit)`, where `staffOptions` returns it)?
 */
function tracesToRunOptions(text, name, depth = 0) {
  for (const body of definitionsOf(text, name)) {
    if (/staffRunOptions\(/.test(body)) return true;
    if (depth >= 1) continue;
    const first = body.split('\n')[0];
    for (const m of first.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g))
      if (m[1] !== name && tracesToRunOptions(text, m[1], depth + 1)) return true;
  }
  return false;
}

function namesRunOptions(text, arg) {
  if (!arg) return false;
  if (/staffRunOptions\(/.test(arg)) return true;
  return [...arg.matchAll(/[A-Za-z_$][\w$]*/g)]
    .map((m) => m[0])
    .filter((id) => !KEYWORDS.has(id))
    .some((id) => tracesToRunOptions(text, id));
}

/** Every call in `source` that counts a staff's uses without the run's options. */
function callsWithoutRunOptions(source) {
  const text = stripComments(source);
  const found = [];
  const at = (index) => text.slice(0, index).split('\n').length;
  const declared = (index) => /\bfunction\s+$/.test(text.slice(Math.max(0, index - 12), index));
  const uses = new RegExp(`\\b(${Object.keys(OPTIONS_ARG_INDEX).join('|')})\\s*\\(`, 'g');
  for (const match of text.matchAll(uses)) {
    if (declared(match.index)) continue;
    const args = callArguments(text, match.index + match[0].length - 1);
    if (!namesRunOptions(text, args[OPTIONS_ARG_INDEX[match[1]]]))
      found.push(`${match[1]} at line ${at(match.index)}`);
  }
  // validateStaffAction({ ... }) must carry `staffOptions:`, settleStaffHeal({ ... }) `healOpts:`,
  // traced to the run.
  for (const [name, property] of Object.entries(OPTIONS_PROPERTY))
    for (const match of text.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      if (declared(match.index)) continue;
      const [object = ''] = callArguments(text, match.index + match[0].length - 1);
      const value = new RegExp(`${property}\\s*:\\s*([^,}]+)`).exec(object)?.[1];
      if (!namesRunOptions(text, value)) found.push(`${name} at line ${at(match.index)}`);
    }
  // The display helpers need the run in their options.
  const helpers = new RegExp(`\\b(${Object.keys(RUN_ARG_INDEX).join('|')})\\s*\\(`, 'g');
  for (const match of text.matchAll(helpers)) {
    if (declared(match.index)) continue;
    const args = callArguments(text, match.index + match[0].length - 1);
    const options = args[RUN_ARG_INDEX[match[1]]] || '';
    const ok =
      /\brun\b/.test(options) ||
      [...options.matchAll(/[A-Za-z_$][\w$]*/g)]
        .filter((m) => !KEYWORDS.has(m[0]))
        .some((m) => definitionsOf(text, m[0]).some((body) => /\brun\b/.test(body)));
    if (!ok) found.push(`${match[1]} at line ${at(match.index)}`);
  }
  return found;
}

const CALLERS = SCANNED.filter((path) =>
  new RegExp(
    `\\b(${[...Object.keys(OPTIONS_ARG_INDEX), ...Object.keys(RUN_ARG_INDEX), ...Object.keys(OPTIONS_PROPERTY)].join('|')})\\s*\\(`,
  ).test(read(path)),
);

describe("a staff's uses come from staffRunOptions", () => {
  it('the scan sees the scene, the harness, the heal and the sheets (it is not blind)', () => {
    const files = CALLERS.map(rel);
    for (const expected of [
      'src/scenes/BattleScene.js',
      'tests/harness/HeadlessBattle.js',
      'src/ui/HealController.js',
      'src/ui/MobileRosterSheet.js',
      'src/ui/RosterOverlay.js',
      'src/ui/RosterTradeController.js',
      'src/ui/UnitDetailOverlay.js',
      'src/ui/MobileBattleHUD.js',
      'src/ui/choiceContent.js',
      'src/ui/ShopMenu.js',
      'src/ui/TradeMenu.js',
      'src/ui/battleItemSummary.js',
      'src/ui/healTargetPreview.js',
      'src/engine/StaffRelocation.js',
    ])
      expect(files, expected).toContain(expected);
  });

  it.each(CALLERS.filter((path) => !ALLOWED[rel(path)]).map((path) => [rel(path), path]))(
    '%s passes the run’s staff options to every count',
    (file, path) => {
      expect(callsWithoutRunOptions(read(path)), file).toEqual([]);
    },
  );

  it('every allowlisted file still holds a call without them (no stale entries)', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(20);
      expect(callsWithoutRunOptions(read(join(ROOT, file))), file).not.toEqual([]);
    }
  });

  describe('the scan itself can fail', () => {
    it('flags the battle menu as it was before Saint’s Reserve', () => {
      const old =
        'const rem = getStaffRemainingUses(preferred, unit);\nconst max = getStaffMaxUses(preferred, unit);';
      expect(callsWithoutRunOptions(old)).toEqual([
        'getStaffRemainingUses at line 1',
        'getStaffMaxUses at line 2',
      ]);
    });
    it('flags the heal, its preview and the reach as they were before Saint’s Reliquary', () => {
      expect(
        callsWithoutRunOptions(
          'const range = getEffectiveStaffRange(staff, unit);\nresolveHeal(staff, unit, ally, { healingMultiplier: 1 });',
        ),
      ).toEqual(['getEffectiveStaffRange at line 1', 'resolveHeal at line 2']);
      expect(
        callsWithoutRunOptions(
          'settleStaffHeal({ staff, healer, targets, healOpts: this.getHealOptions() });',
        ),
      ).toEqual(['settleStaffHeal at line 1']);
      expect(
        callsWithoutRunOptions('findRelocateTargets(staff, unit, units, grid, occupant);'),
      ).toEqual(['findRelocateTargets at line 1']);
    });
    it('flags a heal check and a display helper without the run', () => {
      expect(
        callsWithoutRunOptions('validateStaffAction({ staff, healer, targets, usable });'),
      ).toEqual(['validateStaffAction at line 1']);
      expect(callsWithoutRunOptions('battleItemBrief(item, unit);')).toEqual([
        'battleItemBrief at line 1',
      ]);
      expect(
        callsWithoutRunOptions('const o = { arts };\nequipmentComparison(u, i, w, o);'),
      ).toEqual(['equipmentComparison at line 2']);
    });
    it('accepts the helper inline, through a traced local or method, and a run in the options', () => {
      expect(callsWithoutRunOptions('getStaffMaxUses(s, u, staffRunOptions(run, u));')).toEqual([]);
      expect(
        callsWithoutRunOptions(
          'const o = staffRunOptions(run, u);\ngetStaffRemainingUses(s, u, o);',
        ),
      ).toEqual([]);
      expect(
        callsWithoutRunOptions(
          'staffOptions(unit) {\n return staffRunOptions(this.run, unit);\n}\nvalidateStaffAction({ staff, staffOptions: this.staffOptions(u) });',
        ),
      ).toEqual([]);
      expect(callsWithoutRunOptions('battleItemSummary(i, u, { run: s.runManager });')).toEqual([]);
      expect(callsWithoutRunOptions('export function getStaffMaxUses(staff, healer) {}')).toEqual(
        [],
      );
    });
  });
});
