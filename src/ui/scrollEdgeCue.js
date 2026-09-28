// Scroll edge cues: keep classes on a scroll box saying which edges have more to
// scroll, so CSS can fade exactly those edges (a cut-off row then reads as "more this
// way", and a box that fits shows no fade). Classes: is-more-above / is-more-below
// (vertical) and is-more-left / is-more-right (horizontal).
//
// Follows scrolling, the box or its children changing size (fonts arriving, a row
// opening) and children being added or removed. Pure DOM, no Phaser.

export const EDGE_CLASSES = ['is-more-above', 'is-more-below', 'is-more-left', 'is-more-right'];

/** Which edges of `box` have more content past them (1 px of slack for rounding). */
export function scrollEdges(box) {
  const moreY = box.scrollHeight - box.clientHeight;
  const moreX = box.scrollWidth - box.clientWidth;
  return {
    above: moreY > 1 && box.scrollTop > 1,
    below: moreY > 1 && box.scrollTop < moreY - 1,
    left: moreX > 1 && box.scrollLeft > 1,
    right: moreX > 1 && box.scrollLeft < moreX - 1,
  };
}

/** Start tracking `box`. Returns { update, destroy }. */
export function trackScrollEdges(box) {
  if (!box) return { update() {}, destroy() {} };
  const update = () => {
    const edges = scrollEdges(box);
    box.classList.toggle('is-more-above', edges.above);
    box.classList.toggle('is-more-below', edges.below);
    box.classList.toggle('is-more-left', edges.left);
    box.classList.toggle('is-more-right', edges.right);
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  const observeAll = () => {
    if (!resize) return;
    resize.disconnect();
    resize.observe(box);
    for (const child of box.children) resize.observe(child);
  };
  const mutations =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          observeAll();
          update();
        })
      : null;
  box.addEventListener('scroll', update, { passive: true });
  mutations?.observe(box, { childList: true });
  observeAll();
  update();
  return {
    update,
    destroy() {
      box.removeEventListener('scroll', update);
      resize?.disconnect();
      mutations?.disconnect();
      box.classList.remove(...EDGE_CLASSES);
    },
  };
}
