import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { element, button } from './MenuSurface.js';
import { hasOpenOverlay, isTopOverlay } from '../utils/overlayStack.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { createHealthBar } from './healthBar.js';
import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import { pc98PortraitElement, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js';
import { textureImageSource } from './textureImageSource.js';
import { createRouteGraph } from './RouteGraph.js';
import { createLoomHeading, renderLoomCard } from './LoomPanels.js';
import { throttledRead } from '../utils/throttledRead.js';
import { createEclipseMedallion, openEclipseCard } from './EclipsePanels.js';
import { fallToastText, kindlePrice } from '../engine/EclipseSystem.js';
import { showMinorHint } from './HintDisplay.js';
import { playCue } from './ceremonyMusic.js';

const ECLIPSE_TOAST_MS = 4200;

/** Every node the party can still reach from the available choices (inclusive). */
function reachableFrom(nodes, available) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [...available];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const e of byId.get(id).edges || []) stack.push(e);
  }
  return seen;
}

// Node choice/encounters still go through NodeMapScene.onNodeClick and RunManager.
// The route is drawn as the Loom (RouteGraph); selection is local presentation state
// until Travel commits it.
export class NodeMapMenu {
  constructor(scene) {
    this.scene = scene;
    this.root = element('section', null, 're re-screen re-node-map re-loom-screen');
    this.root.style.setProperty('--re-z', DOM_UI_DEPTHS.ROUTE);
    this.root.setAttribute('aria-label', 'Campaign route');
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        scene.requestCancel();
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    this.sync = () => {
      const s = this.scene;
      const hidden = !!(
        !s.isSceneReady ||
        s.shopOverlay ||
        s.churchOverlay ||
        s.colosseumOverlay?.visible ||
        s._colosseumLoading ||
        s.rosterOverlay?.visible ||
        s.pauseOverlay?.visible ||
        s.settingsOverlay?.visible ||
        // The Eclipse card is read over the loom it explains.
        (hasOpenOverlay(s) && !isTopOverlay(s, this._eclipseCard?.surface?.token)) ||
        s.isTransitioning ||
        s.battleLaunchInFlight
      );
      if (this.root.hidden !== hidden || this.ownsInput == null) {
        this.root.hidden = hidden;
        if (hidden) popInputScope(this);
        else
          pushInputScope(this, (action, payload) => {
            if ([InputAction.CANCEL, InputAction.PAUSE].includes(action)) scene.requestCancel();
            if (action === InputAction.ROSTER) scene._openRoster();
            if (action === InputAction.NAVIGATE) {
              const nodes = [...this.root.querySelectorAll('button:not(:disabled)')];
              const i = nodes.indexOf(document.activeElement),
                d = payload?.dy || payload?.dx || 1;
              nodes[(i + d + nodes.length) % nodes.length]?.focus();
            }
            if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
              document.activeElement.click();
          });
        this.ownsInput = !hidden;
        // Glints and vision dashes only run while the route can be seen.
        this.routeGraph?.setActive(!hidden);
        if (!hidden)
          this.root.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
      const reduced = this._reducedMotion();
      if (reduced !== this._lastReduced) {
        this._lastReduced = reduced;
        this.routeGraph?.refreshMotion();
      }
      this._syncEclipseFalls(hidden);
    };
    scene.events.on('postupdate', this.sync);
    this.shutdown = () => this.destroy();
    scene.events.once('shutdown', this.shutdown);
  }

  _reducedMotion() {
    // The settings read parses storage; sync() and the fx loop ask every frame.
    this._readReduced ||= throttledRead(
      () => !!this.scene.registry?.get?.('settings')?.getReduceMotion?.(),
    );
    return this._readReduced();
  }

  _available() {
    const rm = this.scene.runManager;
    const available = new Set(rm.getAvailableNodes().map((n) => n.id));
    for (const node of rm.nodeMap.nodes) if (rm.canReenterShop?.(node.id)) available.add(node.id);
    return available;
  }

  render() {
    const s = this.scene,
      rm = s.runManager,
      nodes = rm.nodeMap.nodes;
    const available = this._available();
    // The Eclipse: the act's fall state, and the falls whose ceremony has not played.
    this._playedFalls ||= new Set();
    const eclipse = rm.getEclipseView?.({ reachableIds: reachableFrom(nodes, available) }) || null;
    this.eclipseView = eclipse;
    const pendingFalls = new Set(
      (eclipse?.unseen || []).map((n) => n.id).filter((id) => !this._playedFalls.has(id)),
    );
    if (!nodes.some((n) => n.id === this.selected))
      this.selected = nodes.find((n) => available.has(n.id))?.id || nodes[0]?.id;
    const focus = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.node
      : null;
    // Preserve browsing position across selection, services and redraws of the same
    // act; a new act's loom anchors on its first choices.
    const sameMap = this._nodeMap === rm.nodeMap;
    const scroll = sameMap ? (this.routeGraph?.scrollLeft ?? null) : null;
    this._nodeMap = rm.nodeMap;
    this.routeGraph?.destroy();
    this.root.replaceChildren();

    const current = nodes.find((n) => n.id === rm.currentNodeId) ? rm.currentNodeId : null;
    this.routeGraph = createRouteGraph({
      nodes,
      startNodeId: rm.nodeMap.startNodeId,
      available,
      currentId: current,
      selectedId: this.selected,
      actId: rm.nodeMap.actId,
      reducedMotion: () => this._reducedMotion(),
      onSelect: (id) => this._select(id),
      eclipse,
      pendingFalls,
    });
    const model = this.routeGraph.model;

    const header = element('header', null, 're-header re-loom-header');
    const meta = element('div', null, 're-loom-meta');
    if (eclipse) meta.append(createEclipseMedallion(eclipse, () => this._openEclipse()));
    meta.append(
      element('span', `${Number(rm.gold || 0).toLocaleString('en-US')} G`, 're-loom-gold'),
    );
    meta.append(
      element(
        'span',
        `${rm.difficultyModifiers?.label || 'Normal'}${rm.noMetaMode ? ' · No upgrades' : ''}`,
        're-loom-diff',
      ),
    );
    header.classList.toggle('has-eclipse', !!eclipse);
    header.append(
      createLoomHeading({
        actId: rm.currentAct,
        actIndex: rm.actIndex,
        rows: model.rows,
        frontierRow: model.frontierRow,
      }),
      meta,
    );

    const layout = element('div', null, 're-node-layout');
    const wrap = element('div', null, 're-loom-wrap');
    this.scroll = element('div', null, 're-node-scroll');
    this.scroll.setAttribute('aria-label', 'Route threads');
    this.scroll.append(this.routeGraph.graph);
    const frame = element('div', null, 're-loom-frame');
    frame.setAttribute('aria-hidden', 'true');
    wrap.append(this.scroll, frame);
    const updateHints = () => {
      const el = this.scroll;
      wrap.classList.toggle('more-left', el.scrollLeft > 2);
      wrap.classList.toggle('more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    this.scroll.addEventListener('scroll', updateHints, { passive: true });

    // Pane order (README): Menu/Roster, inspect card, Travel, lord chips.
    const side = element('aside', null, 're-node-side');
    side.setAttribute('aria-label', 'Route actions');
    const actions = element('div', null, 're-node-actions');
    actions.append(
      button('Menu', () => s.requestCancel()),
      button('Roster', () => s._openRoster()),
    );
    this.detail = element('section', null, 're-scroll re-node-detail re-loom-card');
    this.detail.setAttribute('aria-live', 'polite');
    this.travel = button(
      null,
      () => {
        if (rm.pendingBattleReward && !s.isStoryInputLocked?.()) {
          s.openPendingRewards();
          return;
        }
        if (this._available().has(this.selected) && !s.isStoryInputLocked?.())
          s.onNodeClick(nodes.find((n) => n.id === this.selected));
        this.sync();
      },
      're-btn re-btn--primary re-loom-travel',
    );
    const party = element('div', null, 're-node-party re-loom-party');
    for (const unit of (rm.roster || []).filter((u) => u.isLord).slice(0, 2)) {
      const row = button(null, () => s._openRoster(), 're-btn re-node-unit');
      const key = rebuiltPortraitKey(s, unit);
      const pc98Id = usePc98() ? portraitIdForUnit(unit, s.gameData || {}) : null;
      if (pc98Id) {
        row.append(
          pc98PortraitElement({ id: pc98Id, size: 32, faction: portraitFaction(unit, pc98Id) }),
        );
      } else if (key) {
        const img = element('img');
        img.src = textureImageSource(s.textures.get(key));
        img.alt = '';
        row.append(img);
      }
      const info = element('span');
      const name = element('strong');
      name.append(
        element('span', unit.name),
        element('small', unit.className || '', 're-loom-class'),
      );
      const hp = element('small', `${unit.currentHP}/${unit.stats.HP}`);
      hp.append(element('span', ' HP', 're-loom-hp-unit'));
      info.append(name, hp, createHealthBar(unit));
      row.append(info);
      party.append(row);
    }
    side.append(actions, this.detail, this.travel, party);
    layout.append(wrap, side);
    this.root.append(header, layout);
    if (this._toast?.isConnected === false && this._toastUntil > Date.now())
      this.root.append(this._toast);

    this._renderSelection();
    this.routeGraph.mount(this.scroll, { scrollLeft: scroll ?? null });
    this.routeGraph.setActive(!this.root.hidden);
    updateHints();
    if (focus)
      [...this.root.querySelectorAll('[data-node]')]
        .find((b) => b.dataset.node === focus)
        ?.focus({ preventScroll: true });
    this.sync();
  }

  _select(id) {
    this.selected = id;
    this.routeGraph?.setSelected(id);
    this._renderSelection();
  }

  _renderSelection() {
    const s = this.scene,
      rm = s.runManager,
      nodes = rm.nodeMap.nodes;
    const available = this._available();
    const selected = nodes.find((n) => n.id === this.selected);
    const shopOpen = !!rm.canReenterShop?.(this.selected);
    renderLoomCard(this.detail, selected, {
      model: this.routeGraph.model,
      actId: rm.nodeMap.actId || rm.currentAct,
      gameData: s.gameData,
      runManager: rm,
      shopOpen,
      isFirstBattle: (node) => available.has(node.id),
      eclipse: this.eclipseView,
    });
    if (rm.pendingBattleReward)
      this.detail.append(
        element(
          'p',
          'Choose your remaining battle rewards before advancing. You can still review your roster and menu.',
          're-loom-note',
        ),
      );
    const label = rm.pendingBattleReward
      ? 'Return to rewards'
      : shopOpen
        ? 'Re-enter shop'
        : 'Travel';
    this.travel.replaceChildren(element('span', label));
    const enabled = !!rm.pendingBattleReward || available.has(this.selected);
    if (enabled && label === 'Travel') {
      const arrow = element('span', null, 're-loom-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      this.travel.append(arrow);
    }
    this.travel.disabled = !enabled;
  }

  // ── The Eclipse ──────────────────────────────────────────────────────

  _openEclipse() {
    const s = this.scene,
      rm = s.runManager;
    if (!this.eclipseView || this._eclipseCard) return;
    const config = rm.getEclipseConfig?.();
    this._eclipseCard = openEclipseCard(s, {
      view: this.eclipseView,
      config,
      kindlePrice: kindlePrice(rm.currentAct, config),
      onClose: () => {
        this._eclipseCard = null;
        this.root.querySelector('.re-eclipse-medal')?.focus({ preventScroll: true });
      },
    });
  }

  /**
   * The fall ceremony: once the loom is visible, newly fallen knots bleed to ink one
   * after another, then a single line names the loss. The fall is marked seen (and
   * saved) once it has played, so it never replays; covering the loom finishes it.
   */
  _syncEclipseFalls(hidden) {
    const graph = this.routeGraph;
    if (!graph) return;
    if (hidden) {
      if (this._falling) graph.finishFalls();
      return;
    }
    if (this._falling || !graph.pendingFalls.length) return;
    const ids = graph.pendingFalls;
    for (const id of ids) this._playedFalls.add(id);
    this._falling = true;
    void playCue(this.scene, 'eclipse', { waitMs: 400, duck: 0.35 });
    void graph.playFalls().then(() => {
      this._falling = false;
      this._finishFalls(ids);
    });
  }

  _finishFalls(ids) {
    const s = this.scene,
      rm = s?.runManager;
    if (!rm || this.destroyed) return;
    const fell = rm.nodeMap?.nodes?.filter((n) => ids.includes(n.id)) || [];
    if (rm.markEclipseSeen?.(ids)) s.persistRunSave?.();
    this._showToast(fallToastText(fell, rm.getEclipseConfig?.()));
    // First fall of the save: teach it once, after the line above has been read.
    const hints = s.registry?.get?.('hints');
    if (hints?.shouldShow?.('eclipse_first_fall')) {
      const teach = () => {
        if (this.destroyed || s.scene?.isActive?.() === false) return;
        void showMinorHint(
          s,
          'Time spent in battle darkens the Hollow Sun. When the dark takes a place, it becomes a harder battle with elite spoils. Tap the Eclipse to see what falls next.',
        );
      };
      if (s.time?.delayedCall) s.time.delayedCall(ECLIPSE_TOAST_MS * 0.6, teach);
      else teach();
    }
  }

  _showToast(text) {
    if (!text) return;
    this._toast?.remove();
    const toast = element('p', text, 're-eclipse-toast');
    toast.setAttribute('role', 'status');
    this._toast = toast;
    this._toastUntil = Date.now() + ECLIPSE_TOAST_MS;
    this.root.append(toast);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.remove();
      if (this._toast === toast) this._toast = null;
    }, ECLIPSE_TOAST_MS);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._toastTimer);
    this._eclipseCard?.destroy();
    this._eclipseCard = null;
    popInputScope(this);
    this.routeGraph?.destroy();
    this.routeGraph = null;
    this.scene.events.off('postupdate', this.sync);
    this.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
  }
}
