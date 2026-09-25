// Design review page for the runtime item art (served by the Vite dev server):
//   /tools/art/icons/gallery.html            every icon, socketed, at 16/32/48
//   /tools/art/icons/gallery.html?heroes=1   every hero picture at 96
//   ?only=weapon,scroll  filter by socket     ?size=32  one size only
import '../../../src/ui/styles.css';
import { ITEM_ICON_MANIFEST as M, itemIcon, itemHero } from '../../../src/ui/itemIcons.js';
import '../../../src/ui/uiTokens.css';

const q = new URLSearchParams(location.search);
const only = q.get('only')?.split(',');
const sizes = q.get('size') ? [Number(q.get('size'))] : [16, 32, 48];
const heroes = q.get('heroes');
const root = document.getElementById('root');
const bySocket = {};
for (const [id, [, s]] of Object.entries(M.icons)) (bySocket[M.sockets[s]] ||= []).push(id);
for (const [socket, ids] of Object.entries(bySocket)) {
  if (only && !only.includes(socket)) continue;
  const h = document.createElement('h2');
  h.textContent = `${socket} · ${ids.length}`;
  const row = document.createElement('div');
  row.className = 'row';
  for (const id of ids) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (heroes) {
      cell.style.width = '120px';
      cell.append(itemHeroFor(id));
    } else {
      const s = document.createElement('div');
      s.className = 'sizes';
      for (const size of sizes) s.append(iconFor(id, size));
      cell.append(s);
    }
    const label = document.createElement('small');
    label.textContent = id;
    cell.append(label);
    row.append(cell);
  }
  root.append(h, row);
}

// The gallery addresses icons by id: a stand-in subject whose name slugs to the id.
function subjectFor(id) {
  if (id.startsWith('blessing-')) return [{ id: id.slice(9), boons: [] }, 'blessing'];
  if (id.startsWith('upgrade-'))
    return [{ id: id.slice(8), category: 'x', maxLevel: 1 }, 'upgrade'];
  if (id === 'gold') return [{ type: 'gold' }, 'gold'];
  if (id.startsWith('generic-')) return [{ name: id }, undefined];
  return [{ name: id.replace(/-/g, ' ') }, undefined];
}
function iconFor(id, size) {
  const [subject, kind] = subjectFor(id);
  return itemIcon(subject, { size, kind });
}
function itemHeroFor(id) {
  const [subject, kind] = subjectFor(id);
  return itemHero(subject, { size: 96, kind });
}
