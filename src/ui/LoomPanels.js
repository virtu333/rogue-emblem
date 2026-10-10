import { button, element } from './MenuSurface.js';
import { createNodeArt } from './NodeArt.js';
import { nodeFrame } from './RouteGraph.js';
import { describeLoomNode, describeRecruitPreview, loomHeader } from './loomModel.js';
import { traitLines, markLine } from './traitContent.js';
import { ruinsChoice } from '../engine/RuinsCommands.js';
import { eventView } from '../engine/EventCommands.js';
import { contractRewardOwedAt } from '../engine/Contracts.js';
import { crestElement } from './crestArt.js';
import { regionName } from './placeDisplay.js';
import { ACT_CONFIG, ELITE_LOOT_CHOICES, ELITE_MAX_PICKS } from '../utils/constants.js';
import { portraitListLayout } from './portraitListLayout.js';

// DOM pieces shared by node travel and the read-only Campaign Map: the act header
// (Cinzel title + pixel subline) and the inspect card for the selected knot.

/** Act header block: "ACT I · BORDER MARCHES" in Cinzel, "BORDER SKIRMISHES · ROW 2 OF 8". */
export function createLoomHeading({
  actId,
  actIndex = 0,
  rows = 0,
  frontierRow = -1,
  prefix = '',
  act = null,
  title: titleOverride = null,
}) {
  const info = loomHeader({
    actIndex,
    actName: ACT_CONFIG[actId]?.name || '',
    region: regionName(actId),
    rows,
    frontierRow,
    act,
    title: titleOverride,
  });
  const wrap = element('div', null, 're-loom-heading');
  const title = element('h2', null, 're-loom-title');
  title.append(
    element('span', info.act, 're-loom-act'),
    element('span', '·', 're-loom-dot'),
    document.createTextNode(info.title),
  );
  title.setAttribute('aria-label', `${info.act} · ${info.title}`);
  // Each part of the subline stays whole with the dot after it ("ROW 2 OF 9", never
  // "ROW 2 / OF 9" or a line opening on "·") when an upright header wraps it; sideways
  // it is one line, as before.
  const sub = element('p', null, 're-loom-sub');
  const parts = [prefix.toUpperCase(), ...info.sub.split(' · ')].filter(Boolean);
  parts.forEach((part, i) => {
    if (i) sub.append(document.createTextNode(' '));
    sub.append(element('span', i < parts.length - 1 ? `${part} ·` : part, 're-loom-sub-part'));
  });
  wrap.append(title, sub);
  return wrap;
}

// Cards whose overflow cue is being kept up to date (trackLoomCardOverflow).
const overflowTrackers = new WeakMap();

/**
 * Keep `is-more-above` / `is-more-below` on an inspect card while its text runs past
 * its fixed height, so the upright sheet can fade the edge that has more to scroll
 * (loom.css; the sideways pane does not use the classes). Follows scrolling, the card
 * or its content changing size (a <details> opening, fonts arriving) and every
 * renderLoomCard. Returns { destroy }.
 */
export function trackLoomCardOverflow(card) {
  const update = () => {
    const more = card.scrollHeight - card.clientHeight;
    card.classList.toggle('is-more-above', more > 1 && card.scrollTop > 1);
    card.classList.toggle('is-more-below', more > 1 && card.scrollTop < more - 1);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  const refresh = () => {
    if (observer) {
      observer.disconnect();
      observer.observe(card);
      for (const child of card.children) observer.observe(child);
    }
    update();
  };
  // Upright, a chip's note that opens below the fold scrolls into the card's view
  // (its summary stays in view), so the tap visibly answers.
  const reveal = (event) => {
    const details = event.target;
    if (!details?.open || !portraitListLayout()) return;
    const box = card.getBoundingClientRect();
    const r = details.getBoundingClientRect();
    const below = r.bottom - (box.top + card.clientTop + card.clientHeight);
    const room = r.top - (box.top + card.clientTop);
    // Clear the card's faded foot too (loom.css), unless that would hide the summary.
    if (below > -40) card.scrollTop += Math.min(below + 44, Math.max(0, room));
  };
  const onToggle = (event) => {
    reveal(event);
    update();
  };
  card.addEventListener('scroll', update, { passive: true });
  // <details> toggle events do not bubble: listen in the capture phase.
  card.addEventListener('toggle', onToggle, true);
  const tracker = {
    refresh,
    destroy() {
      observer?.disconnect();
      card.removeEventListener('scroll', update);
      card.removeEventListener('toggle', onToggle, true);
      overflowTrackers.delete(card);
    },
  };
  overflowTrackers.set(card, tracker);
  refresh();
  return tracker;
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
      const item = element('li', null, trait.legendary || trait.special ? 'is-legendary' : '');
      item.append(element('strong', trait.name), document.createTextNode(` ${trait.text}`));
      list.append(item);
    }
    block.append(list);
  }
  if (view.mark) {
    const mark = element('p', null, 're-loom-recruit-mark');
    mark.append(
      element('strong', `Mark · ${view.mark.name}`),
      document.createTextNode(` ${view.mark.text}`),
    );
    block.append(mark);
  }
  return block;
}

