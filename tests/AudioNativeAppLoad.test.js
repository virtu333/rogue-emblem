// The iOS app serves its bundle from capacitor://localhost, and Capacitor's
// WebViewAssetHandler answers media files (mp3) with a bare, non-HTTP response:
// the request completes with status 0, so fetch never reports it `ok`. Music and
// cues must still load there (through XHR, as Phaser's loader does), and their
// bytes must still pass the recording check.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/utils/AudioManager.js';
import {
  AUDIO_ASSETS,
  audioAssetUrl,
  fetchAudioBytes,
  isLocalAssetUrl,
} from '../src/utils/audioAssets.js';

const APP_PAGE = 'capacitor://localhost/index.html';

const bytesOf = (path) => {
  const b = readFileSync(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

/** WKWebView answering a Capacitor media response: status 0, bytes intact. */
function stubAppWebView(bytesFor) {
  const requested = [];
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }
    addEventListener() {}
    abort() {
      this.onabort?.();
    }
    send() {
      requested.push(this.url);
      setTimeout(() => {
        this.status = 0;
        this.response = this.responseType === 'arraybuffer' ? bytesFor(this.url) : null;
        this.onload?.();
      }, 0);
    }
  }
  const fetch = vi.fn(async (url) => ({
    ok: false,
    status: 0,
    arrayBuffer: async () => bytesFor(url),
  }));
  vi.stubGlobal('location', { href: APP_PAGE, protocol: 'capacitor:' });
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  vi.stubGlobal('fetch', fetch);
  return { requested, fetch };
}

function makeSoundManager() {
  const loaded = new Map();
  const sounds = [];
  return {
    locked: false,
    sounds,
    context: {
      decodeAudioData: vi.fn((bytes, onSuccess) => onSuccess({ decoded: bytes.byteLength })),
    },
    get: vi.fn((key) => sounds.find((s) => s.key === key) || null),
    add: vi.fn((key, opts) => {
      const s = {
        key,
        loop: Boolean(opts?.loop),
        volume: opts?.volume ?? 1,
        isPlaying: false,
        play: vi.fn(() => {
          s.isPlaying = true;
        }),
        stop: vi.fn(() => {
          s.isPlaying = false;
        }),
        destroy: vi.fn(),
        setVolume: vi.fn(),
      };
      sounds.push(s);
      return s;
    }),
    play: vi.fn(),
    once: vi.fn(),
    game: {
      cache: {
        audio: {
          has: (key) => loaded.has(key),
          get: (key) => loaded.get(key),
          add: vi.fn((key, value) => loaded.set(key, value)),
          remove: (key) => loaded.delete(key),
        },
      },
    },
  };
}

const musicFile = (url) =>
  bytesOf('../assets/audio/music/' + /([^/]+)-[a-f0-9]{64}\.mp3$/.exec(url)[1] + '.mp3');

describe('audio in the iOS app (capacitor://)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plays music whose response reports status 0', async () => {
    const { requested } = stubAppWebView(musicFile);
    const sound = makeSoundManager();
    const audio = new AudioManager(sound);

    await audio.playMusic('music_title', null, 0);

    expect(requested).toEqual([audioAssetUrl('music_title')]);
    expect(audio.currentMusicKey).toBe('music_title');
    expect(sound.add).toHaveBeenCalledWith('music_title', expect.objectContaining({ loop: true }));
    expect(audio.getAudioDiagnostics().events.map((e) => e.type)).toContain('loaded');
  });

  it('still rejects a different recording served the same way', async () => {
    stubAppWebView((url) => {
      const bytes = musicFile(url);
      new Uint8Array(bytes)[100] ^= 1;
      return bytes;
    });
    const sound = makeSoundManager();
    const audio = new AudioManager(sound);

    await audio.playMusic('music_title', null, 0);

    expect(audio.currentMusicKey).toBe(null);
    expect(sound.add).not.toHaveBeenCalled();
    expect(audio.getAudioDiagnostics().events).toContainEqual(
      expect.objectContaining({
        type: 'asset-rejected',
        key: 'music_title',
        reason: 'audio-integrity-failed:music_title',
      }),
    );
  });

  it('loads a ceremony cue whose response reports status 0', async () => {
    const key = Object.keys(AUDIO_ASSETS).find((k) => k.startsWith('stinger_'));
    const file = bytesOf(`../assets/audio/stingers/${key}.mp3`);
    const { requested } = stubAppWebView(() => file);
    const audio = new AudioManager(makeSoundManager());

    await expect(audio._fetchStingerBytes(key)).resolves.toBe(file);
    expect(requested).toEqual([audioAssetUrl(key)]);
  });

  it('gives up on an empty response and on an abort', async () => {
    stubAppWebView(() => new ArrayBuffer(0));
    await expect(fetchAudioBytes('assets/audio/x.mp3')).rejects.toThrow('http-error');
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchAudioBytes('assets/audio/x.mp3', { signal: controller.signal }),
    ).rejects.toThrow('aborted');
  });
});

describe('audio on the web', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the app bundle from web origins', () => {
    expect(isLocalAssetUrl('assets/a.mp3', APP_PAGE)).toBe(true);
    expect(isLocalAssetUrl('capacitor://localhost/assets/a.mp3', undefined)).toBe(true);
    expect(isLocalAssetUrl('assets/a.mp3', 'file:///app/index.html')).toBe(true);
    expect(isLocalAssetUrl('assets/a.mp3', 'https://emblem-rogue.netlify.app/')).toBe(false);
    expect(isLocalAssetUrl('assets/a.mp3', undefined)).toBe(false);
  });

  it('keeps fetch, and an HTTP failure stays a failure', async () => {
    vi.stubGlobal('location', { href: 'https://emblem-rogue.netlify.app/', protocol: 'https:' });
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          throw new Error('web audio must not use XHR');
        }
      },
    );
    const bytes = new ArrayBuffer(8);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url.endsWith('ok.mp3')
          ? { ok: true, status: 200, arrayBuffer: async () => bytes }
          : { ok: false, status: url.endsWith('opaque.mp3') ? 0 : 404 },
      ),
    );
    await expect(fetchAudioBytes('assets/ok.mp3')).resolves.toBe(bytes);
    await expect(fetchAudioBytes('assets/missing.mp3')).rejects.toThrow('http-404');
    await expect(fetchAudioBytes('assets/opaque.mp3')).rejects.toThrow('http-error');
  });
});
