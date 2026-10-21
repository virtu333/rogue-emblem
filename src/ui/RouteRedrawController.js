// RouteRedrawController.js — Redraw road on the route map (engine/RouteRedraw.js): the
// confirmation, then one transaction across the run and the slot's Valor.
//
// Order: the run redraws first (RouteRedraw.redrawRoute, which can refuse with nothing changed),
// then the Valor is spent (MetaProgressionManager.spendValor, its own write), then the run is
// saved. A refused spend undoes the redraw; a run save that fails undoes it and hands the Valor
// back, so a redraw is either paid and saved or neither.

import { ChoicePicker } from './ChoicePicker.js';
import { ROUTE_REDRAW_MAX, redrawRoute, routeRedrawBlockText } from '../engine/RouteRedraw.js';
import { routeRedrawConfirmText, routeRedrawView } from './routeRedrawModel.js';

/** The slot's Valor as the route map shows it (0 without a meta: a dev route). */
export function heldValor(scene) {
  return scene?.registry?.get?.('meta')?.getTotalValor?.() ?? 0;
}

/**
 * Redraw now (the confirmation's Confirm). Returns { ok } or { ok: false, reason } in the
 * player's words.
 */
export function commitRouteRedraw(scene) {
  const run = scene.runManager;
  const meta = scene.registry?.get?.('meta');
  const view = routeRedrawView(run, heldValor(scene));
  if (!view || view.disabled) return { ok: false, reason: view?.reason || '' };
  const redraw = redrawRoute(run);
  if (!redraw.ok) return { ok: false, reason: routeRedrawBlockText(redraw.reason) };
  const paid = meta?.spendValor?.(redraw.price) || { ok: false, reason: 'short' };
  if (!paid.ok) {
    redraw.undo();
    return {
      ok: false,
      reason:
        paid.reason === 'short'
          ? routeRedrawBlockText('short', { price: redraw.price, valor: heldValor(scene) })
          : routeRedrawBlockText('save_failed'),
    };
  }
  const saved = scene.persistRunSave?.() || { ok: true };
  if (!saved.ok && saved.reason !== 'missing_slot') {
    redraw.undo();
    meta.addValor(redraw.price);
    return { ok: false, reason: routeRedrawBlockText('save_failed') };
  }
  return { ok: true, n: redraw.n, left: Math.max(0, ROUTE_REDRAW_MAX - redraw.n) };
}

/** Open the confirmation; `onDone(result)` runs once it closes after a redraw. */
export function openRouteRedraw(scene, onDone) {
  const view = routeRedrawView(scene.runManager, heldValor(scene));
  if (!view || view.disabled) return null;
  let done = null;
  return new ChoicePicker({
    scene,
    title: 'Redraw the road ahead?',
    choices: ['redraw'],
    confirmation: true,
    closeLabel: 'Cancel',
    confirmLabel: `Redraw · ${view.price.toLocaleString('en-US')} Valor`,
    label: () => 'Redraw road',
    describe: () => routeRedrawConfirmText(view),
    apply: () => {
      const result = commitRouteRedraw(scene);
      if (result.ok) done = result;
      return result;
    },
    onClose: () => {
      if (done) onDone?.(done);
    },
  });
}
