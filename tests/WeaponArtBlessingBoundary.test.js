// Where a run's weapon-art blessing state is read (docs/specs/blessings-v3.md §5.2).
//
// The scene, the harness, the roster and unit sheets, the area-art picker and the menus each
// build the options of a weapon-art call. Before Bloodless Art each copied
// `blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0`; a new field (the player's discount,
// the extra use) needs every copy to learn it, and a copy that does not shows a stale cost or a
// stale limit while the engine allows another. `weaponArtRunOptions(run)` is the one read.
//
// Ways this can fail, a test each:
//   1. a call site reads the modifiers by hand again (the field it forgets is silently ignored);
//   2. a screen computes a weapon art's cost, legality or uses without the run's options;
//   3. the scan itself is blind (the pattern matches nothing, or the helper file is not seen).
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

// The run's weapon-art modifier fields, read by hand: `blessingRuntimeModifiers?.weaponArtHpCostDelta`
// or the same through a local (`mods.playerArtHpCostDelta`).
const RAW_READ =
  /blessingRuntimeModifiers\??\.(weaponArtHpCostDelta|playerArtHpCostDelta|playerArtMapUsesBonus)/;
const FIELD_NAMES = /\b(playerArtHpCostDelta|playerArtMapUsesBonus)\b/;

// The only places allowed to name the run's fields: the helper that reads them, and the run that
// owns and saves them.
const OWNERS = new Set(['src/engine/WeaponArtSystem.js', 'src/engine/RunManager.js']);

