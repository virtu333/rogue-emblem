import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_ASSETS, audioAssetUrl, verifyAudioBytes } from '../src/utils/audioAssets.js';
import {
  audioManifest,
  buildAudioAssets,
  checkPackagedAudio,
  validateAudioCatalog,
} from '../tools/buildAudioAssets.mjs';

const bytesOf = (file) => {
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe('audio recording identity', () => {
  it('accepts the shipped bytes and rejects a different recording of identical length', () => {
    const key = 'music_battle_act1_2';
    const bytes = bytesOf(new URL('../assets/audio/music/' + key + '.mp3', import.meta.url));
    expect(verifyAudioBytes(key, bytes)).toBe(bytes);
    const otherRecording = bytes.slice(0);
    new Uint8Array(otherRecording)[100] ^= 1;
    expect(() => verifyAudioBytes(key, otherRecording)).toThrow('audio-integrity-failed');
    expect(audioAssetUrl(key)).toContain(AUDIO_ASSETS[key].sha256);
  });

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
});
