const FLAG_STORAGE_KEY = 'emblem_rogue_startup_flags';
const GLOBAL_FLAGS_KEY = '__emblemRogueStartupFlags';

function isMobileUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return false;
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua);
}

function isIOSRuntime(ua, maxTouchPoints = 0) {
  if (!ua || typeof ua !== 'string') return false;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && maxTouchPoints > 1;
}

function isSafariUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return false;
  if (!/safari/i.test(ua)) return false;
  return !/crios|fxios|edgios|opios|chrome|chromium|android/i.test(ua);
}

function isStandaloneDisplayMode() {
  const navigatorRef = globalThis?.navigator || {};
  const standaloneNavigator = navigatorRef.standalone === true;
  const standaloneMedia = !!globalThis?.matchMedia?.('(display-mode: standalone)')?.matches;
  return standaloneNavigator || standaloneMedia;
}

export function detectMobileRuntime() {
  const ua = globalThis?.navigator?.userAgent || '';
  const coarsePointer = !!globalThis?.matchMedia?.('(pointer: coarse)').matches;
  return coarsePointer || isMobileUserAgent(ua);
}

export function detectIOSSafariRuntime() {
  const navigatorRef = globalThis?.navigator || {};
  const ua = navigatorRef.userAgent || '';
  const maxTouchPoints = Number(navigatorRef.maxTouchPoints || 0);
  if (isStandaloneDisplayMode()) return false;
  return isIOSRuntime(ua, maxTouchPoints) && isSafariUserAgent(ua);
}

function readFlagOverrides() {
  try {
    const raw = globalThis?.localStorage?.getItem(FLAG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
  const isIOSSafari = detectIOSSafariRuntime();
  const overrides = readFlagOverrides();
  const mobileCameraEnabled = getBoolOverride(
    overrides,
    ['mobileCameraEnabled', 'MOBILE_CAMERA_ENABLED'],
    isMobile,
  );
  const startupViewportGuard = getBoolOverride(
    overrides,
    ['startupViewportGuard', 'STARTUP_VIEWPORT_GUARD'],
    isIOSSafari,
  );
  return {
    isMobile,
    isIOSSafari,
    mobileSafeBoot: asBool(overrides.mobileSafeBoot, isMobile),
    reducedPreload: asBool(overrides.reducedPreload, isMobile),
    mobileCameraEnabled,
    MOBILE_CAMERA_ENABLED: mobileCameraEnabled,
    startupViewportGuard,
    STARTUP_VIEWPORT_GUARD: startupViewportGuard,
  };
}

export function getStartupFlags() {
  const existing = globalThis?.[GLOBAL_FLAGS_KEY];
  if (existing && typeof existing === 'object') return existing;
  const resolved = resolveStartupFlags();
  globalThis[GLOBAL_FLAGS_KEY] = resolved;
  return resolved;
}
