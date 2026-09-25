import { button } from './MenuSurface.js';
import { createNodeArt } from './NodeArt.js';
import {
  buildLoomModel,
  layoutLoom,
  loomAnchorScroll,
  loomMedalSize,
  loomShortLabel,
  LOOM_MEDAL,
} from './loomModel.js';
import { drawLoomFx, drawLoomWeave, loomFxAnimates } from '../art/loom/loomThreads.js';

// Shared route renderer for node travel (NodeMapMenu) and the read-only in-battle
// Campaign Map: "the Loom" (docs/art-direction/board/loom). DOM buttons keep focus,
// aria-pressed and 44px+ hit areas; two canvases underneath carry the weave and the
// animated fx. Selection and encounter rules stay with the callers.

const FRAMES = { battle: 0, church: 1, boss: 2, shop: 3, ruins: 4, recruit: 5, colosseum: 6 };
const LABELS = {
  battle: 'Battle',
  church: 'Church',
  boss: 'Boss battle',
  shop: 'Village',
  ruins: 'Ruins',
  recruit: 'Recruit',
  colosseum: 'Colosseum',
};
const isEliteBattle = (node) => node?.type === 'battle' && !!node?.battleParams?.isElite;
const isEclipsed = (node) => !!node?.eclipse;

export function nodeFrame(node, act) {
  // A place the dark took keeps its silhouette (a burned village is still a village).
  const was = node?.eclipse?.fromType;
  if (was && was !== 'battle' && FRAMES[was] != null) return FRAMES[was];
  return node.type === 'boss' && act === 'finalBoss'
    ? 8
    : isEliteBattle(node)
      ? 7
      : (FRAMES[node.type] ?? 0);
}
export function nodeLabel(node) {
  if (isEclipsed(node)) return node.eclipse.label || 'Eclipsed battle';
  return isEliteBattle(node) ? 'Elite battle' : LABELS[node.type] || node.type;
}

const STATE_TEXT = {
  current: 'You are here',
  done: 'Completed',
  live: 'Available',
  future: 'Future',
  cut: 'Out of reach',
};
const FX_FRAME_MS = 1000 / 30;
const SVG_NS = 'http://www.w3.org/2000/svg';
// A hairline fracture entering the rim (the Lieutenant's mark), not a bolt.
const CRACK_PATH = 'M36.2 4.4 L34.6 9.1 L30.9 10.3 L30.6 13.2 M34.6 9.1 L38.1 10';

// Ember cracks across an eclipsed medal: light leaking through the ink.
// Two fracture systems entering from the rim (viewBox 46: medal centre 23,23).
const EMBER_PATHS = [
  'M38.6 9.6 L32.4 14.1 L29.2 13.2 L25.1 18.4',
  'M32.4 14.1 L33.1 19.6',
  'M7.9 32.2 L13.6 28.9 L14.2 25.1 L18.4 23.3',
  'M13.6 28.9 L17.2 32.6',
];

function emberSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 're-eclipse-cracks');
  svg.setAttribute('viewBox', '0 0 46 46');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['re-eclipse-crack-glow', 're-eclipse-crack-line']) {
    for (const d of EMBER_PATHS) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', cls);
      svg.append(path);
    }
  }
  return svg;
}

function crackSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 're-loom-crack');
  svg.setAttribute('viewBox', '0 0 46 46');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['re-loom-crack-shadow', 're-loom-crack-line']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', CRACK_PATH);
    path.setAttribute('class', cls);
    svg.append(path);
  }
  return svg;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function fontsReady() {
  try {
    return document.fonts?.check?.('8px "Press Start 2P"') !== false;
  } catch {
    return true;
  }
}

/**
 * @param {object} opts
 * @param {Array} opts.nodes            act graph nodes (RunManager.nodeMap.nodes)
 * @param {string} [opts.startNodeId]
 * @param {Set<string>} [opts.available] nodes the party may enter now
 * @param {string|null} [opts.currentId] where the party stands
 * @param {string} [opts.currentLabel]  aria state for the current node
 * @param {string} [opts.selectedId]
 * @param {string} [opts.actId]
 * @param {(id: string) => void} opts.onSelect
 * @param {() => boolean} [opts.reducedMotion]
 * @param {object|null} [opts.eclipse]  RunManager.getEclipseView() (null: no Eclipse)
 * @param {Set<string>} [opts.pendingFalls] eclipsed nodes whose fall has not played yet;
 *   drawn as they were until playFalls() bleeds them to ink
 */
