// routeRedrawModel.js — what the route map shows for Redraw road (engine/RouteRedraw.js).
// Pure: the button's words and state, and the confirmation's, from the run and the Valor held.

import {
  routeRedrawBlock,
  routeRedrawBlockText,
  routeRedrawOffered,
  routeRedrawPrice,
  routeRedrawsLeft,
} from '../engine/RouteRedraw.js';

const valorText = (n) => `${Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US')} Valor`;

/**
 * The button, or null when the route map does not offer it (the prologue, a no-upgrade run, the
 * Descent) or only the boss lies ahead.
 * @returns {{ label: string, line: string, disabled: boolean, reason: string, price: number|null,
 *   left: number, valor: number }|null}
 */
export function routeRedrawView(run, valor) {
  if (!routeRedrawOffered(run)) return null;
  const block = routeRedrawBlock(run);
  if (block === 'no_road') return null;
  const price = routeRedrawPrice(run);
  const left = routeRedrawsLeft(run);
  const held = Math.max(0, Math.floor(Number(valor) || 0));
  const short = price != null && held < price;
  const reason = block
    ? routeRedrawBlockText(block)
    : short
      ? routeRedrawBlockText('short', { price, valor: held })
      : '';
  return {
    label: 'Redraw road',
    line: left > 0 ? `${valorText(price)} · ${left} left` : 'None left this run',
    disabled: Boolean(reason),
    reason,
    price,
    left,
    valor: held,
  };
}

/** The confirmation's body for a redraw the button allowed. */
export function routeRedrawConfirmText(view) {
  const after = Math.max(0, view.left - 1);
  return [
    `Costs ${valorText(view.price)} (you have ${valorText(view.valor)}).`,
    'Every place between here and the boss is drawn again. The boss stays, and the dark falls on the new road as it would have on the old.',
    after === 0
      ? 'This is your last redraw this run.'
      : `${after} redraw${after === 1 ? '' : 's'} left after this.`,
  ].join(' ');
}
