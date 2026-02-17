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

function getBoolOverride(overrides, keys, fallback) {
  for (const key of keys) {
    if (typeof overrides?.[key] === 'boolean') return overrides[key];
  }
  return fallback;
}

export function resolveStartupFlags() {
  const isMobile = detectMobileRuntime();
  const overrides = readFlagOverrides();
  const mobileCameraEnabled = getBoolOverride(
    overrides,
    ['mobileCameraEnabled', 'MOBILE_CAMERA_ENABLED'],
    isMobile,
  );
  return {
    isMobile,
    mobileSafeBoot: asBool(overrides.mobileSafeBoot, isMobile),
    reducedPreload: asBool(overrides.reducedPreload, isMobile),
    mobileCameraEnabled,
    MOBILE_CAMERA_ENABLED: mobileCameraEnabled,
  };
}

export function getStartupFlags() {
  const existing = globalThis?.[GLOBAL_FLAGS_KEY];
  if (existing && typeof existing === 'object') return existing;
  const resolved = resolveStartupFlags();
  globalThis[GLOBAL_FLAGS_KEY] = resolved;
  return resolved;
}