describe('weapon-art run options come from weaponArtRunOptions', () => {
  it('no source reads the run’s weapon-art blessing fields by hand outside the helper and the run', () => {
    const offenders = SCANNED.filter((path) => !OWNERS.has(rel(path)))
      .filter((path) => RAW_READ.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the player-only fields are named only by the engine pieces that own them', () => {
    // Option names travel through spreads, so they appear by name only where they are read
    // (the cost and limit rules, the display helpers that forward them) or written (the run).
    const allowed = new Set([...OWNERS]);
    const offenders = SCANNED.filter((path) => !allowed.has(rel(path)))
      .filter((path) => FIELD_NAMES.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the helper reads the run exactly once, in WeaponArtSystem', () => {
    const body = read(join(ROOT, 'src/engine/WeaponArtSystem.js'));
    expect(body).toMatch(/export function weaponArtRunOptions\(run\)/);
    expect(body.match(/run\?\.blessingRuntimeModifiers/g)).toHaveLength(1);
  });

  // A screen that asks the engine "can this art be used, what does it cost, how many uses are
  // left" must hand it the run's options, or Bloodless Art shows one answer and the engine
  // allows another. The scan below reads every call (not every file): it finds the call's
  // options argument and requires it to be, or trace back to, `weaponArtRunOptions(...)`.
  const OPTIONS_ARG_INDEX = {
    canUseWeaponArt: 3, // (unit, weapon, art, context)
    applyWeaponArtCost: 2, // (unit, art, opts)
    getEffectiveWeaponArtHpCost: 2, // (unit, art, opts)
    getEffectiveWeaponArtMapLimit: 2, // (unit, art, opts)
    weaponArtCostText: 2, // (unit, art, options)
    weaponArtHpSuffix: 2, // (unit, art, options)
    weaponArtUsesText: 3, // (unit, art, turnNumber, options)
  };

  // Files that may call these without the run's options, each with the reason. A file listed
  // here must still contain such a call (the last test below), so a stale entry fails.
  const ALLOWED = {
    'src/engine/WeaponArtSystem.js':
      'defines the rules: canUseWeaponArt / applyWeaponArtCost forward the caller’s context or opts to the cost and limit functions',
    'src/ui/weaponArtDisplay.js':
      'defines the text helpers: they forward the caller’s `options` argument to the engine',
    'src/engine/EnemyArtScoring.js':
      'enemy AI scoring: enemies have only the foe-side weaponArtHpCostDelta; the player-only fields never apply to them',
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

  /** Does `name` (a local, a method) get defined from weaponArtRunOptions in this file? */
  function tracesToRunOptions(text, name) {
    const escaped = name.replace(/\$/g, '\\$');
    const definition = new RegExp(
      `(?:(?:const|let|var)\\s+${escaped}\\s*=|\\b${escaped}\\s*\\([^)]*\\)\\s*\\{)`,
      'g',
    );
    for (const match of text.matchAll(definition)) {
      if (/weaponArtRunOptions\(/.test(text.slice(match.index, match.index + 600))) return true;
    }
    return false;
  }

  /** Every call in `source` whose options argument neither names nor traces to the run's options. */
  function callsWithoutRunOptions(source) {
    const text = stripComments(source);
    const found = [];
    const calls = new RegExp(`\\b(${Object.keys(OPTIONS_ARG_INDEX).join('|')})\\s*\\(`, 'g');
    for (const match of text.matchAll(calls)) {
      const name = match[1];
      if (/\bfunction\s+$/.test(text.slice(Math.max(0, match.index - 12), match.index))) continue;
      const args = callArguments(text, match.index + match[0].length - 1);
      const options = args[OPTIONS_ARG_INDEX[name]];
      let ok = false;
      if (options) {
        ok =
          /weaponArtRunOptions\(/.test(options) ||
          [...options.matchAll(/[A-Za-z_$][\w$]*/g)]
            .map((m) => m[0])
            .filter((id) => !KEYWORDS.has(id))
            .some((id) => tracesToRunOptions(text, id));
      }
      if (!ok) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${name} at line ${line}`);
      }
    }
    return found;
  }

  const CALLERS = SCANNED.filter((path) =>
    new RegExp(`\\b(${Object.keys(OPTIONS_ARG_INDEX).join('|')})\\s*\\(`).test(read(path)),
  );

  it('the scan sees the scene, the harness and the menus (it is not blind)', () => {
    const files = CALLERS.map(rel);
    for (const expected of [
      'src/scenes/BattleScene.js',
      'tests/harness/HeadlessBattle.js',
      'src/ui/WeaponArtController.js',
      'src/ui/AreaTargetingController.js',
      'src/ui/MobileRosterSheet.js',
      'src/ui/RosterOverlay.js',
      'src/ui/UnitDetailOverlay.js',
      'src/ui/MobileBattleHUD.js',
    ]) {
      expect(files, expected).toContain(expected);
    }
  });

  it.each(CALLERS.filter((path) => !ALLOWED[rel(path)]).map((path) => [rel(path), path]))(
    '%s passes the run’s options to every weapon-art call',
    (file, path) => {
      expect(
        callsWithoutRunOptions(read(path)),
        `${file} calls without weaponArtRunOptions`,
      ).toEqual([]);
    },
  );

  it('every allowlisted file still holds a call without run options (no stale entries)', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(20);
      expect(callsWithoutRunOptions(read(join(ROOT, file))), file).not.toEqual([]);
    }
  });

  describe('the scan itself can fail', () => {
    it('flags the roster’s bind-art description that showed the base HP cost', () => {
      const old = 'return `${art.name} · ${weaponArtCostText(unit, art)} · ${art.requiredRank}`;';
      expect(callsWithoutRunOptions(old)).toEqual(['weaponArtCostText at line 1']);
    });
    it('flags an options object that is not the run’s and a missing context', () => {
      expect(
        callsWithoutRunOptions('getEffectiveWeaponArtHpCost(unit, art, { weaponArtHpCostDelta });'),
      ).toHaveLength(1);
      expect(callsWithoutRunOptions('canUseWeaponArt(unit, weapon, art);')).toHaveLength(1);
      expect(
        callsWithoutRunOptions(
          'canUseWeaponArt(unit, weapon, art, { turnNumber: 2, isInitiating: true });',
        ),
      ).toHaveLength(1);
      expect(callsWithoutRunOptions('weaponArtUsesText(unit, art, turn);')).toHaveLength(1);
    });
    it('flags a variable that was not built from the run’s options', () => {
      const src = 'const opts = { marksData };\nconst c = weaponArtCostText(unit, art, opts);';
      expect(callsWithoutRunOptions(src)).toEqual(['weaponArtCostText at line 2']);
    });
    it('accepts the helper inline, spread into a context, or through a traced local or method', () => {
      expect(
        callsWithoutRunOptions('weaponArtCostText(unit, art, weaponArtRunOptions(this.run));'),
      ).toEqual([]);
      expect(
        callsWithoutRunOptions(
          'canUseWeaponArt(u, w, a, { turnNumber, ...weaponArtRunOptions(run), marksData });',
        ),
      ).toEqual([]);
      expect(
        callsWithoutRunOptions(
          'const costOptions = { ...weaponArtRunOptions(run) };\napplyWeaponArtCost(u, a, costOptions);',
        ),
      ).toEqual([]);
      expect(
        callsWithoutRunOptions(
          '_costOptions() {\n return { ...weaponArtRunOptions(run) };\n}\ngetEffectiveWeaponArtHpCost(u, a, this._costOptions());',
        ),
      ).toEqual([]);
    });
    it('ignores declarations and comments', () => {
      expect(
        callsWithoutRunOptions('export function canUseWeaponArt(unit, weapon, art) {}'),
      ).toEqual([]);
      expect(callsWithoutRunOptions('// canUseWeaponArt(unit, weapon, art)\n')).toEqual([]);
      expect(callsWithoutRunOptions('/* weaponArtCostText(unit, art) */')).toEqual([]);
    });
  });

  it('the pattern catches the old raw read (the scan can fail)', () => {
    expect(
      RAW_READ.test(
        'weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0',
      ),
    ).toBe(true);
    expect(RAW_READ.test('const x = weaponArtRunOptions(scene.runManager);')).toBe(false);
  });
});