export function createRouteGraph({
  nodes,
  startNodeId = null,
  available = new Set(),
  currentId = null,
  currentLabel = STATE_TEXT.current,
  selectedId,
  actId,
  onSelect,
  reducedMotion = () => false,
  eclipse = null,
  pendingFalls = new Set(),
}) {
  const model = buildLoomModel({ nodes, startNodeId, availableIds: available, currentId });
  const pending = new Set([...pendingFalls].filter((id) => nodes.some((n) => n.id === id)));
  // Ember bursts for the fall ceremony: { id, start } (fx-layer time, ms).
  let falls = [];
  const graph = document.createElement('div');
  graph.className = 're-node-graph re-loom';
  const weave = document.createElement('canvas');
  weave.className = 're-loom-weave';
  weave.setAttribute('aria-hidden', 'true');
  const fx = document.createElement('canvas');
  fx.className = 're-loom-fx';
  fx.setAttribute('aria-hidden', 'true');
  graph.append(weave, fx);

  const buttons = new Map();
  let selected = selectedId;
  for (const n of nodes) {
    const state = model.nodeState(n.id);
    const isAvailable = model.available.has(n.id);
    const b = button(null, () => onSelect(n.id), 're-node');
    b.dataset.node = n.id;
    b.classList.add(`is-${state}`);
    b.classList.toggle('is-completed', !!n.completed);
    b.classList.toggle('is-available', isAvailable);
    b.classList.toggle('is-elite', isEliteBattle(n));
    b.classList.toggle('is-boss', n.type === 'boss');
    const fallen = isEclipsed(n);
    const eclipseInfo = eclipse?.nodes?.get?.(n.id) || null;
    b.classList.toggle('is-eclipsed', fallen);
    b.classList.toggle('is-eclipse-pending', fallen && pending.has(n.id));
    const waning = !fallen && !!eclipseInfo?.near && state !== 'done' && state !== 'current';
    b.classList.toggle('is-waning', waning);
    const stateText = state === 'current' ? currentLabel : STATE_TEXT[state];
    const warn = waning ? ` · falls in ${eclipseInfo.remaining} shadow` : '';
    b.setAttribute(
      'aria-label',
      `${nodeLabel(n)} · ${stateText}${warn} · row ${n.row + 1} lane ${n.col + 1}`,
    );
    const medal = span('re-loom-medal');
    // A fall still waiting for its ceremony shows the place as it was.
    const frame = pending.has(n.id) ? (FRAMES[n.eclipse.fromType] ?? 0) : nodeFrame(n, actId);
    medal.append(createNodeArt(frame, n.type === 'boss' ? 34 : 29));
    if (fallen) medal.append(span('re-eclipse-ink'), emberSvg());
    b.append(medal);
    if (waning) {
      // A crescent bite on the frame, clipped to the medal and its rim: deeper the
      // closer the fall (1..warn shadow).
      const bite = span('re-eclipse-bite');
      bite.style.setProperty('--bite', String(Math.max(1, Math.min(3, eclipseInfo.remaining))));
      bite.append(span('re-eclipse-bite-disc'));
      b.append(bite);
    }
    if (isEliteBattle(n) && !fallen) b.append(crackSvg());
    if (state === 'current') b.append(span('re-loom-here'));
    if (state === 'live') b.append(span('re-loom-label', loomShortLabel(n)));
    const opacity = model.nodeOpacity(n.id);
    if (opacity < 1) b.style.setProperty('--re-loom-fade', String(opacity));
    graph.append(b);
    buttons.set(n.id, b);
  }

  let scrollEl = null;
  let layout = null;
  let woven = null;
  let dpr = 1;
  let active = true;
  let destroyed = false;
  let raf = 0;
  let lastFx = -Infinity;
  let pendingScroll = null;
  // Browsing position, tracked in JS: a scroller hidden with display:none (while a
  // service, roster or pause covers the route) loses its offset in the browser.
  let lastScroll = 0;
  let resizeObserver = null;
  let fontWait = null;
  let cancelFalls = null;

  function applySelection() {
    for (const [id, b] of buttons) {
      b.setAttribute('aria-pressed', String(id === selected));
      b.classList.toggle('is-selected', id === selected);
    }
  }
  applySelection();

  function sizeCanvas(canvas, w, h) {
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function paintWeave() {
    if (!layout) return;
    const ready = fontsReady();
    woven = drawLoomWeave(weave.getContext('2d'), {
      model,
      layout,
      positions: layout.positions,
      dpr,
      seed: nodes.length * 31 + (model.rows || 0),
      fontReady: ready,
      eclipse: eclipse
        ? {
            laneDarkness: eclipse.laneDarkness,
            // Pending falls are painted as they were until the ceremony plays.
            eclipsedIds: new Set(
              nodes.filter((n) => isEclipsed(n) && !pending.has(n.id)).map((n) => n.id),
            ),
            phaseIndex: eclipse.phase?.index || 0,
          }
        : null,
    });
    if (!ready && !fontWait && document.fonts?.load) {
      fontWait = document.fonts
        .load('8px "Press Start 2P"')
        .then(() => {
          if (!destroyed && layout) paintWeave();
        })
        .catch(() => {});
    }
  }

  function paintFx(timeMs = 0) {
    if (!layout || !woven) return;
    drawLoomFx(fx.getContext('2d'), {
      model,
      layout,
      paths: woven.paths,
      leadPts: woven.leadPts,
      selectedId: selected,
      dpr,
      timeMs,
      reduced: reducedMotion(),
      falls,
    });
  }

  function shouldAnimate() {
    return (
      active &&
      !destroyed &&
      !!layout &&
      !reducedMotion() &&
      !(typeof document !== 'undefined' && document.hidden) &&
      (falls.length > 0 || loomFxAnimates(model, selected))
    );
  }

  function tick(now) {
    raf = 0;
    if (!shouldAnimate()) return;
    if (now - lastFx >= FX_FRAME_MS - 1) {
      lastFx = now;
      paintFx(now);
    }
    raf = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    if (shouldAnimate()) {
      if (!raf) raf = requestAnimationFrame(tick);
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      // A still frame: static glints under reduced motion, or the last state when paused.
      if (layout && !destroyed) paintFx(reducedMotion() ? 0 : lastFx > 0 ? lastFx : 0);
    }
  }

  function relayout() {
    if (destroyed || !scrollEl) return false;
    const width = scrollEl.clientWidth;
    const height = scrollEl.clientHeight;
    if (!width || !height) return false;
    const medal = loomMedalSize(width, height);
    if (
      layout &&
      layout.width === width &&
      layout.height === height &&
      layout.medal === medal &&
      dpr === Math.min(3, window.devicePixelRatio || 1)
    ) {
      restoreScroll();
      return true;
    }
    dpr = Math.min(3, window.devicePixelRatio || 1);
    layout = layoutLoom({ rows: model.rows, width, height, medal });
    layout.positions = new Map(
      nodes.map((n) => [n.id, { x: layout.x(n.row), y: layout.y(n.col) }]),
    );
    graph.style.setProperty('--medal', `${medal}px`);
    graph.classList.toggle('re-loom--narrow', medal < LOOM_MEDAL);
    graph.classList.toggle('re-loom--roomy', medal > LOOM_MEDAL);
    // Choice labels hang under their medal; hide them when lanes are too tight to fit.
    graph.classList.toggle('re-loom--tight', layout.dy < medal + 20);
    graph.style.width = `${layout.innerW}px`;
    graph.style.height = `${height}px`;
    sizeCanvas(weave, layout.innerW, height);
    sizeCanvas(fx, layout.innerW, height);
    for (const n of nodes) {
      const p = layout.positions.get(n.id);
      const b = buttons.get(n.id);
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
    }
    paintWeave();
    paintFx(lastFx > 0 ? lastFx : 0);
    if (pendingScroll !== null) {
      lastScroll = pendingScroll === 'anchor' ? loomAnchorScroll(layout, model) : pendingScroll;
      pendingScroll = null;
    }
    restoreScroll();
    syncAnimation();
    return true;
  }

  function restoreScroll() {
    if (!scrollEl || !layout) return;
    const max = Math.max(0, layout.innerW - scrollEl.clientWidth);
    lastScroll = Math.max(0, Math.min(max, lastScroll));
    if (Math.abs(scrollEl.scrollLeft - lastScroll) >= 1) scrollEl.scrollLeft = lastScroll;
  }

  const onScroll = () => {
    // Ignore the reset a hidden (zero-size) scroller reports.
    if (scrollEl?.clientWidth && layout && pendingScroll === null) lastScroll = scrollEl.scrollLeft;
  };

  const onVisibility = () => syncAnimation();

  return {
    graph,
    model,
    get layout() {
      return layout;
    },
    /** True while the fx loop (glints / vision dashes) is running. */
    get animating() {
      return raf !== 0;
    },
    /** The browsing position to carry into a redraw of the same act. */
    get scrollLeft() {
      return lastScroll;
    },
    /**
     * Attach to the scroll viewport (already in the document). `scrollLeft` restores
     * a browsing position; omitted, a fresh loom anchors on the choices.
     */
    mount(el, { scrollLeft = null } = {}) {
      scrollEl = el;
      pendingScroll = scrollLeft ?? 'anchor';
      el.addEventListener('scroll', onScroll, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => relayout());
        resizeObserver.observe(el);
      }
      document.addEventListener('visibilitychange', onVisibility);
      relayout();
    },
    relayout,
    setSelected(id) {
      selected = id;
      applySelection();
      lastFx = -Infinity;
      paintFx(0);
      syncAnimation();
    },
    /** Pause the fx loop while the route is covered or hidden. */
    setActive(value) {
      active = !!value;
      if (active) relayout();
      syncAnimation();
    },
    refreshMotion() {
      syncAnimation();
    },
    /** Nodes still waiting for their fall ceremony. */
    get pendingFalls() {
      return [...pending];
    },
    /**
     * The fall ceremony: each pending node bleeds to ink in turn, with ember sparks on
     * the fx layer. Reduced motion (or a hidden loom): an instant swap. Resolves with
     * the ids that fell, once every node shows its eclipsed face.
     */
    playFalls({ staggerMs = 620, durationMs = 1100 } = {}) {
      const ids = nodes.filter((n) => pending.has(n.id)).map((n) => n.id);
      const settle = (id) => {
        if (!pending.delete(id)) return;
        const b = buttons.get(id);
        b?.classList.remove('is-eclipse-pending', 'is-falling');
        // The place now wears its eclipsed face (an eclipsed battle reads elite).
        const n = nodes.find((x) => x.id === id);
        const art = b?.querySelector('.re-loom-medal .re-node-art');
        const frame = n ? nodeFrame(n, actId) : null;
        if (art && n && frame !== (FRAMES[n.eclipse?.fromType] ?? 0))
          art.replaceWith(createNodeArt(frame, n.type === 'boss' ? 34 : 29));
      };
      const repaint = () => {
        if (!layout || destroyed) return;
        paintWeave();
        paintFx(lastFx > 0 ? lastFx : 0);
      };
      if (!ids.length) return Promise.resolve([]);
      if (reducedMotion() || !active || destroyed || !layout) {
        ids.forEach(settle);
        repaint();
        return Promise.resolve(ids);
      }
      return new Promise((resolve) => {
        const timers = [];
        ids.forEach((id, i) => {
          timers.push(
            setTimeout(() => {
              if (destroyed) return;
              buttons.get(id)?.classList.add('is-falling');
              falls = [...falls, { id, start: performance.now() }];
              syncAnimation();
            }, i * staggerMs),
          );
          timers.push(
            setTimeout(
              () => {
                if (destroyed) return;
                settle(id);
                repaint();
              },
              i * staggerMs + durationMs,
            ),
          );
        });
        const total = (ids.length - 1) * staggerMs + durationMs + 720;
        timers.push(
          setTimeout(() => {
            falls = [];
            cancelFalls = null;
            if (!destroyed) {
              ids.forEach(settle);
              repaint();
              syncAnimation();
            }
            resolve(ids);
          }, total),
        );
        cancelFalls = () => {
          timers.forEach(clearTimeout);
          falls = [];
          ids.forEach(settle);
          resolve(ids);
        };
      });
    },
    /** Finish any running ceremony at once (the loom was covered or torn down). */
    finishFalls() {
      cancelFalls?.();
      cancelFalls = null;
    },
    destroy() {
      if (destroyed) return;
      cancelFalls?.();
      cancelFalls = null;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      scrollEl?.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      // Release canvas backing stores promptly (iOS canvas memory is tight).
      for (const c of [weave, fx]) {
        c.width = 0;
        c.height = 0;
      }
      graph.remove();
    },
  };
}
