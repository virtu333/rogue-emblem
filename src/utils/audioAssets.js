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
