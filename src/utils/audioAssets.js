import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import manifest from './AudioAssetManifest.json' with { type: 'json' };

// One manifest is bundled with each app. SHA-256 works in WebViews without
// crypto.subtle as well as browsers; verification never depends on a URL alone.
export const AUDIO_REVISION = manifest.revision;
export const AUDIO_ASSETS = manifest.entries;
const bufferRevisions = new WeakMap();

export function audioAsset(key) {
  const entry = AUDIO_ASSETS[key];
  if (!entry) throw new Error(`unknown-audio-asset:${key}`);
  return entry;
}

export function audioAssetUrl(key) {
  return audioAsset(key).url;
}

// Schemes an app serves its own bundle from (Phaser's LoaderPlugin.localSchemes).
// The iOS app's handler (Capacitor's WebViewAssetHandler) answers media files
// with a bare, non-HTTP response, so a request for an mp3 there completes with
// status 0 and fetch never reports it `ok`. Those load through XHR, the way
// Phaser's loader does, which takes status 0 from a local scheme as success.
const LOCAL_SCHEMES = ['capacitor:', 'file:'];

export function isLocalAssetUrl(url, base = globalThis.location?.href) {
  try {
    return LOCAL_SCHEMES.includes(new URL(url, base).protocol);
  } catch {
    return false;
  }
}

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function xhrAudioBytes(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const settle = (fn, value) => {
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
      if (ok && xhr.response instanceof ArrayBuffer && xhr.response.byteLength > 0)
        settle(resolve, xhr.response);
      else settle(reject, new Error(`http-${xhr.status || 'error'}`));
    };
    xhr.onerror = () => settle(reject, new Error('http-error'));
    xhr.onabort = () => settle(reject, abortError());
    signal?.addEventListener?.('abort', onAbort);
    xhr.send();
  });
}

/**
 * The file's bytes, unverified: callers pass them through verifyAudioBytes
 * whichever transport carried them.
 */
export async function fetchAudioBytes(url, { signal } = {}) {
  if (isLocalAssetUrl(url) && typeof XMLHttpRequest === 'function')
    return xhrAudioBytes(url, signal);
  if (typeof fetch !== 'function') throw new Error('no-fetch');
  const response = await fetch(url, { signal });
  if (!response?.ok) throw new Error(`http-${response?.status || 'error'}`);
  return response.arrayBuffer();
}

export async function verifyAudioBytes(key, bytes) {
  if (!(bytes instanceof ArrayBuffer)) throw new Error(`invalid-audio-bytes:${key}`);
  let hash;
  try {
    if (globalThis.crypto?.subtle)
      hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  } catch {
    // Some WebViews expose subtle but cannot use it in their origin/context.
  }
  if (!hash) hash = sha256(new Uint8Array(bytes));
  if (bytesToHex(hash) !== audioAsset(key).sha256) {
    throw new Error(`audio-integrity-failed:${key}`);
  }
  return bytes;
}

// Called only after a verified decode (or the versioned Phaser loader). Shared
// across manager recreation so buffers remain valid during a same-build reboot.
export function rememberAudioBuffer(key, buffer) {
  if (buffer && typeof buffer === 'object') bufferRevisions.set(buffer, audioAsset(key).sha256);
  return buffer;
}

export function audioBufferMatches(key, buffer) {
  return Boolean(buffer && bufferRevisions.get(buffer) === audioAsset(key).sha256);
}

export function shareAudioTimeline(primary, secondary) {
  const a = audioAsset(primary);
  const b = audioAsset(secondary);
  return Boolean(a.timeline && a.timeline === b.timeline);
}
