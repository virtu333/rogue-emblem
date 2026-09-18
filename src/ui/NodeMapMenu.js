import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { element, button } from './MenuSurface.js';
import { ACT_CONFIG } from '../utils/constants.js';
import { hasOpenOverlay } from '../utils/overlayStack.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { createHealthBar } from './healthBar.js';
import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import { textureImageSource } from './textureImageSource.js';

import { createRouteGraph, nodeLabel } from './RouteGraph.js';

// Node choice/encounters still go through NodeMapScene.onNodeClick and RunManager.
export class NodeMapMenu {
  constructor(scene) {
    this.scene = scene;
    this.root = element('section', null, 're re-screen re-node-map');
    this.root.style.setProperty('--re-z', DOM_UI_DEPTHS.ROUTE);
    this.root.setAttribute('aria-label', 'Campaign route');
    for (const type of ['pointerdown', 'pointerup', 'click', 'wheel'])
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
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
        hasOpenOverlay(s) ||
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
        if (!hidden)
          this.root.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
    };
    scene.events.on('postupdate', this.sync);
    this.shutdown = () => this.destroy();
    scene.events.once('shutdown', this.shutdown);
  }
  render() {
    const s = this.scene,
      rm = s.runManager,
      nodes = rm.nodeMap.nodes;
    const available = new Set(rm.getAvailableNodes().map((n) => n.id));
    if (!nodes.some((n) => n.id === this.selected))
      this.selected = nodes.find((n) => available.has(n.id))?.id || nodes[0]?.id;
    const focus = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.node
      : null;
    const scroll = this.scroll?.scrollTop;
    this.root.replaceChildren();
    const header = element('header', null, 're-header');
    header.append(
      element('h2', `Act ${rm.actIndex + 1} · ${ACT_CONFIG[rm.currentAct]?.name || 'Campaign'}`),
      element(
        'span',
        `${rm.gold} G · ${rm.difficultyModifiers?.label || 'Normal'}${rm.noMetaMode ? ' · No upgrades' : ''}`,
      ),
    );
    const layout = element('div', null, 're-node-layout');
    this.scroll = element('div', null, 're-node-scroll');
    const { graph, height } = createRouteGraph({
      nodes,
      available,
      selectedId: this.selected,
      actId: rm.nodeMap.actId,
      onSelect: (id) => {
        this.selected = id;
        this.render();
      },
    });
    this.scroll.append(graph);
    const side = element('aside', null, 're-node-side');
    const actions = element('div', null, 're-node-actions');
    actions.append(
      button('Menu', () => s.requestCancel()),
      button('Roster', () => s._openRoster()),
    );
    const selected = nodes.find((n) => n.id === this.selected);
    const detail = element('div', null, 're-scroll re-node-detail');
    if (selected) {
      detail.append(element('h3', nodeLabel(selected)));
      const copy = {
        shop: 'Buy, sell and forge equipment.',
        church: 'Heal, revive allies and promote units.',
        ruins: 'Supplies and services among the ruins.',
        colosseum: 'Arena and mercenary board.',
        recruit: 'Battle with a potential ally.',
      };
      detail.append(
        element(
          'p',
          copy[selected.type] ||
            `Objective: ${selected.battleParams?.objective || (selected.type === 'boss' ? 'seize' : 'rout')}`,
        ),
      );
      detail.append(
        element(
          'p',
          selected.completed
            ? 'Completed'
            : available.has(selected.id)
              ? 'Available route'
              : 'Reach this node along a connected route.',
          're-node-state',
        ),
      );
    }
    const advance = button(
      'Advance',
      () => {
        if (available.has(this.selected) && !s.isStoryInputLocked?.())
          s.onNodeClick(nodes.find((n) => n.id === this.selected));
        this.sync();
      },
      're-btn re-btn--primary',
    );
    advance.disabled = !available.has(this.selected);
    const party = element('div', null, 're-node-party re-scroll');
    for (const unit of (rm.roster || []).filter((u) => u.isLord).slice(0, 2)) {
      const row = button(null, () => s._openRoster(), 're-btn re-node-unit');
      const key = rebuiltPortraitKey(s, unit);
      if (key) {
        const img = element('img');
        img.src = textureImageSource(s.textures.get(key));
        img.alt = '';
        row.append(img);
      }
      const info = element('span');
      info.append(
        element('strong', unit.name),
        element('small', `${unit.currentHP}/${unit.stats.HP} HP`),
        createHealthBar(unit),
      );
      row.append(info);
      party.append(row);
    }
    side.append(actions, detail, advance, party);
    layout.append(this.scroll, side);
    this.root.append(header, layout);
    const selectedRow = nodes.find((n) => n.id === this.selected)?.row || 0;
    this.scroll.scrollTop =
      scroll ?? Math.max(0, height - 28 - selectedRow * 64 - this.scroll.clientHeight / 2);
    if (focus)
      [...this.root.querySelectorAll('[data-node]')]
        .find((b) => b.dataset.node === focus)
        ?.focus({ preventScroll: true });
    this.sync();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    popInputScope(this);
    this.scene.events.off('postupdate', this.sync);
    this.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
  }
}
