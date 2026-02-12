export async function retryBooleanAction(action, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  const initialDelayMs = Math.max(0, options.initialDelayMs || 0);
  const delayMultiplier = options.delayMultiplier || 1;
  const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let i = 0; i < attempts; i++) {
    const ok = await action(i + 1);
    if (ok) return true;
    if (i >= attempts - 1) break;
    const delayMs = Math.round(initialDelayMs * Math.pow(delayMultiplier, i));
    if (delayMs > 0) await wait(delayMs);
  }

  return false;
}
