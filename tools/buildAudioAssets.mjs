// Package the final audio bytes under immutable names. iOS passes its compact
// music directory before Vite bundles the manifest; originals stay untouched.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MUSIC_LOOPS } from '../src/utils/musicLoops.js';
import { MUSIC, MUSIC_LAYERS, ENTITY_FINALE } from '../src/utils/musicConfig.js';
import { MUSIC_STINGERS } from '../src/utils/musicStingers.js';
import { ESSENTIAL_SFX, COMBAT_SFX } from '../src/utils/sfxConfig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const timelineOwner = new Map(Object.keys(MUSIC_LOOPS).map((key) => [key, key]));
for (const [primary, layers] of Object.entries(MUSIC_LAYERS)) {
  for (const layer of Object.values(layers)) timelineOwner.set(layer, primary);
}
for (const key of Object.keys(MUSIC_LOOPS).filter((k) => k.includes('_enrage_'))) {
  timelineOwner.set(key, key.split('_enrage_')[0]);
}
timelineOwner.set(ENTITY_FINALE.hum, ENTITY_FINALE.track);

export function validateAudioCatalog(entries) {
  const requireKey = (key) => {
    if (!entries[key]) throw new Error(`Missing referenced audio: ${key}`);
  };
  const collect = (value) => {
    if (typeof value === 'string') requireKey(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(MUSIC);
  for (const key of [...ESSENTIAL_SFX, ...COMBAT_SFX]) requireKey(key);
  for (const key of Object.keys(MUSIC_LOOPS)) {
    requireKey(key);
    const loop = MUSIC_LOOPS[key];
    if (!(loop.loopStart >= 0 && loop.loopEnd > loop.loopStart && loop.duration >= loop.loopEnd))
      throw new Error(`Invalid declared loop: ${key}`);
  }
  const group = (primary, layer) => {
    requireKey(primary);
    requireKey(layer);
    if (!entries[primary].timeline || entries[primary].timeline !== entries[layer].timeline)
      throw new Error(`Inconsistent audio timeline: ${primary}/${layer}`);
  };
  for (const [primary, layers] of Object.entries(MUSIC_LAYERS)) {
    for (const layer of Object.values(layers)) group(primary, layer);
  }
  for (const key of Object.keys(MUSIC_LOOPS).filter((k) => k.includes('_enrage_')))
    group(key.split('_enrage_')[0], key);
  group(ENTITY_FINALE.track, ENTITY_FINALE.hum);
  for (const [name, entry] of Object.entries(MUSIC_STINGERS)) {
    for (const key of entry.keyed
      ? entry.tonics.map((t) => `stinger_${name}_${t}`)
      : [`stinger_${name}`])
      requireKey(key);
  }
}

export function audioManifest({ root = ROOT, musicDir = process.env.ER_MUSIC_ASSET_DIR } = {}) {
  const entries = {};
  const files = [];
  for (const category of ['music', 'sfx', 'stingers']) {
    const original = join(root, 'assets/audio', category);
    const directory = category === 'music' && musicDir ? resolve(musicDir) : original;
    const names = readdirSync(original)
      .filter((n) => n.endsWith('.mp3'))
      .sort();
    if (
      names.join('\n') !==
      readdirSync(directory)
        .filter((n) => n.endsWith('.mp3'))
        .sort()
        .join('\n')
    ) {
      throw new Error('Compact music must contain exactly the original logical track set');
    }
    for (const name of names) {
      const source = join(directory, name);
      const sha256 = digest(readFileSync(source));
      const key = name.slice(0, -4);
      const url = `assets/audio/versioned/${category}/${key}-${sha256}.mp3`;
      const loop = MUSIC_LOOPS[key];
      // Geometry is a declaration, identity is the individual byte hash. A
      // timeline id never substitutes for checking the recording's hash.
      if (entries[key]) throw new Error(`Duplicate audio key: ${key}`);
      entries[key] = {
        url,
        sha256,
        ...(loop
          ? {
              timeline: digest(
                JSON.stringify([
                  timelineOwner.get(key),
                  loop.loopStart,
                  loop.loopEnd,
                  loop.duration,
                  loop.tonic,
                ]),
              ),
            }
          : {}),
      };
      files.push({ source, url });
    }
  }
  if (root === ROOT) validateAudioCatalog(entries);
  const revision = digest(JSON.stringify(entries));
  return { manifest: { revision, entries }, files };
}

export function buildAudioAssets({ root = ROOT, musicDir, check = false } = {}) {
  const { manifest, files } = audioManifest({ root, musicDir });
  const output = join(root, 'src/utils/AudioAssetManifest.json');
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (check) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== json)
      throw new Error('Audio manifest is stale; run npm run build:audio');
    return manifest;
  }
  writeFileSync(output, json);
  const retained = new Set(files.map(({ url }) => join(root, 'public', url)));
  for (const { source, url } of files) {
    const target = join(root, 'public', url);
    mkdirSync(dirname(target), { recursive: true });
    if (
      !existsSync(target) ||
      digest(readFileSync(target)) !== manifest.entries[basename(source, '.mp3')].sha256
    )
      copyFileSync(source, target);
  }
  // Local staging holds only this generation. Server retention of older
  // releases is a deployment concern, not permission to alias old URLs.
  for (const category of ['music', 'sfx', 'stingers']) {
    const directory = join(root, 'public/assets/audio/versioned', category);
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (!retained.has(path)) rmSync(path);
    }
  }
  return manifest;
}

export function checkPackagedAudio({
  root = ROOT,
  dist = join(root, 'dist'),
  pruneLegacy = false,
} = {}) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'src/utils/AudioAssetManifest.json'), 'utf8'),
  );
  for (const [key, entry] of Object.entries(manifest.entries)) {
    if (digest(readFileSync(join(dist, entry.url))) !== entry.sha256)
      throw new Error(`Packaged audio digest mismatch: ${key}`);
  }
  if (pruneLegacy) {
    for (const category of ['music', 'sfx', 'stingers'])
      rmSync(join(dist, 'assets/audio', category), { recursive: true, force: true });
  }
  return Object.keys(manifest.entries).length;
}

export function isMainModule(url, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--packaged'))
    console.log(
      `Verified ${checkPackagedAudio({ pruneLegacy: process.env.ER_PRUNE_LEGACY_AUDIO === '1' })} packaged audio files`,
    );
  else
    console.log(
      `Audio manifest: ${Object.keys(buildAudioAssets({ musicDir: process.env.ER_MUSIC_ASSET_DIR, check: process.argv.includes('--check') }).entries).length} files`,
    );
}
