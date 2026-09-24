// throttledRead — wrap a cheap-but-not-free getter (e.g. a settings read that parses
// localStorage) so per-frame callers see a value at most `ttlMs` old.

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @template T
 * @param {() => T} read
 * @param {number} [ttlMs]
 * @param {() => number} [now]
 * @returns {() => T}
 */
export function throttledRead(read, ttlMs = 500, now = clock) {
  let at = -Infinity;
  let value;
  return () => {
    const t = now();
    if (t - at >= ttlMs) {
      at = t;
      value = read();
    }
    return value;
  };
}
