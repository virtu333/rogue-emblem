// gameIdentity.js — the game's player-facing name, in one place.
//
// The name shows on the title and auth lockups, the document title and the How to Play
// copy. Static surfaces that cannot import it (index.html, public/manifest.webmanifest,
// capacitor.config.json, ios/App/App/Info.plist) are held to it by
// tests/GameIdentity.test.js.
//
// Internal identifiers keep the original "emblem_rogue" / "emblemRogue" spelling on
// purpose: localStorage and sessionStorage keys, cloud keys, window globals, the iOS
// bundle identifier and the npm package name. Renaming any of them would orphan saves
// or break the App Store record.
export const GAME_TITLE = 'Rogue Dawn';
