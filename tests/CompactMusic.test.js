// tools/ios/compactMusic.mjs: the iOS app's lighter music keeps every track's timeline,
// and the TestFlight workflow puts it into the app (and only the app).
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactMusic, decodedSamples, musicFiles } from '../tools/ios/compactMusic.mjs';

const ROOT = join(import.meta.dirname, '..');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('iOS music', () => {
  it.skipIf(!hasFfmpeg)('re-encodes a track smaller, sample for sample the same length', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compact-music-'));
    try {
      const inDir = join(dir, 'in');
      const outDir = join(dir, 'out');
      mkdirSync(inDir, { recursive: true });
      // 12 s of stereo pink noise, encoded like the build encodes (LAME V4)
      const made = spawnSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=d=12:c=pink:a=0.2',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        join(inDir, 'music_test.mp3'),
      ]);
      expect(made.status).toBe(0);
      const r = compactMusic({ inDir, outDir });
      expect(r.files).toBe(1);
      expect(musicFiles(outDir)).toEqual(['music_test.mp3']);
      expect(r.after).toBeLessThan(r.before);
      expect(decodedSamples(join(outDir, 'music_test.mp3'))).toBe(
        decodedSamples(join(inDir, 'music_test.mp3')),
      );
      expect(statSync(join(outDir, 'music_test.mp3')).size).toBe(r.after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the TestFlight workflow builds the app with it, after the web build', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'testflight.yml'), 'utf8');
    expect(wf).toContain('node tools/ios/compactMusic.mjs --in assets/audio/music');
    expect(wf).toMatch(/needs: \[ci-passed, ios-music\]/);
    const build = wf.indexOf('npm run build');
    const copy = wf.indexOf('cp "$RUNNER_TEMP"/ios-music/*.mp3');
    const sync = wf.indexOf('npx cap sync ios');
    expect(build).toBeGreaterThan(0);
    expect(copy).toBeGreaterThan(build);
    expect(sync).toBeGreaterThan(copy);
  });
});
