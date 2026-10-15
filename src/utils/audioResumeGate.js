// One AudioContext.resume() at a time. Every caller (Phaser's unlock, focus and
// visibility handlers, AudioManager, foreground recovery, the boot unlock) calls
// the shared context's resume(), so the gate replaces that method on the instance:
// - a call while a resume is in flight gets that same promise (one tap sends
//   pointerdown and touchend; a return to the foreground sends focus, pageshow and
//   visibilitychange). A gesture is the exception: a browser leaves a resume made
//   without one pending until the page is allowed to play, and only a resume made
//   during a gesture starts it, so a gesture's request is sent unless the one in
//   flight came from the same tap. An in-flight request older than STALE_MS is
//   no longer shared;
// - after a failure, further calls wait out a cooldown that doubles per failure up
//   to a cap; a gesture waits only a short one, since iOS may need the gesture;
// - every promise the gate hands out is already handled, so a refusal never reaches
//   the window as an unhandled rejection (Phaser calls `context.resume()` and drops
//   the result). Callers that pass a rejection handler still receive the refusal.

export const GESTURE_COOLDOWN_MS = 300;
export const FAILURE_COOLDOWN_BASE_MS = 500;
export const FAILURE_COOLDOWN_MAX_MS = 8000;
export const STALE_MS = 1000;
const MAX_ATTEMPTS_KEPT = 8;

const noop = () => {};

function browserUserActive() {
  try {
    return globalThis.navigator?.userActivation?.isActive === true;
  } catch (_) {
    return false;
  }
}

function handled(promise) {
  promise.catch(noop);
  return promise;
}

export function failureCooldownMs(failures) {
  if (failures <= 0) return 0;
  return Math.min(FAILURE_COOLDOWN_MAX_MS, FAILURE_COOLDOWN_BASE_MS * 2 ** (failures - 1));
}

/**
 * Install the gate on `context` once (idempotent). Returns the gate:
 * `request({ gesture })`, `recentAttempts()`, `dispose()`.
 */
export function installAudioResumeGate(
  context,
  { now = () => Date.now(), onFailure = noop, userActive = browserUserActive } = {},
) {
  if (!context || typeof context.resume !== 'function') return null;
  if (context.__audioResumeGate) return context.__audioResumeGate;

  const nativeResume = context.resume;
  const nativeSuspend = typeof context.suspend === 'function' ? context.suspend : null;
  let inFlight = null;
  let inFlightAt = -Infinity;
  let inFlightGesture = false;
  let failures = 0;
  let lastFailureAt = -Infinity;
  let lastError = null;
  const attempts = [];

  const note = (record) => {
    attempts.push(record);
    if (attempts.length > MAX_ATTEMPTS_KEPT) attempts.shift();
  };

  const reset = () => {
    failures = 0;
    lastFailureAt = -Infinity;
    lastError = null;
  };

  const request = ({ gesture = false } = {}) => {
    const state = context.state;
    if (state === 'running') return Promise.resolve();
    if (!gesture) {
      try {
        gesture = userActive() === true;
      } catch (_) {
        gesture = false;
      }
    }
    const t = now();
    if (inFlight) {
      const age = t - inFlightAt;
      const sameTap = inFlightGesture && age < GESTURE_COOLDOWN_MS;
      if (gesture ? sameTap : age < STALE_MS) return inFlight;
    }
    if (state !== 'closed' && failures > 0) {
      const wait = gesture ? GESTURE_COOLDOWN_MS : failureCooldownMs(failures);
      if (t - lastFailureAt < wait) {
        note({ at: t, gesture, state, outcome: 'cooldown' });
        return handled(Promise.reject(lastError));
      }
    }
    const record = { at: t, gesture, state, outcome: 'pending' };
    note(record);
    let promise;
    try {
      promise = Promise.resolve(nativeResume.call(context));
    } catch (error) {
      promise = Promise.reject(error);
    }
    inFlight = promise;
    inFlightAt = t;
    inFlightGesture = gesture;
    promise.then(
      () => {
        if (inFlight === promise) inFlight = null;
        record.outcome = 'resolved';
        reset();
      },
      (error) => {
        if (inFlight === promise) inFlight = null;
        record.outcome = 'rejected';
        record.error = error?.message || String(error);
        failures++;
        lastFailureAt = now();
        lastError = error;
        try {
          onFailure(error);
        } catch (_) {
          /* diagnostics never break recovery */
        }
      },
    );
    return promise;
  };

  context.resume = function gatedResume() {
    return request({ gesture: false });
  };
  if (nativeSuspend) {
    context.suspend = function gatedSuspend() {
      // A suspend after a resume settles after it: the next resume must be a new one.
      inFlight = null;
      let promise;
      try {
        promise = Promise.resolve(nativeSuspend.call(context));
      } catch (error) {
        promise = Promise.reject(error);
      }
      return handled(promise);
    };
  }
  const onStateChange = () => {
    if (context.state === 'running') reset();
  };
  context.addEventListener?.('statechange', onStateChange);

  const gate = {
    request,
    recentAttempts: () => attempts.map((a) => ({ ...a })),
    dispose() {
      context.resume = nativeResume;
      if (nativeSuspend) context.suspend = nativeSuspend;
      context.removeEventListener?.('statechange', onStateChange);
      delete context.__audioResumeGate;
    },
  };
  context.__audioResumeGate = gate;
  return gate;
}
