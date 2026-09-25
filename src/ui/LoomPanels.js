import { element } from './MenuSurface.js';
import { createNodeArt } from './NodeArt.js';
import { nodeFrame } from './RouteGraph.js';
import { describeLoomNode, describeRecruitPreview, loomHeader } from './loomModel.js';
import { traitLines } from './traitContent.js';
import { crestElement } from './crestArt.js';
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
 * The recruit panel on a recruit node's card: crest, name, a pixel kicker
 * (class · level · seasoned), the class's key stats, where it grows, its traits.
 */
function recruitBlock(view) {
  const block = element('section', null, 're-loom-recruit');
  block.setAttribute('aria-label', `Recruit: ${view.name}, ${view.className}, level ${view.level}`);
  block.dataset.recruit = view.name;
  const head = element('div', null, 're-loom-recruit-head');
  const crest = crestElement(view.className, { className: 're-loom-recruit-crest' });
  if (crest) head.append(crest);
  const titles = element('div', null, 're-loom-recruit-titles');
  titles.append(
    element('strong', view.name, 're-loom-recruit-name'),
    element('span', view.kicker, 're-loom-recruit-kicker'),
  );
  head.append(titles);
  block.append(head);
  const stats = element('dl', null, 're-loom-recruit-stats');
  for (const { stat, value } of view.stats) {
    const cell = element('div');
    cell.append(element('dt', stat), element('dd', String(value)));
    stats.append(cell);
  }
  block.append(stats);
  if (view.growths.length)
    block.append(
      element(
        'p',
        `Grows ${view.growths.map((g) => `${g.stat} ${g.value}%`).join(' · ')}`,
        're-loom-recruit-growth',
      ),
    );
  if (view.traits.length) {
    const list = element('ul', null, 're-loom-recruit-traits');
    for (const trait of view.traits) {
      const item = element('li', null, trait.legendary ? 'is-legendary' : '');
      item.append(element('strong', trait.name), document.createTextNode(` ${trait.text}`));
      list.append(item);
    }
    block.append(list);
  }
  return block;
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
  const eclipse = ctx.eclipse?.nodes?.get?.(node.id) || null;
  // Recruit nodes show who waits there (RunManager builds the exact battle unit).
  let recruit = null;
  if (node.type === 'recruit' && !node.eclipse && state !== 'done') {
    try {
      recruit = describeRecruitPreview(rm?.getRecruitNodeUnit?.(node) || null, {
        traitLines: (unit) => traitLines(unit, gameData),
      });
    } catch (err) {
      console.warn('[Loom] recruit preview failed:', err);
    }
  }
  const info = describeLoomNode(node, {
    state,
    steps: model.steps.get(node.id) ?? null,
    actId,
    mapTemplates: gameData?.mapTemplates,
    dialogue: gameData?.dialogue,
    // Difficulty offset plus the Eclipse's phase / eclipsed-node levels (what
    // RunManager.getBattleParams will actually pass to the battle).
    enemyLevelBonus:
      (rm?.getDifficultyModifier?.('enemyLevelBonus', 0) ?? 0) +
      (rm?.getEclipseLevelBonus?.(node) ?? 0) +
      (rm?.getBlessingEnemyLevelDelta?.(actId) ?? 0),
    // Fog never applies to a run's first battle (RunManager.getBattleParams).
    firstBattle: rm?.completedBattles === 0 && !!ctx.isFirstBattle?.(node),
    eliteLoot: { choices: ELITE_LOOT_CHOICES, picks: ELITE_MAX_PICKS },
    shopOpen: !!ctx.shopOpen,
    activeLabel: ctx.activeLabel || null,
    eclipse,
    recruit,
    recruitMods: rm?.getRecruitNodeBattleMods?.(node) || null,
  });
  card.dataset.tone = info.eclipsed ? 'eclipsed' : info.elite && state === 'live' ? 'elite' : state;

  const head = element('div', null, 're-loom-card-head');
  const medal = element('span', null, 're-loom-card-medal');
  medal.append(createNodeArt(nodeFrame(node, actId), 22));
  if (info.eclipsed) medal.classList.add('is-eclipsed');
  const titles = element('div', null, 're-loom-card-titles');
  const kind = element('h3', null, 're-loom-kind');
  kind.append(
    element(
      'span',
      info.kind,
      info.eclipsed ? 're-loom-kind-eclipsed' : info.elite ? 're-loom-kind-elite' : '',
    ),
  );
  if (info.objective) kind.append(element('span', ` · ${info.objective}`, 're-loom-kind-muted'));
  titles.append(kind);
  if (info.place) titles.append(element('p', info.place, 're-loom-place'));
  if (info.templateName) titles.append(element('p', info.templateName, 're-loom-was'));
  head.append(medal, titles);
  card.append(head);

  if (info.tags.length) {
    const tags = element('ul', null, 're-loom-tags');
    tags.setAttribute('aria-label', 'Encounter details');
    for (const tag of info.tags) tags.append(element('li', tag.text, `re-loom-tag is-${tag.tone}`));
    card.append(tags);
  }
  if (info.recruit) card.append(recruitBlock(info.recruit));
  if (info.text) card.append(element('p', info.text, 're-loom-text'));
  if (info.warning) card.append(element('p', info.warning, 're-loom-eclipse-warn'));
  if (info.flavor) card.append(element('p', `“${info.flavor}”`, 're-loom-flavor'));
  card.append(
    element('p', info.stateLine.text, `re-node-state re-loom-state is-${info.stateLine.tone}`),
  );
}
