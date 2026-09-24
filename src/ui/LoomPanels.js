import { element } from './MenuSurface.js';
import { createNodeArt } from './NodeArt.js';
import { nodeFrame } from './RouteGraph.js';
import { describeLoomNode, loomHeader } from './loomModel.js';
import { regionName } from './placeDisplay.js';
import { ACT_CONFIG, ELITE_LOOT_CHOICES, ELITE_MAX_PICKS } from '../utils/constants.js';

// DOM pieces shared by node travel and the read-only Campaign Map: the act header
// (Cinzel title + pixel subline) and the inspect card for the selected knot.

/** Act header block: "ACT I · BORDER MARCHES" in Cinzel, "BORDER SKIRMISHES · ROW 2 OF 8". */
export function createLoomHeading({
  actId,
  actIndex = 0,
  rows = 0,
  frontierRow = -1,
  prefix = '',
}) {
  const info = loomHeader({
    actIndex,
    actName: ACT_CONFIG[actId]?.name || '',
    region: regionName(actId),
    rows,
    frontierRow,
  });
  const wrap = element('div', null, 're-loom-heading');
  const title = element('h2', null, 're-loom-title');
  title.append(
    element('span', info.act, 're-loom-act'),
    element('span', '·', 're-loom-dot'),
    document.createTextNode(info.title),
  );
  title.setAttribute('aria-label', `${info.act} · ${info.title}`);
  const sub = [prefix.toUpperCase(), info.sub].filter(Boolean).join(' · ');
  wrap.append(title, element('p', sub, 're-loom-sub'));
  return wrap;
}

/**
 * Fill `card` with the inspect view of `node`.
 * @param {HTMLElement} card
 * @param {object} node
 * @param {object} ctx  { model, actId, gameData, runManager, activeLabel, shopOpen,
 *   isFirstBattle(node) — true for the knot that would be the run's first battle }
 */
export function renderLoomCard(card, node, ctx = {}) {
  card.replaceChildren();
  card.removeAttribute('data-tone');
  if (!node) return;
  const { model, actId, gameData, runManager: rm } = ctx;
  const state = model.nodeState(node.id);
  const info = describeLoomNode(node, {
    state,
    steps: model.steps.get(node.id) ?? null,
    actId,
    mapTemplates: gameData?.mapTemplates,
    dialogue: gameData?.dialogue,
    enemyLevelBonus: rm?.getDifficultyModifier?.('enemyLevelBonus', 0) ?? 0,
    // Fog never applies to a run's first battle (RunManager.getBattleParams).
    firstBattle: rm?.completedBattles === 0 && !!ctx.isFirstBattle?.(node),
    eliteLoot: { choices: ELITE_LOOT_CHOICES, picks: ELITE_MAX_PICKS },
    shopOpen: !!ctx.shopOpen,
    activeLabel: ctx.activeLabel || null,
  });
  card.dataset.tone = info.elite && state === 'live' ? 'elite' : state;

  const head = element('div', null, 're-loom-card-head');
  const medal = element('span', null, 're-loom-card-medal');
  medal.append(createNodeArt(nodeFrame(node, actId), 22));
  const titles = element('div', null, 're-loom-card-titles');
  const kind = element('h3', null, 're-loom-kind');
  kind.append(element('span', info.kind, info.elite ? 're-loom-kind-elite' : ''));
  if (info.objective) kind.append(element('span', ` · ${info.objective}`, 're-loom-kind-muted'));
  titles.append(kind);
  if (info.place) titles.append(element('p', info.place, 're-loom-place'));
  head.append(medal, titles);
  card.append(head);

  if (info.tags.length) {
    const tags = element('ul', null, 're-loom-tags');
    tags.setAttribute('aria-label', 'Encounter details');
    for (const tag of info.tags) tags.append(element('li', tag.text, `re-loom-tag is-${tag.tone}`));
    card.append(tags);
  }
  if (info.text) card.append(element('p', info.text, 're-loom-text'));
  if (info.flavor) card.append(element('p', `“${info.flavor}”`, 're-loom-flavor'));
  card.append(
    element('p', info.stateLine.text, `re-node-state re-loom-state is-${info.stateLine.tone}`),
  );
}
