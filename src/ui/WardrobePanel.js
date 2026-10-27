// WardrobePanel.js - the Home Base Wardrobe tab (docs/specs/lord-outfits.md): buy a lord's
// outfit with Valor and choose what each lord wears. Presentation only: the words come from
// ui/wardrobeModel.js and every change is a meta command, saved there.
import { LORD_OUTFIT_CATALOG, outfitPortraitId } from '../engine/LordOutfits.js';
import { hasPc98, pc98PortraitElement, usePc98 } from './portraitArt.js';
import { buyLabel, wardrobeBlockText, wardrobeLead, wardrobeRows } from './wardrobeModel.js';

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export class WardrobePanel {
  /** @param {import('./MobileHomeBase.js').MobileHomeBase} home */
  constructor(home, catalog = LORD_OUTFIT_CATALOG) {
    this.home = home;
    this.meta = home.meta;
    this.catalog = catalog;
    this.focusLord = null;
    this.confirmBuy = null; // outfit id awaiting its second tap
  }

  rerender(focus = null, message = null) {
    if (message != null) this.home.message = message;
    this.home.render(focus);
  }

  button(label, action, { pressed = null, focus = null, cls = null, disabled = false } = {}) {
    const b = this.home.button(label, action, pressed);
    if (cls) b.className = cls;
    if (focus) b.dataset.focus = focus;
    b.disabled = disabled;
    return b;
  }

  /** A lord's face in one look (`outfitId` null: the lord's own). */
  face(lordName, outfitId, size) {
    const own = `lord_${lordName.toLowerCase()}`;
    const id =
      outfitId && hasPc98(outfitPortraitId(lordName, outfitId))
        ? outfitPortraitId(lordName, outfitId)
        : own;
    if (usePc98() && hasPc98(id))
      return pc98PortraitElement({
        id,
        size,
        faction: 'ember',
        className: 'mh-portrait',
        alt: lordName,
      });
    return this.home.portrait({ name: lordName }, size);
  }

  /** Fill the tab's list and detail. */
  render(list, copy) {
    const lords = this.home.scene.gameData?.lords || [];
    const rows = wardrobeRows(this.meta, lords, this.catalog);
    list.append(node('p', 'mu-help wd-lead', wardrobeLead(this.catalog.price)));
    if (!rows.some((r) => r.lord === this.focusLord)) this.focusLord = rows[0]?.lord || null;
    for (const r of rows) {
      const b = this.button(
        '',
        () => {
          this.focusLord = r.lord;
          this.confirmBuy = null;
          this.rerender(`wd-${r.lord}`);
        },
        { pressed: r.lord === this.focusLord, focus: `wd-${r.lord}`, cls: 'mh-lord' },
      );
      b.append(
        this.face(r.lord, r.worn ? r.outfit.id : null, 48),
        node('strong', '', r.lord),
        node('span', '', r.status),
      );
      list.append(b);
    }
    const row = rows.find((r) => r.lord === this.focusLord);
    if (row) this.renderDetail(copy, row);
  }

  renderDetail(copy, r) {
    const looks = node('div', 'wd-looks');
    for (const [outfitId, caption] of [
      [null, 'Own look'],
      [r.outfit.id, r.outfit.name],
    ]) {
      const look = node('figure', 'wd-look');
      look.append(this.face(r.lord, outfitId, 96), node('figcaption', '', caption));
      looks.append(look);
    }
    // The Buy or Wear buttons come first, so a short landscape phone shows them unscrolled.
    copy.append(node('h2', '', `${r.lord} · ${r.outfit.name}`));
    this.renderActions(copy, r);
    copy.append(looks, node('p', 'mu-help', r.outfit.description));
  }

  renderActions(copy, r) {
    if (!r.owned) {
      if (r.blockText) copy.append(node('p', 'mu-requirements', r.blockText));
      const confirming = this.confirmBuy === r.outfit.id;
      copy.append(
        this.button(
          buyLabel(r.price, confirming),
          () => {
            if (!confirming) {
              this.confirmBuy = r.outfit.id;
              this.rerender(`wd-buy-${r.outfit.id}`);
              return;
            }
            this.confirmBuy = null;
            const result = this.meta.buyLordOutfit(r.outfit.id);
            this.rerender(
              `wd-wear-own-${r.lord}`,
              result.ok
                ? `${r.lord} now wears ${r.outfit.name}.`
                : wardrobeBlockText(result.reason, {
                    lord: r.lord,
                    price: r.price,
                    held: this.meta.getTotalValor(),
                  }),
            );
          },
          { focus: `wd-buy-${r.outfit.id}`, cls: 'mu-buy', disabled: Boolean(r.block) },
        ),
      );
      return;
    }
    const wear = (outfitId, text) => {
      const result = this.meta.setLordOutfit(r.lord, outfitId);
      this.rerender(
        outfitId ? `wd-wear-own-${r.lord}` : `wd-wear-${r.outfit.id}`,
        result.ok ? text : wardrobeBlockText(result.reason),
      );
    };
    copy.append(
      this.button(
        r.worn ? `Wearing ${r.outfit.name}` : `Wear ${r.outfit.name}`,
        () => wear(r.outfit.id, `${r.lord} now wears ${r.outfit.name}.`),
        { focus: `wd-wear-${r.outfit.id}`, pressed: r.worn, disabled: r.worn },
      ),
      this.button(
        r.worn ? 'Wear own look' : 'Wearing own look',
        () => wear(null, `${r.lord} wears the usual look again.`),
        { focus: `wd-wear-own-${r.lord}`, pressed: !r.worn, disabled: !r.worn },
      ),
    );
  }
}
