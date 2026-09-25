import { BattleTimelineView } from './BattleTimelineView.js';
import { getCloudSaveConflict } from '../engine/CloudSaveConflict.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { MAX_SLOTS, getSlotSummary } from '../engine/SlotManager.js';
import { TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { deedsOfTheMarchSection } from './deedDisplay.js';
import { runEclipseSummary } from './eclipseContent.js';
import { slotCardModel } from './slotCardModel.js';
import { buildSlotCard, mountSlotPickerArt, slotPickerReducedMotion } from './SlotPickerView.js';

/** Shown when a finished run's rewards could not be written (they retry on Continue). */
export const PAYOUT_PENDING_NOTE =
  "Rewards couldn't be saved yet. They'll be added the next time you open this slot.";

export function runResultMenu(scene, rewards, meta) {
  const leave = (home) =>
    scene._attemptSceneTransition(
      home ? 'HomeBase' : 'Title',
      home ? TRANSITION_REASONS.RETURN_HOME : TRANSITION_REASONS.RETURN_TITLE,
    );
  const menu = new MenuSurface(
    scene,
    scene.result === 'victory' ? 'Run complete' : 'Game over',
    () => leave(true),
  );
  menu.root.classList.add('re-run-flow');
  menu.header.querySelector('button').textContent = 'Home Base';
  const rm = scene.runManager;
  const stats = element('dl', null, 're-run-summary');
  for (const [label, value] of [
    ['Battles won', rm.completedBattles],
    ['Act reached', `${rm.actIndex + 1} / ${rm.actSequence?.length || 4}`],
    ['Difficulty', rm.difficultyModifiers?.label || rm.difficultyId || 'Normal'],
    ...(runEclipseSummary(rm) ? [['Eclipse', runEclipseSummary(rm)]] : []),
    ['Currency multiplier', `×${rewards.currencyMultiplier.toFixed(2)}`],
    ['Valor earned', `+${rewards.valor}`],
    ['Supply earned', `+${rewards.supply}`],
  ])
    stats.append(element('dt', label), element('dd', String(value)));
  menu.body.append(stats);
  const deeds = deedsOfTheMarchSection(rm);
  if (deeds) menu.body.append(deeds);
  if (meta && rewards.appliedToMeta === false)
    menu.body.append(element('p', PAYOUT_PENDING_NOTE, 're-run-note'));
  if (meta)
    menu.body.append(
      element('p', `Total: ${meta.getTotalValor()} Valor · ${meta.getTotalSupply()} Supply`),
    );
  const actions = element('div', null, 're-flow-actions');
  actions.append(
    button('Home Base', () => leave(true), 're-btn re-btn--primary'),
    button('Title', () => leave(false)),
  );
  if (rm.lastBattleReport?.entries?.length)
    actions.append(
      button('Battle report', () => {
        menu.root.inert = true;
        new BattleTimelineView(scene, {
          history: rm.lastBattleReport,
          charges: 0,
          onClose: () => {
            menu.root.inert = false;
          },
        });
      }),
    );
  menu.body.append(actions);
  menu.focusContent();
  return menu;
}

export function slotMenu(scene) {
  const menu = new MenuSurface(scene, 'Select save', () => scene.requestCancel());
  menu.root.classList.add('re-run-flow', 'sp-shrine');
  menu.header.querySelector('button').textContent = 'Back to Title';
  menu.header.append(element('p', 'Three candles. Three chronicles.', 'sp-motto'));
  const reducedMotion = () => slotPickerReducedMotion(scene);
  const art = mountSlotPickerArt(menu.root, { reducedMotion });
  let kindling = false;
  const kindle = (card, slot, summary) => {
    if (kindling || scene.isTransitioning) return;
    kindling = true;
    card.classList.add('is-kindling');
    menu.root.classList.add('is-choosing');
    const settle = () => {
      kindling = false;
      if (menu.destroyed || scene.isTransitioning) return;
      card.classList.remove('is-kindling');
      menu.root.classList.remove('is-choosing');
    };
    // The flare plays while the scene transition runs: selection is never delayed,
    // so dialogs (suspended battle, cloud choice) open exactly as before.
    Promise.resolve(scene.selectSlot(slot, summary)).finally(settle);
  };
  menu.render = () => {
    menu.body.replaceChildren();
    art.refresh();
    const cards = element('div', null, 'sp-cards');
    const now = Date.now();
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const summary = getSlotSummary(slot);
      const model = slotCardModel(slot, summary, {
        gameData: scene.gameData,
        now,
        conflict: Boolean(summary && getCloudSaveConflict(slot)),
      });
      cards.append(
        buildSlotCard(model, {
          onPrimary: (card) => kindle(card, slot, summary),
          onDelete: () => scene.confirmDelete(slot),
        }),
      );
    }
    menu.body.append(cards);
    menu.focusContent();
  };
  const destroy = menu.destroy.bind(menu);
  menu.destroy = () => {
    art.destroy();
    destroy();
  };
  menu.render();
  return menu;
}

export function slotDialog(scene, title, message, actions) {
  const close = () => scene.requestCancel({ allowExit: false });
  const menu = new MenuSurface(scene, title, close, { modal: true });
  menu.root.classList.add('re-run-flow');
  const copy = element('p', message);
  copy.style.whiteSpace = 'pre-line';
  menu.body.append(copy);
  const row = element('div', null, 're-flow-actions');
  for (const [label, act, primary] of actions)
    row.append(button(label, act, primary ? 're-btn re-btn--primary' : 're-btn'));
  menu.body.append(row);
  menu.focusContent();
  return menu;
}
