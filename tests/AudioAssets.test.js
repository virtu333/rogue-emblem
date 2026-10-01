import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDIO_ASSETS, audioAssetUrl, verifyAudioBytes } from '../src/utils/audioAssets.js';
import {
  audioManifest,
  buildAudioAssets,
  checkPackagedAudio,
  validateAudioCatalog,
  isMainModule,
} from '../tools/buildAudioAssets.mjs';

const bytesOf = (file) => {
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe('audio recording identity', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['native', 'fallback', 'unavailable-native'])(
    'accepts shipped bytes and rejects same-length corruption using %s SHA-256',
    async (mode) => {
      const digest = vi.fn(webcrypto.subtle.digest.bind(webcrypto.subtle));
      if (mode === 'unavailable-native') digest.mockRejectedValue(new Error('unsupported origin'));
      vi.stubGlobal('crypto', mode === 'fallback' ? undefined : { subtle: { digest } });
      const key = 'music_battle_act1_2';
      const bytes = bytesOf(new URL('../assets/audio/music/' + key + '.mp3', import.meta.url));
      await expect(verifyAudioBytes(key, bytes)).resolves.toBe(bytes);
      const otherRecording = bytes.slice(0);
      new Uint8Array(otherRecording)[100] ^= 1;
      await expect(verifyAudioBytes(key, otherRecording)).rejects.toThrow('audio-integrity-failed');
      expect(audioAssetUrl(key)).toContain(AUDIO_ASSETS[key].sha256);
      expect(digest).toHaveBeenCalledTimes(mode === 'fallback' ? 0 : 2);
    },
  );

  it('fails packaging for missing adaptive layers and inconsistent finale timelines', () => {
    expect(() => validateAudioCatalog(AUDIO_ASSETS)).not.toThrow();
    const missing = { ...AUDIO_ASSETS };
    delete missing.music_battle_act1_calm;
    expect(() => validateAudioCatalog(missing)).toThrow('Missing referenced audio');
    const mismatched = {
      ...AUDIO_ASSETS,
      music_boss_entity_finale_hum: {
        ...AUDIO_ASSETS.music_boss_entity_finale_hum,
        timeline: 'wrong',
      },
    };
    expect(() => validateAudioCatalog(mismatched)).toThrow('Inconsistent audio timeline');
  });
});

describe('final-byte audio packaging', () => {
  function fixture(run) {
    const root = mkdtempSync(join(tmpdir(), 'er-audio-'));
    for (const name of ['music', 'sfx', 'stingers'])
      mkdirSync(join(root, 'assets/audio', name), { recursive: true });
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    writeFileSync(join(root, 'assets/audio/music/music_test.mp3'), 'desktop bytes');
    // Each directory has a file, as in the shipping catalog.
    writeFileSync(join(root, 'assets/audio/sfx/sfx_test.mp3'), 'sfx');
    writeFileSync(join(root, 'assets/audio/stingers/stinger_test.mp3'), 'cue');
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('changed bytes get a new physical path, and packaged corruption fails verification', () =>
    fixture((root) => {
      const a = buildAudioAssets({ root });
      writeFileSync(join(root, 'assets/audio/music/music_test.mp3'), 'another tune!');
      const b = buildAudioAssets({ root });
      expect(b.entries.music_test.url).not.toBe(a.entries.music_test.url);
      const dist = join(root, 'public');
      expect(checkPackagedAudio({ root, dist })).toBe(3);
      writeFileSync(join(dist, b.entries.music_test.url), 'bad response!');
      expect(() => checkPackagedAudio({ root, dist })).toThrow('digest mismatch');
    }));

  it('hashes compact music before bundling and preserves the desktop source', () =>
    fixture((root) => {
      const compact = join(root, 'compact');
      mkdirSync(compact);
      writeFileSync(join(compact, 'music_test.mp3'), 'compact bytes');
      const desktop = audioManifest({ root }).manifest;
      const ios = buildAudioAssets({ root, musicDir: compact });
      expect(ios.entries.music_test.url).not.toBe(desktop.entries.music_test.url);
      expect(readFileSync(join(root, 'public', ios.entries.music_test.url), 'utf8')).toBe(
        'compact bytes',
      );
      expect(readFileSync(join(root, 'assets/audio/music/music_test.mp3'), 'utf8')).toBe(
        'desktop bytes',
      );
      expect(checkPackagedAudio({ root, dist: join(root, 'public') })).toBe(3);
      copyFileSync(join(compact, 'music_test.mp3'), join(compact, 'unexpected.mp3'));
      expect(() => buildAudioAssets({ root, musicDir: compact })).toThrow(
        'exactly the original logical track set',
      );
    }));

  it('retains legacy web URLs by default and removes them only for an explicit app package', () =>
    fixture((root) => {
      buildAudioAssets({ root });
      const dist = join(root, 'public');
      const legacy = join(dist, 'assets/audio/music/music_test.mp3');
      mkdirSync(join(dist, 'assets/audio/music'), { recursive: true });
      copyFileSync(join(root, 'assets/audio/music/music_test.mp3'), legacy);
      expect(checkPackagedAudio({ root, dist })).toBe(3);
      expect(existsSync(legacy)).toBe(true);
      expect(checkPackagedAudio({ root, dist, pruneLegacy: true })).toBe(3);
      expect(existsSync(legacy)).toBe(false);
    }));

  it('recognizes a symlinked CLI entry with spaces and treats a missing entry as an import', () =>
    fixture((root) => {
      const target = join(root, 'script with spaces.mjs');
      const alias = join(root, 'alias.mjs');
      writeFileSync(target, '');
      symlinkSync(target, alias);
      expect(isMainModule(pathToFileURL(target).href, alias)).toBe(true);
      expect(isMainModule(pathToFileURL(target).href, join(root, 'missing.mjs'))).toBe(false);
    }));
});
