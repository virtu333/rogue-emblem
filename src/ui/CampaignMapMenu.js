import { MenuSurface, element } from './MenuSurface.js';
import { createRouteGraph } from './RouteGraph.js';
import { createLoomHeading, renderLoomCard } from './LoomPanels.js';
import { ACT_SEQUENCE } from '../utils/constants.js';
import { throttledRead } from '../utils/throttledRead.js';

// Read-only counterpart of the travel screen, drawn as the same Loom. Selection only
// inspects; it never advances the run.
export class CampaignMapMenu {
  constructor(controller) {
    this.controller = controller;
    this.selected = controller.activeNodeId || controller.currentNodeId;
    this.surface = new MenuSurface(controller.scene, 'Campaign map', () => controller.hide());
    this.surface.root.classList.add('re-campaign-map', 're-loom-screen');
    this.render();
  }

  _reducedMotion() {
    this._readReduced ||= throttledRead(() => {
      const scene = this.controller.scene;
      if (typeof scene?._reduceMotion === 'function') return !!scene._reduceMotion();
      return !!scene?.registry?.get?.('settings')?.getReduceMotion?.();
    });
    return this._readReduced();
  }

  render() {
    const c = this.controller;
    const nodes = c.nodeMap?.nodes || [];
    const partyId = c.activeNodeId || c.currentNodeId || null;
    const party = nodes.find((n) => n.id === partyId) || null;
    if (!nodes.some((n) => n.id === this.selected))
      this.selected = party?.id || nodes.find((n) => n.row === 0)?.id || nodes[0]?.id;
    this.routeGraph?.destroy();
    // The Eclipse as committed so far (a battle's shadow lands only at its victory).
    const rm = c.scene?.runManager;
    this.eclipse =
      rm?.nodeMap === c.nodeMap
        ? rm?.getEclipseView?.({ activeNodeId: c.activeNodeId || null }) || null
        : null;
    this.routeGraph = createRouteGraph({
      nodes,
      startNodeId: c.nodeMap?.startNodeId,
      // The knots after the party's position: the next choices once this stop is done.
      available: new Set(
        party ? party.edges || [] : c.nodeMap?.startNodeId ? [c.nodeMap.startNodeId] : [],
      ),
      currentId: party?.id || null,
      currentLabel: party && !party.completed ? 'Current battle' : 'You are here',
      selectedId: this.selected,
      actId: c.actId,
      reducedMotion: () => this._reducedMotion(),
      eclipse: this.eclipse,
      onSelect: (id) => {
        this.selected = id;
        this.routeGraph.setSelected(id);
        this._renderCard();
      },
    });
    const model = this.routeGraph.model;
    const heading = createLoomHeading({
      actId: c.actId,
      actIndex: Math.max(0, ACT_SEQUENCE.indexOf(c.actId)),
      rows: model.rows,
      frontierRow: model.frontierRow,
      prefix: 'Campaign map',
    });
    // The act title replaces the plain header text (the dialog keeps its
    // "Campaign map" name through aria-label).
    (this.heading || this.surface.header.querySelector('h2'))?.replaceWith(heading);
    this.heading = heading;
    this.surface.header.classList.add('re-loom-header');
    const layout = element('div', null, 're-node-layout');
    const wrap = element('div', null, 're-loom-wrap');
    this.scroll = element('div', null, 're-node-scroll');
    this.scroll.setAttribute('aria-label', 'Route threads');
    this.scroll.append(this.routeGraph.graph);
    const frame = element('div', null, 're-loom-frame');
    frame.setAttribute('aria-hidden', 'true');
    wrap.append(this.scroll, frame);
    const side = element('aside', null, 're-node-side re-campaign-side');
    this.card = element('section', null, 're-scroll re-node-detail re-loom-card');
    this.card.setAttribute('aria-live', 'polite');
    side.append(
      this.card,
      element(
        'p',
        'Route overview. Close to return to your current location.',
        're-loom-note re-node-state',
      ),
    );
    layout.append(wrap, side);
    this.surface.body.replaceChildren(layout);
    this._renderCard();
    // Edge cues only on the upright loom: the sideways Campaign Map never had them.
    this.routeGraph.mount(this.scroll, { cues: wrap, horizontalCues: false });
  }

  _renderCard() {
    const c = this.controller;
    const nodes = c.nodeMap?.nodes || [];
    const node = nodes.find((n) => n.id === this.selected);
    const party = nodes.find((n) => n.id === (c.activeNodeId || c.currentNodeId));
    renderLoomCard(this.card, node, {
      model: this.routeGraph.model,
      actId: c.actId,
      gameData: c.scene?.gameData,
      runManager: c.scene?.runManager,
      activeLabel: party && !party.completed ? 'The party fights here' : null,
      isFirstBattle: (n) => n.id === party?.id,
      eclipse: this.eclipse,
    });
  }

  destroy() {
    this.routeGraph?.destroy();
    this.routeGraph = null;
    this.surface.destroy();
  }
}
