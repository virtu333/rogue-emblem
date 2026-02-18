const ESC_CONSUMED_EVENTS = new WeakSet();
const SCENE_ESC_STATE = new WeakMap();

function getSceneEscState(scene) {
  if (!scene || typeof scene !== 'object') return null;
  let state = SCENE_ESC_STATE.get(scene);
  if (!state) {
    state = { consumedInTick: false, resetQueued: false };
    SCENE_ESC_STATE.set(scene, state);
  }
  return state;
}

function markSceneEscConsumed(scene) {
  const state = getSceneEscState(scene);
  if (!state || state.consumedInTick) return;
  state.consumedInTick = true;
  if (state.resetQueued) return;
  state.resetQueued = true;
  const clear = () => {
    state.consumedInTick = false;
    state.resetQueued = false;
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(clear);
    return;
  }
  Promise.resolve().then(clear);
}

export function isEscConsumed(scene, event) {
  if (event && typeof event === 'object') {
    if (event.defaultPrevented === true) return true;
    if (ESC_CONSUMED_EVENTS.has(event)) return true;
  }
  const state = getSceneEscState(scene);
  return Boolean(state?.consumedInTick);
}

export function consumeEscEvent(scene, event) {
  if (isEscConsumed(scene, event)) return false;
  if (event && typeof event === 'object') {
    ESC_CONSUMED_EVENTS.add(event);
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }
  markSceneEscConsumed(scene);
  return true;
}
