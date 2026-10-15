import { installAudioResumeGate } from './audioResumeGate.js';

// Recover an existing AudioContext; never restart music, change volume, or
// create a second context. iOS can reject a foreground resume until a gesture.
// Every resume goes through the context's gate (audioResumeGate.js): one in
// flight, a cooldown after a refusal, never an unhandled rejection.
export function installAudioRecovery(
  context,
  { document: doc, window: win, configure = () => {}, onFailure },
) {
  if (!context) return () => {};
  const gate = installAudioResumeGate(context, { onFailure });
  let disposed = false;
  let generation = 0;
  const timers = new Set();
  const foreground = () => !doc.hidden && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
  const attempt = (gesture = false) => {
    if (
      disposed ||
      doc.hidden ||
      (!gesture && !foreground()) ||
      context.state === 'running' ||
      context.state === 'closed'
    )
      return;
    configure();
    if (gate) gate.request({ gesture });
    else {
      try {
        Promise.resolve(context.resume()).catch(() => {});
      } catch (_) {
        /* retry on input */
      }
    }
  };
  const clear = () => {
    generation++;
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
  };
  const activate = () => {
    clear();
    if (!foreground()) return;
    attempt();
    const epoch = generation;
    for (const delay of [250, 1000]) {
      const id = win.setTimeout(() => {
        timers.delete(id);
        if (epoch === generation) attempt();
      }, delay);
      timers.add(id);
    }
  };
  const visibility = () => (doc.hidden ? clear() : activate());
  const gesture = () => attempt(true);
  const bindings = [
    [doc, 'visibilitychange', visibility],
    [win, 'focus', activate],
    [win, 'pageshow', activate],
    [win, 'blur', clear],
    [doc, 'pointerdown', gesture],
    [doc, 'touchend', gesture],
    [doc, 'keydown', gesture],
  ];
  for (const [target, type, listener] of bindings) target.addEventListener(type, listener, true);
  return () => {
    disposed = true;
    clear();
    gate?.dispose();
    for (const [target, type, listener] of bindings)
      target.removeEventListener(type, listener, true);
  };
}
