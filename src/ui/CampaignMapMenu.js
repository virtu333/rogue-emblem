import { MenuSurface, element } from './MenuSurface.js';
import { createRouteGraph, nodeLabel } from './RouteGraph.js';
import { ACT_CONFIG } from '../utils/constants.js';

// Read-only counterpart of the travel screen. Selection never advances the run.
export class CampaignMapMenu {
  constructor(controller) {
    this.controller = controller;
    this.selected = controller.activeNodeId || controller.currentNodeId;
    this.surface = new MenuSurface(controller.scene, 'Campaign map', () => controller.hide());
    this.surface.root.classList.add('re-campaign-map');
    this.render();
  }
  render() {
    const c = this.controller;
    const nodes = c.nodeMap?.nodes || [];
    const active = nodes.find((n) => n.id === c.activeNodeId);
    const current = nodes.find((n) => n.id === this.selected);
    const oldScroll = this.scroll?.scrollTop;
    const focus = this.surface.root.contains(document.activeElement)
      ? document.activeElement.dataset.node
      : null;
    const layout = element('div', null, 're-node-layout');
    this.scroll = element('div', null, 're-node-scroll');
    const { graph, height } = createRouteGraph({
      nodes,
      available: new Set(active?.edges || []),
      selectedId: this.selected,
      activeId: c.activeNodeId,
      actId: c.actId,
      onSelect: (id) => {
        this.selected = id;
        this.render();
      },
    });
    this.scroll.append(graph);
    const detail = element('aside', null, 're-scroll re-node-detail');
    detail.append(element('h3', ACT_CONFIG[c.actId]?.name || 'Campaign'));
    if (current) {
      detail.append(element('p', nodeLabel(current)));
      detail.append(
        element(
          'p',
          current.id === c.activeNodeId
            ? 'Current location'
            : current.completed
              ? 'Completed'
              : 'Upcoming encounter',
        ),
      );
    }
    detail.append(
      element('p', 'Route overview. Close to return to your current location.', 're-node-state'),
    );
    layout.append(this.scroll, detail);
    this.surface.body.replaceChildren(layout);
    this.scroll.scrollTop = oldScroll ?? Math.max(0, height - 130 - (active?.row || 0) * 64);
    if (focus)
      [...graph.querySelectorAll('[data-node]')]
        .find((b) => b.dataset.node === focus)
        ?.focus({ preventScroll: true });
  }
  destroy() {
    this.surface.destroy();
  }
}