/**
 * Open Roll: the node's other candidate, and the button that meets them instead
 * (`onSwap`: the route map's swap, which saves and redraws the card).
 */
function recruitAlternateBlock(view, onSwap) {
  const block = element('section', null, 're-loom-recruit-alt');
  block.setAttribute('aria-label', `Open Roll: ${view.name} also answers the call`);
  block.dataset.recruitAlternate = view.name;
  const line = element('p', null, 're-loom-recruit-alt-line');
  line.append(
    document.createTextNode('Open Roll · also waiting: '),
    element('strong', view.name),
    document.createTextNode(` · ${view.className} · Lv ${view.level}`),
  );
  const swap = button(`Meet ${view.name} instead`, onSwap, 're-btn re-loom-recruit-swap');
  block.append(line, swap);
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
  if (!node) {
    delete card.dataset.cardNode;
    overflowTrackers.get(card)?.refresh();
    return;
  }
  const { model, actId, gameData, runManager: rm } = ctx;
  const state = model.nodeState(node.id);
  const eclipse = ctx.eclipse?.nodes?.get?.(node.id) || null;
  // Recruit nodes show who waits there (RunManager builds the exact battle unit).
  let recruit = null;
  if (node.type === 'recruit' && !node.eclipse && state !== 'done') {
    try {
      recruit = describeRecruitPreview(rm?.getRecruitNodeUnit?.(node) || null, {
        traitLines: (unit) => traitLines(unit, gameData),
        markLine: (unit) => markLine(unit, gameData),
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
    contractOwed: !!(rm && contractRewardOwedAt(rm, node)),
    activeLabel: ctx.activeLabel || null,
    eclipse,
    recruit,
    recruitMods: rm?.getRecruitNodeBattleMods?.(node) || null,
    ruinsChoice: node.type === 'ruins' && rm ? ruinsChoice(rm, node.id) : null,
    // A visited event keeps the line of what was chosen there.
    eventChoice:
      node.type === 'event' && rm && (!node.eclipse || node.darkOmen === true)
        ? eventView(rm, node.id)?.outcome?.choiceLabel || null
        : null,
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
  // The boss this node holds (the prologue's gate): who, and how far his weapon reaches.
  if (info.boss) card.append(element('p', `Boss · ${info.boss}`, 're-loom-text re-loom-boss'));
  // A recruit card leads with the Talk instruction: the recruit block is tall and the
  // card scrolls without a cue, so on a phone the instruction would sit below the fold.
  const text = info.text ? element('p', info.text, 're-loom-text') : null;
  if (text && info.recruit) card.append(text);

  if (info.tags.length) {
    const tags = element('ul', null, 're-loom-tags');
    tags.setAttribute('aria-label', 'Encounter details');
    for (const tag of info.tags) {
      const row = element('li', null, `re-loom-tag is-${tag.tone}`);
      if (tag.detail) {
        const details = element('details');
        details.append(element('summary', tag.text), element('p', tag.detail));
        row.append(details);
      } else row.textContent = tag.text;
      tags.append(row);
    }
    card.append(tags);
  }
  if (info.recruit) card.append(recruitBlock(info.recruit));
  // Open Roll: the other candidate, swappable until the encounter is set (travel only: the
  // read-only Campaign Map passes no onSwapRecruit). A lord roll makes both candidates the same
  // lord (the node's unit stream decides it), so then there is nothing to choose.
  const alternate =
    info.recruit && !info.recruit.isLord && typeof ctx.onSwapRecruit === 'function'
      ? rm?.getRecruitAlternate?.(node.id) || null
      : null;
  if (alternate) {
    let altView = null;
    try {
      altView = describeRecruitPreview(rm.getRecruitNodeUnit(node, { preview: alternate }), {});
    } catch (err) {
      console.warn('[Loom] recruit alternate failed:', err);
    }
    if (altView && !altView.isLord)
      card.append(recruitAlternateBlock(altView, () => ctx.onSwapRecruit(node.id)));
  }
  if (text && !info.recruit) card.append(text);
  if (info.warning) card.append(element('p', info.warning, 're-loom-eclipse-warn'));
  if (info.flavor) card.append(element('p', `“${info.flavor}”`, 're-loom-flavor'));
  card.append(
    element('p', info.stateLine.text, `re-node-state re-loom-state is-${info.stateLine.tone}`),
  );
  // Another knot's card starts at its top (a redraw of the same knot keeps its place).
  if (card.dataset.cardNode !== node.id) card.scrollTop = 0;
  card.dataset.cardNode = node.id;
  overflowTrackers.get(card)?.refresh();
}

/** Add a line under the card's text (a note from the screen) and re-check its overflow. */
export function appendLoomCardNote(card, text) {
  card.append(element('p', text, 're-loom-note'));
  overflowTrackers.get(card)?.refresh();
}
