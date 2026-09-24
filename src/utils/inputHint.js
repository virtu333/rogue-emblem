import { getStartupFlags } from './runtimeFlags.js';

// Read startup flags before scene-specific input setup (e.g. deployment/title).
export function inputHint(scene, desktop, touch) {
  const mobile =
    scene?.registry?.get?.('startupFlags')?.isMobile ??
    scene?.isMobileInput ??
    getStartupFlags().isMobile;
  return mobile ? touch : desktop;
}
