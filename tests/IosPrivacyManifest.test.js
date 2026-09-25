// App Store Connect requires an app privacy manifest declaring the required-reason APIs
// its native dependencies use. @capacitor/filesystem (the native save mirror) reads file
// metadata, so the app must declare NSPrivacyAccessedAPICategoryFileTimestamp with C617.1
// and ship the manifest inside App.app (a Resources member of the App target).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const MANIFEST = 'ios/App/App/PrivacyInfo.xcprivacy';

// The declared API types with their reasons, from the plist XML.
function accessedApiTypes(xml) {
  const section =
    /<key>NSPrivacyAccessedAPITypes<\/key>\s*<array>([\s\S]*?)<\/array>\s*<\/dict>\s*<\/plist>/.exec(
      xml,
    );
  if (!section) return {};
  const types = {};
  const entry =
    /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/g;
  for (const match of section[1].matchAll(entry)) {
    types[match[1]] = [...match[2].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  }
  return types;
}

describe('iOS privacy manifest', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  it('declares file timestamp access (C617.1) while the Filesystem plugin ships', () => {
    expect(deps['@capacitor/filesystem']).toBeTruthy();
    const xml = read(MANIFEST);
    expect(xml).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(accessedApiTypes(xml)).toEqual({
      NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1'],
    });
  });

  it('is copied into App.app by the App target', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    const ref =
      /(\w{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;[^}]*path = PrivacyInfo\.xcprivacy;/.exec(
        pbx,
      );
    expect(ref).toBeTruthy();
    const build = new RegExp(
      `(\\w{24}) /\\* PrivacyInfo\\.xcprivacy in Resources \\*/ = \\{isa = PBXBuildFile; fileRef = ${ref[1]} `,
    ).exec(pbx);
    expect(build).toBeTruthy();
    const resources = /isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/.exec(pbx);
    expect(resources[1]).toContain(`${build[1]} /* PrivacyInfo.xcprivacy in Resources */`);
    // Listed in the App group, whose path is App/ (so the file resolves to App/PrivacyInfo.xcprivacy).
    const group =
      /\/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \(([\s\S]*?)\);\s*path = App;/.exec(pbx);
    expect(group[1]).toContain(`${ref[1]} /* PrivacyInfo.xcprivacy */`);
  });
});
