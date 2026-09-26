// The keyword row every DOM item card shows under the item's name: the base line
// ("Silver Lance", "Relic Sword") and the rule tags ("Crit 30", "Beats Axes").
// The words come from engine/ItemKeywords.js; this only draws them.
import './itemKeywords.css';
import { itemKeywords, itemBaseLineFor } from '../engine/ItemKeywords.js';

/**
 * A `span.re-item-keys` for `item`, or null when there is nothing to show.
 * Options: `displayName` (the name the card shows, so a base line the name
 * already says is left out), `baseLine: false` where the surface already names
 * the tier and type (the shop kicker), `make(tag)` for a view's own factory.
 */
export function itemKeywordRow(
  item,
  { displayName = item?.name, baseLine = true, make = (tag) => document.createElement(tag) } = {},
) {
  const tags = itemKeywords(item);
  const base = baseLine ? itemBaseLineFor(item, displayName) : null;
  if (!tags.length && !base) return null;
  // Spans throughout: the row also sits inside buttons (reward cards), which take
  // phrasing content only; roles keep the tags a list for screen readers.
  const row = make('span');
  row.className = 're-item-keys';
  if (base) {
    const b = make('span');
    b.className = 're-item-base';
    b.textContent = base;
    row.append(b);
  }
  if (tags.length) {
    const list = make('span');
    list.className = 're-item-tags';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Rules');
    for (const tag of tags) {
      const li = make('span');
      li.setAttribute('role', 'listitem');
      li.className = `re-item-tag is-${tag.tone}`;
      li.dataset.keyword = tag.id;
      li.textContent = tag.text;
      li.title = tag.title;
      list.append(li);
    }
    row.append(list);
  }
  return row;
}

/** The tag texts joined for a line of plain text ("Crit 30 · Thrown"), or ''. */
export function itemKeywordText(item) {
  return itemKeywords(item)
    .map((tag) => tag.text)
    .join(' · ');
}
