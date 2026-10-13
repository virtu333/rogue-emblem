// Settings' "This build" card: the text a bug report needs (utils/buildIdentity.js) and a
// Copy button. The native app's version and build arrive asynchronously; the text is
// redrawn when they do. The run is read when Settings opens (from the scene's run, so
// it is there from Pause in a battle or on the route map, and absent on the title).

import { element, button } from './MenuSurface.js';
import {
  BUILD_STAMP,
  buildPlatformLabel,
  formatBuildReport,
  readNativeAppInfo,
  runContextOf,
} from '../utils/buildIdentity.js';
import { copyText } from '../utils/copyText.js';
import { detectMobileRuntime } from '../utils/runtimeFlags.js';

export function buildInfoSection(scene) {
  const section = element('div', null, 're-card re-build-info');
  section.dataset.setting = 'build-info';
  const heading = element('span', 'This build');
  const text = element('pre', '', 're-build-info-text');
  const status = element('p', '', 're-muted');
  status.setAttribute('role', 'status');
  const turn = Number(scene?.turnManager?.turnNumber) || 0;
  const report = {
    stamp: BUILD_STAMP,
    platform: buildPlatformLabel({ mobile: detectMobileRuntime() }),
    native: null,
    run: runContextOf(scene?.runManager, { turn }),
  };
  let destroyed = false;
  const render = () => {
    text.textContent = formatBuildReport(report);
  };
  render();
  readNativeAppInfo().then((native) => {
    if (destroyed || !native) return;
    report.native = native;
    render();
  });
  const copy = button('Copy build info', async () => {
    const ok = await copyText(text.textContent);
    if (destroyed) return;
    status.textContent = ok
      ? 'Copied. Paste it into your bug report.'
      : 'Copy is blocked here. Select the text above to copy it.';
  });
  section.append(heading, text, copy, status);
  return {
    element: section,
    destroy() {
      destroyed = true;
    },
  };
}
