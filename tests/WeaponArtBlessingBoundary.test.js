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
  // allows another.
  const ENGINE_CALLS =
    /\b(canUseWeaponArt|applyWeaponArtCost|getEffectiveWeaponArtHpCost|weaponArtCostText|weaponArtUsesText)\(/;
  const CALLERS_OUTSIDE_THE_ENGINE = SCANNED.filter((path) => {
    const file = rel(path);
    if (file.startsWith('src/engine/')) return false;
    if (file === 'src/ui/weaponArtDisplay.js') return false; // defines the text helpers
    return ENGINE_CALLS.test(read(path));
  });

  it('the scan sees the scene, the harness and the menus (it is not blind)', () => {
    const files = CALLERS_OUTSIDE_THE_ENGINE.map(rel);
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

  it.each(CALLERS_OUTSIDE_THE_ENGINE.map((path) => [rel(path), path]))(
    '%s passes the run’s options to every weapon-art call',
    (file, path) => {
      expect(read(path), `${file} must use weaponArtRunOptions`).toMatch(/weaponArtRunOptions\(/);
    },
  );

  it('the pattern catches the old raw read (the scan can fail)', () => {
    expect(
      RAW_READ.test(
        'weaponArtHpCostDelta: scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0',
      ),
    ).toBe(true);
    expect(RAW_READ.test('const x = weaponArtRunOptions(scene.runManager);')).toBe(false);
  });
});
