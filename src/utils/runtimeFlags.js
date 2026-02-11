const FLAG_STORAGE_KEY = 'emblem_rogue_startup_flags';
const GLOBAL_FLAGS_KEY = '__emblemRogueStartupFlags';

function isMobileUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return false;
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua);
}

export function detectMobileRuntime() {
  const ua = globalThis?.navigator?.userAgent || '';
  const coarsePointer = !!globalThis?.matchMedia?.('(pointer: coarse)').matches;
  return coarsePointer || isMobileUserAgent(ua);
}

function readFlagOverrides() {
  try {
    const raw = globalThis?.localStorage?.getItem(FLAG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function resolveStartupFlags() {
  const isMobile = detectMobileRuntime();
  const overrides = readFlagOverrides();
  return {
    isMobile,
    mobileSafeBoot: asBool(overrides.mobileSafeBoot, isMobile),
    reducedPreload: asBool(overrides.reducedPreload, isMobile),
  };
}

export function getStartupFlags() {
  const existing = globalThis?.[GLOBAL_FLAGS_KEY];
  if (existing && typeof existing === 'object') return existing;
  const resolved = resolveStartupFlags();
  globalThis[GLOBAL_FLAGS_KEY] = resolved;
  return resolved;
}
