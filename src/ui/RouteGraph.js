import { element, button } from './MenuSurface.js';
import { createNodeArt } from './NodeArt.js';

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
export function nodeFrame(node, act) {
  return node.type === 'boss' && act === 'finalBoss'
    ? 8
    : node.battleParams?.isElite
      ? 7
      : (FRAMES[node.type] ?? 0);
}
export function nodeLabel(node) {
  return node.battleParams?.isElite ? 'Elite battle' : LABELS[node.type] || node.type;
}

export function createRouteGraph({
  nodes,
  available = new Set(),
  selectedId,
  activeId,
  actId,
  onSelect,
  horizontal = false,
}) {
  const graph = element('div', null, 're-node-graph');
  const rows = Math.max(1, ...nodes.map((n) => n.row));
  const height = horizontal ? 260 : Math.max(260, (rows + 1) * 64);
  const width = horizontal ? 56 + rows * 64 : 500;
  if (horizontal) {
    graph.classList.add('re-node-graph--horizontal');
    graph.style.minWidth = `${width}px`;
  }
  graph.style.height = horizontal ? '100%' : `${height}px`;
  if (horizontal) graph.style.minHeight = '240px';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const positions = new Map(
    nodes.map((n) => [
      n.id,
      horizontal
        ? { x: 28 + n.row * 64, y: 28 + n.col * 50 }
        : { x: 42 + n.col * 104, y: 36 + (rows - n.row) * 64 },
    ]),
  );
  for (const n of nodes)
    for (const edge of n.edges) {
      const a = positions.get(n.id),
        b = positions.get(edge);
      if (!b) continue;
      const line = document.createElementNS(svg.namespaceURI, 'line');
      for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }))
        line.setAttribute(key, String(value));
      line.setAttribute('class', n.completed && available.has(edge) ? 'route-next' : '');
      svg.append(line);
    }
  graph.append(svg);
  nodes.forEach((n) => {
    const pos = positions.get(n.id),
      label = nodeLabel(n);
    const state =
      n.id === activeId
        ? 'Current battle'
        : n.completed
          ? 'Completed'
          : available.has(n.id)
            ? 'Available'
            : 'Future';
    const b = button(
      null,
      () => {
        onSelect(n.id);
      },
      're-node',
    );
    b.dataset.node = n.id;
    b.setAttribute('aria-label', `${label} · ${state} · row ${n.row + 1} lane ${n.col + 1}`);
    b.setAttribute('aria-pressed', String(n.id === selectedId));
    b.classList.toggle('is-completed', !!n.completed);
    b.classList.toggle('is-available', available.has(n.id));
    b.classList.toggle('is-future', state === 'Future');
    b.style.left = `${(pos.x / width) * 100}%`;
    b.style.top = horizontal ? `${(pos.y / height) * 100}%` : `${pos.y}px`;
    const icon = createNodeArt(nodeFrame(n, actId), horizontal ? 30 : 44);
    b.append(icon);
    graph.append(b);
  });

  return { graph, height };
}
