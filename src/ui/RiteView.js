import { element } from './MenuSurface.js';

// DOM for the Rite (riteModel.js is the words): the note a Rite chip opens on the route map, and
// the block a boss node's loom card carries. Plain text and lists, no controls: nothing to focus.

/**
 * The note under the burden row when the Rite chip is open: the tier and its way up, what the
 * tier does to each boss still ahead, and where the words came from.
 * @param {ReturnType<import('./riteModel.js').riteChipModel>} model
 */
export function riteNoteContent(model) {
  const body = element('div', null, 're-rite-body');
  const progress = element('p', null, 're-rite-progress');
  progress.append(
    element('strong', model.bandLabel),
    document.createTextNode(` · ${model.progress}`),
  );
  body.append(progress);
  if (model.effects.length) {
    const list = element('ul', null, 're-rite-effects');
    list.setAttribute('aria-label', 'What the Rite does');
    for (const effect of model.effects) {
      const item = element('li');
      item.dataset.riteTarget = effect.target;
      // "The Lieutenant" in bold, the rest of the sentence after it.
      item.append(element('strong', effect.name), document.createTextNode(effect.rest));
      list.append(item);
    }
    body.append(list);
  }
  if (model.fromLine) body.append(element('p', model.fromLine, 're-rite-from'));
  return body;
}

/**
 * The Rite's effect on one boss, for that node's loom card: the tier and the words it stands at,
 * then what it does to this fight, and whether that is already fixed.
 * @param {ReturnType<import('./riteModel.js').riteNodeModel>} model
 */
export function riteCardBlock(model) {
  const block = element('section', null, 're-loom-rite');
  block.setAttribute('aria-label', `${model.label}: ${model.bandLabel}`);
  block.dataset.rite = model.state;
  block.dataset.riteTarget = model.target;
  const head = element('p', null, 're-loom-rite-head');
  head.append(
    element('strong', `${model.label} · ${model.bandLabel}`),
    element('span', ` · ${model.wordsText}`, 're-loom-rite-words'),
  );
  const list = element('ul', null, 're-loom-rite-lines');
  for (const line of model.lines) list.append(element('li', line));
  block.append(head, list, element('p', model.note, 're-loom-rite-note'));
  return block;
}
