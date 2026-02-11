const TELEMETRY_KEY = '__emblemRogueStartupTelemetry';

function nowMs() {
  if (typeof globalThis?.performance?.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

function ensureTelemetry() {
  if (!globalThis[TELEMETRY_KEY]) {
    globalThis[TELEMETRY_KEY] = {
      startedAt: nowMs(),
      markers: [],
      assetFailures: [],
      meta: {},
      summaryLogged: false,
    };
  }
  return globalThis[TELEMETRY_KEY];
}

export function initStartupTelemetry(meta = {}) {
  const telemetry = ensureTelemetry();
  telemetry.meta = { ...telemetry.meta, ...meta };
  markStartup('app_init_start');
  return telemetry;
}

export function markStartup(name, data = {}) {
  const telemetry = ensureTelemetry();
  telemetry.markers.push({
    name,
    at: nowMs(),
    data,
  });
}

export function recordStartupAssetFailure(file, scene = 'unknown') {
  const telemetry = ensureTelemetry();
  telemetry.assetFailures.push({
    key: file?.key || null,
    src: file?.src || file?.url || null,
    type: file?.type || null,
    scene,
  });
}

export function getStartupTelemetry() {
  return globalThis[TELEMETRY_KEY] || null;
}

export function logStartupSummary({ reason = 'startup_complete', force = false } = {}) {
  const telemetry = getStartupTelemetry();
  if (!telemetry) return;
  if (telemetry.summaryLogged && !force) return;

  const isDev = !!globalThis?.location?.hostname
    && ['localhost', '127.0.0.1'].includes(globalThis.location.hostname);
  if (!isDev && !force) return;

  const start = telemetry.startedAt || 0;
  const markers = telemetry.markers.map((m) => ({
    name: m.name,
    ms: Math.max(0, Math.round(m.at - start)),
    data: m.data || {},
  }));
  const summary = {
    reason,
    meta: telemetry.meta || {},
    markerCount: markers.length,
    markers,
    assetFailureCount: telemetry.assetFailures.length,
    assetFailures: telemetry.assetFailures.slice(0, 10),
  };
  console.info('[StartupTelemetry]', summary);
  telemetry.summaryLogged = true;
}
