export function createScopedLogger(scope, options = {}) {
  const debugEnabled = Boolean(options.debug);
  const prefix = `[${scope}]`;

  return {
    debug(...args) {
      if (!debugEnabled) return;
      console.debug(prefix, ...args);
    },
    info(...args) {
      console.info(prefix, ...args);
    },
    warn(...args) {
      console.warn(prefix, ...args);
    },
    error(...args) {
      console.error(prefix, ...args);
    },
  };
}
