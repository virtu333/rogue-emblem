// Audio device faults: the browser's audio engine refusing to start or resume
// (iOS WebKit's "InvalidStateError: Failed to start the audio device" after an
// interruption, an output change or a backgrounding). They cost sound, never the
// game, so the runtime error handler lets them pass and audio recovery tries again
// on the next gesture or return to the foreground. Diagnostics stay on the device.

const DEVICE_MESSAGE = /failed to (start|resume|suspend|stop|close) the audio device/i;
const AUDIO_SUBJECT = /audio ?context|audio device|audio session|audio hardware/i;
const DOM_AUDIO_NAMES = new Set([
  'InvalidStateError',
  'NotAllowedError',
  'NotSupportedError',
  'AbortError',
  'UnknownError',
]);

export const AUDIO_FAULTS_KEY = '__emblemRogueAudioFaults';
const MAX_FAULTS = 20;

function faultParts(reason) {
  if (reason == null) return { name: '', message: '' };
  if (typeof reason === 'string') return { name: '', message: reason };
  let name = '';
  let message = '';
  try {
    name = typeof reason.name === 'string' ? reason.name : '';
    message = typeof reason.message === 'string' ? reason.message : '';
  } catch (_) {
    /* a hostile getter is not an audio fault */
  }
  return { name, message };
}

/**
 * True for a failure of the audio engine itself: the WebKit device message
 * whatever its name, or a DOMException of a known kind that names the audio
 * context, device or session. A game error that merely mentions "context" is not one.
 */
export function isAudioDeviceFault(reason) {
  const { name, message } = faultParts(reason);
  if (DEVICE_MESSAGE.test(message)) return true;
  return DOM_AUDIO_NAMES.has(name) && AUDIO_SUBJECT.test(message);
}

/**
 * Keep a short local record of an audio fault (no network): what failed, the
 * context's state, the page's visibility, the iOS audio session and the scene,
 * and the recent resume attempts. Read it from `window.__emblemRogueAudioFaults`.
 */
export function recordAudioFault(reason, { source = 'unknown', sceneKey = null, env } = {}) {
  const host = env || globalThis;
  const { name, message } = faultParts(reason);
  const context = host?.__emblemRogueSharedAudioContext || null;
  let audioSessionType = null;
  try {
    audioSessionType = host?.navigator?.audioSession?.type ?? null;
  } catch (_) {
    audioSessionType = null;
  }
  const entry = {
    at: Date.now(),
    source,
    name: name || null,
    message: message || null,
    contextState: context?.state ?? null,
    visibility: host?.document?.visibilityState ?? null,
    audioSessionType,
    sceneKey,
    attempts: context?.__audioResumeGate?.recentAttempts?.() ?? [],
  };
  const list = Array.isArray(host[AUDIO_FAULTS_KEY]) ? host[AUDIO_FAULTS_KEY] : [];
  list.push(entry);
  if (list.length > MAX_FAULTS) list.splice(0, list.length - MAX_FAULTS);
  host[AUDIO_FAULTS_KEY] = list;
  return entry;
}
