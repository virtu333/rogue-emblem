// The game is called Rogue Dawn. Every player- and distribution-facing name must agree
// with GAME_TITLE, and the retired display name must not come back. Internal identifiers
// (storage keys, window globals, the iOS bundle id and Android application id, the npm
// package name) keep the old
// "emblem rogue" spelling on purpose, so saves and the App Store record survive.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_TITLE } from '../src/utils/gameIdentity.js';
import { HOW_TO_PLAY_PAGES } from '../src/data/helpContent.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
// The retired display name, in either word order, as words (not as an identifier such as
// emblem_rogue_settings or __emblemRogueGame).
const RETIRED_NAME = /\b(rogue\s+emblem|emblem\s+rogue)\b/i;

function filesUnder(dir, ext) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...filesUnder(path, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

describe('game identity', () => {
  it('is Rogue Dawn', () => {
    expect(GAME_TITLE).toBe('Rogue Dawn');
  });

  it('names the game the same way on every static surface', () => {
    const html = read('index.html');
    expect(html).toContain(`<title>${GAME_TITLE}</title>`);
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${GAME_TITLE}" />`);
    // The auth screen's static lockup mirrors createKeyArtLockup() in TitleScreen.js.
    expect(html).toContain(`<h1 class="re-keyart-title">${GAME_TITLE}</h1>`);

    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.name).toBe(GAME_TITLE);
    expect(manifest.short_name).toBe(GAME_TITLE);

    const capacitor = JSON.parse(read('capacitor.config.json'));
    expect(capacitor.appName).toBe(GAME_TITLE);

    const plist = read('ios/App/App/Info.plist');
    expect(plist).toMatch(
      new RegExp(`<key>CFBundleDisplayName</key>\\s*<string>${GAME_TITLE}</string>`),
    );

    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain(`<string name="app_name">${GAME_TITLE}</string>`);
    expect(strings).toContain(`<string name="title_activity_main">${GAME_TITLE}</string>`);
  });

  // Portrait mode (docs/portrait-battles.md): the iPhone app and the installed web app
  // turn upright with the phone; the iPad app stays in landscape, where its layouts were
  // built (utils/portraitBattle.js isLandscapeLockedShell), and so keeps
  // UIRequiresFullScreen (an iPad app without every orientation must opt out of
  // multitasking). Changing one of these without the others strands a shell.
  it('agrees on orientations across the web manifest and the iOS app', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest.orientation).toBe('any');

    const plist = read('ios/App/App/Info.plist');
    const orientations = (key) => {
      const match = plist.match(
        new RegExp(`<key>${key.replace('~', '\\~')}</key>\\s*<array>([\\s\\S]*?)</array>`),
      );
      expect(match, key).not.toBeNull();
      return [...match[1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]).sort();
    };
    expect(orientations('UISupportedInterfaceOrientations')).toEqual([
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
      'UIInterfaceOrientationPortrait',
    ]);
    expect(orientations('UISupportedInterfaceOrientations~ipad')).toEqual([
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ]);
    expect(plist).toMatch(/<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
    // Upright, an iPhone shows the status bar (landscape hides it); the app hides it so
    // the clock never sits over the game's dark top edge in the system's text colour.
    expect(plist).toMatch(/<key>UIStatusBarHidden<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/);
  });

  // The Android app follows the same rule: no fixed orientation in the manifest (phones
  // turn), tablets (the same 600dp short side as PHONE_MAX_SHORT_SIDE) locked to landscape
  // in MainActivity, and the game category, without which Android 16 ignores that lock on
  // large screens. The bars stay hidden, as the iOS status bar does.
  it('agrees on orientations in the Android app', async () => {
    const { PHONE_MAX_SHORT_SIDE } = await import('../src/utils/portraitBattle.js');
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).not.toMatch(/android:screenOrientation/);
    expect(manifest).toMatch(/android:appCategory="game"/);
    const activity = read('android/app/src/main/java/com/davechen/emblemrogue/MainActivity.java');
    expect(activity).toContain(`TABLET_MIN_SHORT_SIDE_DP = ${PHONE_MAX_SHORT_SIDE};`);
    expect(activity).toMatch(
      /smallestScreenWidthDp >= TABLET_MIN_SHORT_SIDE_DP\)\s*\{\s*setRequestedOrientation\(ActivityInfo\.SCREEN_ORIENTATION_SENSOR_LANDSCAPE\)/,
    );
    expect(activity).toContain('controller.hide(WindowInsetsCompat.Type.systemBars())');
  });

  it('introduces the game by name in How to Play', () => {
    expect(HOW_TO_PLAY_PAGES[0].lines[0].text).toBe(`${GAME_TITLE} is a tactical RPG with`);
  });

  it('keeps the retired name out of shipped code and distribution metadata', () => {
    const shipped = [
      'index.html',
      'public/manifest.webmanifest',
      'capacitor.config.json',
      'ios/App/App/Info.plist',
      'android/app/src/main/res/values/strings.xml',
      'android/app/src/main/AndroidManifest.xml',
      ...filesUnder('src', ['.js', '.css', '.json', '.html']),
      ...filesUnder('data', ['.json']),
    ];
    const offenders = shipped.filter((path) => RETIRED_NAME.test(read(path)));
    expect(offenders.map((p) => relative(root, join(root, p)))).toEqual([]);
  });

  it('distribution copy does not lean on another franchise', () => {
    expect(JSON.parse(read('public/manifest.webmanifest')).description).not.toMatch(/emblem/i);
  });

  it('keeps the internal identifiers that saves and the App Store record depend on', () => {
    // Renaming these would orphan local saves or register a different app.
    expect(JSON.parse(read('capacitor.config.json')).appId).toBe('com.davechen.emblemrogue');
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain(
      'PRODUCT_BUNDLE_IDENTIFIER = com.davechen.emblemrogue;',
    );
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('applicationId "com.davechen.emblemrogue"');
    expect(gradle).toContain('namespace = "com.davechen.emblemrogue"');
    expect(read('src/engine/SlotManager.js')).toContain("'emblem_rogue_slot_'");
    expect(read('src/main.js')).toContain("'__emblemRogueGame'");
  });
});
