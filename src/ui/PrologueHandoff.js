// PrologueHandoff — the one screen between the prologue's ending and Home Base
// (docs/specs/prologue-chapter.md §5 beat 8, §9 "The handoff"): the tutorial's
// protection ends here, so the rules that now hold are said once, in plain words. Which
// loss ends a run (the commander's fall), what happens to a fallen ally (down until a
// Church revives them for gold), what starts over (the army, levels, items, gold),
// what stays (Valor, Supply and the Home Base upgrades they buy) and how long a Vision
// charge lasts (the whole run). Copy: prologueContent's prologueHandoffContent.
//
// It plays once with the ending (PrologueEnding.presentPrologueEnding), before the one
// meta write. Presentation only: no game state.

import { MenuSurface, element, button } from './MenuSurface.js';
import { hasDOMHost } from '../utils/domUI.js';
import { prologueHandoffContent } from '../data/prologueContent.js';

/**
 * Show the handoff and resolve once the player continues (true), or false when the
 * scene shut down under it. Without a DOM host it resolves true at once.
 * @param {object} scene
 * @param {{ lead?: string, won?: boolean, commander?: string }} [options]
 */
export function showPrologueHandoff(scene, options = {}) {
  if (!hasDOMHost()) return Promise.resolve(true);
  const content = prologueHandoffContent(options);
  return new Promise((resolve) => {
    let settled = false;
    const shutdown = () => finish(false);
    const finish = (value = true) => {
      if (settled) return;
      settled = true;
      scene.events?.off?.('shutdown', shutdown);
      menu.destroy();
      resolve(value);
    };
    // Escape continues too: the screen informs, it never asks.
    const menu = new MenuSurface(scene, content.title, () => finish(true), { modal: true });
    menu.root.classList.add('re-run-flow', 're-handoff');
    menu.header.querySelector('button')?.remove();
    if (content.kicker) menu.body.append(element('p', content.kicker, 're-handoff-kicker'));
    if (content.lead) menu.body.append(element('p', content.lead, 're-handoff-lead'));
    const list = element('dl', null, 're-handoff-rules');
    for (const row of content.rows) list.append(element('dt', row.term), element('dd', row.text));
    menu.body.append(list);
    const actions = element('div', null, 're-flow-actions');
    actions.append(button(content.action, () => finish(true), 're-btn re-btn--primary'));
    menu.body.append(actions);
    scene.events?.once?.('shutdown', shutdown);
    menu.focusContent?.();
  });
}
