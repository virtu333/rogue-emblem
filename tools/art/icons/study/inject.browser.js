// Browser-side decorators for the items study mockups. Evaluated in the real game page
// after a screen driver has opened a surface; they only add presentation (icons, sockets,
// vignettes, cards) on top of the live DOM and never touch game state.
// window.__IA = { icons: { group: { name: { 24, 32, 48 } } }, art: { id: url }, lore: {name: text} }
(() => {
  const IA = window.__IA;
  const TIER = {
    Iron: '#7a7a80',
    Steel: '#77a5c6',
    Silver: '#ddd0bd',
    Legend: '#f3cb6c',
    Rare: '#a863cc',
  };
  const css = `
  .ia-socket { position: relative; flex: none; display: grid; place-items: center; width: var(--s, 40px); height: var(--s, 40px);
    background: radial-gradient(circle at 34% 30%, #2e293a 0, #1a1720 62%, #110f16 100%);
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
    box-shadow: inset 0 0 0 1px #403949, inset 1px 1px 0 1px var(--tier, #58505e); }
  .ia-socket img { image-rendering: pixelated; width: var(--i, 32px); height: var(--i, 32px); }
  [aria-pressed="true"] .ia-socket, .ia-hot .ia-socket { box-shadow: inset 0 0 0 1px #b3702c, inset 1px 1px 0 1px var(--tier, #dca044), 0 0 10px -2px #dca04488;
    background: radial-gradient(circle at 34% 30%, #4f2c16 0, #2a170e 55%, #16131e 100%); }
  .ia-row { display: grid !important; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; text-align: left; }
  .mu-screen .reward-card.ia-row { grid-template-columns: auto minmax(0, 1fr); }
  .ia-row > .ia-socket { grid-row: 1 / span 3; }
  .ia-row > :not(.ia-socket) { grid-column: 2; }
  .ia-hero { display: flex; gap: 14px; align-items: center; margin-bottom: 8px; }
  .ia-hero .ia-socket { --s: 104px; --i: 96px; }
  .ia-hero .ia-socket::before { content: ''; position: absolute; inset: 10px; border-radius: 50%;
    background: radial-gradient(circle, transparent 54%, #f3cb6c55 57%, transparent 62%), radial-gradient(circle, #dca04422, transparent 70%); }
  .ia-hero img { position: relative; }
  .ia-kicker { font: 8px 'Press Start 2P', monospace; letter-spacing: .06em; color: var(--tier, #978b94); text-transform: uppercase; }
  .ia-lore { font-style: italic; color: #bdb0aa; border-left: 2px solid #80461f; padding-left: 8px; margin: 6px 0; }
  .ia-vhost { isolation: isolate; overflow: hidden; }
  .re-live-menu.ia-vhost .re-menu-body .re-btn:not(.re-btn--primary):not([aria-pressed="true"]) { background: #17141fb8; backdrop-filter: blur(1px); }
  .ia-vhost > .ia-vignette, .re-live-menu > .ia-vignette, .mu-screen > .ia-vignette { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
  .ia-vignette img { position: absolute; right: 0; top: 0; height: 100%; width: auto; min-width: 60%; object-fit: cover; image-rendering: pixelated; opacity: var(--vo, .5); }
  .ia-vignette::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #0e0c14 22%, #0e0c14cc 42%, #0e0c1466 70%, #0e0c1422), linear-gradient(0deg, #0e0c14 0, transparent 30%); }
  .ia-band { position: relative; height: var(--bh, 150px); margin: -2px 0 8px; overflow: hidden; flex: none;
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%); box-shadow: inset 0 -1px 0 #80461f; }
  .ia-band img { width: 100%; height: 100%; object-fit: cover; object-position: 70% 50%; image-rendering: pixelated; }
  .ia-band::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #0e0c14ee 0, #0e0c1488 30%, transparent 60%); }
  .ia-band h3 { position: absolute; left: 16px; bottom: 14px; z-index: 1; font: 700 22px 'Cinzel', serif; letter-spacing: .12em; color: #f3cb6c; text-transform: uppercase; text-shadow: 0 2px 0 #0e0c14; }
  .ia-band small { position: absolute; left: 17px; bottom: 44px; z-index: 1; font: 8px 'Press Start 2P'; color: #bdb0aa; letter-spacing: .06em; }
  .ia-spark { position: absolute; width: 2px; height: 2px; background: #fff0bd; box-shadow: 0 0 4px #f3cb6c; z-index: 1; }
  .re-live-menu, .mu-screen { isolation: isolate; }
  .re-live-menu > *, .mu-screen > * { position: relative; z-index: 1; }
  .ia-pips i { width: 9px !important; height: 9px !important; transform: rotate(45deg) scale(.8); background: #211d2b !important;
    box-shadow: inset 0 0 0 1px #58505e; border-radius: 0 !important; }
  .ia-pips i.filled { background: linear-gradient(135deg, #fff0bd, #dca044 45%, #80461f) !important; box-shadow: 0 0 5px #dca04499; }
  /* Blessing cards */
  .ia-cards { display: flex; gap: 12px; justify-content: center; align-items: stretch; flex: 1; min-height: 0; padding: 2px 4px 0; }
  .ia-card { --tier: #bdb0aa; position: relative; width: var(--cw, 196px); display: flex; flex-direction: column; gap: 4px; padding: 7px; cursor: pointer;
    background: linear-gradient(160deg, #211d2b, #110f16); color: #ddd0bd; border: 0; text-align: center; font: inherit;
    clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px);
    box-shadow: inset 0 0 0 2px var(--tier), inset 0 0 0 4px #0e0c14, inset 0 0 0 5px color-mix(in srgb, var(--tier) 45%, transparent); transition: transform .2s; }
  .ia-card[data-tier="2"] { --tier: #b3702c; } .ia-card[data-tier="3"] { --tier: #dca044; } .ia-card[data-tier="4"] { --tier: #f3cb6c; }
  .ia-card[aria-pressed="true"] { transform: translateY(-5px); box-shadow: inset 0 0 0 2px #f3cb6c, inset 0 0 0 4px #0e0c14, inset 0 0 0 5px #dca044, 0 0 18px -4px #dca044; }
  .ia-card .art { position: relative; flex: 1; min-height: 0; overflow: hidden; clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%, 0 6px); }
  .ia-card .art img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; display: block; }
  .ia-card .art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, #0e0c14 0, transparent 38%); }
  .ia-card .num { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); z-index: 2; font: 700 13px 'Cinzel', serif; color: var(--tier);
    background: #0e0c14cc; padding: 1px 9px; clip-path: polygon(5px 0, calc(100% - 5px) 0, 100% 50%, calc(100% - 5px) 100%, 5px 100%, 0 50%); }
  .ia-card[data-tier="4"] .num::before, .ia-card[data-tier="4"] .num::after { content: '·'; margin: 0 4px; }
  .ia-card .nm { position: absolute; left: 0; right: 0; bottom: 6px; z-index: 2; font: 700 15px 'Cinzel', serif; letter-spacing: .06em; color: #f4ecdb; text-shadow: 0 1px 0 #0e0c14, 0 0 8px #0e0c14; text-transform: uppercase; }
  .ia-card .boon { font-size: 12px; line-height: 1.25; min-height: 30px; color: #ddd0bd; }
  .ia-card .cost { display: flex; align-items: center; gap: 6px; justify-content: center; font-size: 11px; color: #ec7a5c; min-height: 22px; }
  .ia-card .cost i { width: 18px; height: 18px; flex: none; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #cc4038, #6e1a28 70%);
    box-shadow: 0 0 0 1px #22090f, inset 0 0 0 3px #9e2632; }
  .ia-card .cost.free { color: #86b27b; } .ia-card .cost.free i { background: radial-gradient(circle at 35% 30%, #86b27b, #2d6450 70%); box-shadow: 0 0 0 1px #0f2622, inset 0 0 0 3px #4d8b66; }
  .ia-cards.desk { align-items: center; gap: 22px; }
  .ia-cards.desk .ia-card { flex: none; }
  .ia-cards.desk .ia-card .art { flex: none; aspect-ratio: 2 / 3; }
  .ia-cards.desk .ia-card .nm { font-size: 19px; bottom: 10px; }
  .ia-cards.desk .ia-card .boon { font-size: 14px; min-height: 40px; padding: 2px 6px; }
  .ia-cards.desk .ia-card .cost { font-size: 13px; }
  .ia-skip { align-self: center; }
  /* Reward reveal */
  .ia-back { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center;
    background: radial-gradient(circle at 50% 50%, #0e0c14 0 13px, #f3cb6c 14px 15px, transparent 16px), repeating-linear-gradient(45deg, #1a1720 0 6px, #16131e 6px 12px);
    box-shadow: inset 0 0 0 1px #80461f; transition: transform .3s; }
  .ia-row > .ia-back { grid-column: 1 / span 2 !important; grid-row: 1 / span 3; }
  .ia-veil { position: absolute; inset: 0; z-index: 4; display: grid; place-content: center; justify-items: center; gap: 12px; text-align: center;
    background: radial-gradient(circle at 50% 42%, #0e0c14 0 34px, #f3cb6c 35px 37px, #dca04433 38px, transparent 70px), #16131e; color: #bdb0aa; }
  .ia-veil b { font: 700 18px 'Cinzel', serif; letter-spacing: .14em; color: #f3cb6c; margin-top: 90px; }
  .ia-flash { box-shadow: 0 0 0 1px #f3cb6c, 0 0 22px -2px #dca044 !important; }
  .ia-stamp { position: absolute; right: 18px; top: 16px; z-index: 5; font: 700 26px 'Cinzel', serif; letter-spacing: .14em; color: #f3cb6c;
    border: 2px solid #dca044; padding: 2px 12px; transform: rotate(-6deg); text-shadow: 0 0 10px #dca04499; background: #0e0c14cc; }
  `;
  if (!document.getElementById('ia-style')) {
    const st = document.createElement('style');
    st.id = 'ia-style';
    st.textContent = css;
    document.head.append(st);
  }
  const find = (name, groups) => {
    for (const g of groups) {
      const hit = IA.icons[g]?.[name];
      if (hit) return hit;
    }
    return null;
  };
  const socket = (urls, { s = 40, i = 32, tier } = {}) => {
    const d = document.createElement('span');
    d.className = 'ia-socket';
    d.style.setProperty('--s', `${s}px`);
    d.style.setProperty('--i', `${i}px`);
    if (tier) d.style.setProperty('--tier', TIER[tier] || tier);
    const img = document.createElement('img');
    img.alt = '';
    img.src = urls[i >= 48 ? 48 : i >= 32 ? 32 : 24] || urls[32];
    if (i === 96) img.src = urls[48];
    d.append(img);
    return d;
  };
  const vignette = (root, id, { opacity = 0.5 } = {}) => {
    if (!IA.art[id] || !root) return;
    root.classList.add('ia-vhost');
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    const v = document.createElement('div');
    v.className = 'ia-vignette';
    v.style.setProperty('--vo', opacity);
    v.innerHTML = `<img src="${IA.art[id]}" alt="">`;
    root.prepend(v);
  };
  const band = (parent, id, title, kicker, h = 150) => {
    if (!IA.art[id]) return;
    const b = document.createElement('div');
    b.className = 'ia-band';
    b.style.setProperty('--bh', `${h}px`);
    b.innerHTML = `<img src="${IA.art[id]}" alt=""><small>${kicker}</small><h3>${title}</h3>`;
    parent.prepend(b);
    return b;
  };
  const sparks = (host, n, seed = 7) => {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < n; k++) {
      const p = document.createElement('i');
      p.className = 'ia-spark';
      p.style.left = `${55 + r() * 40}%`;
      p.style.top = `${15 + r() * 70}%`;
      p.style.opacity = String(0.4 + r() * 0.6);
      host.append(p);
    }
  };
  const itemData = (name) => {
    const d = IA.items[name];
    return d || {};
  };

  window.__iaDecorate = {
    shop({ direction = 'pixel', vignetteId = 'shop', mobile = true } = {}) {
      const root = document.querySelector('.shop-menu');
      const groups = ['Weapons', 'Consumables', 'Accessories', 'Forge'];
      for (const row of root.querySelectorAll('.shop-row')) {
        if (row.querySelector('.ia-socket')) continue;
        const name = row.querySelector('strong')?.textContent;
        const urls = find(name, groups);
        row.classList.add('ia-row');
        if (urls)
          row.prepend(
            socket(urls, { s: 40, i: direction === 'sigil' ? 32 : 32, tier: itemData(name).tier }),
          );
      }
      const detail = root.querySelector('.shop-copy');
      const h3 = detail?.querySelector('h3');
      if (h3 && !detail.querySelector('.ia-hero')) {
        const name = h3.textContent;
        const urls = find(name, groups);
        const hero = document.createElement('div');
        hero.className = 'ia-hero';
        const meta = detail.querySelector('.shop-meta');
        const txt = document.createElement('div');
        const tier = itemData(name).tier;
        const kick = document.createElement('div');
        kick.className = 'ia-kicker';
        kick.style.setProperty('--tier', TIER[tier] || '#978b94');
        kick.textContent = [tier, itemData(name).type].filter(Boolean).join(' · ');
        txt.append(kick, h3);
        if (urls) hero.append(socket(urls, { s: mobile ? 64 : 104, i: mobile ? 48 : 96, tier }));
        hero.append(txt);
        detail.prepend(hero);
        meta?.remove();
        if (itemData(name).lore) {
          const lore = document.createElement('p');
          lore.className = 'ia-lore';
          lore.textContent = itemData(name).lore;
          hero.after(lore);
        }
      }
      if (vignetteId) {
        // Phone: the scene lives behind the detail pane (the list stays plain); desktop: a
        // header band over the whole service.
        if (mobile) {
          const pane = root.querySelector('.shop-detail');
          if (pane) pane.style.background = 'transparent';
          vignette(pane, vignetteId, { opacity: 0.5 });
          if (vignetteId === 'forge') sparks(pane.querySelector('.ia-vignette'), 22);
        } else {
          const b = band(
            root.querySelector('.re-menu-body'),
            vignetteId,
            vignetteId === 'forge' ? 'Forge' : root.getAttribute('aria-label') || '',
            vignetteId === 'forge' ? 'Forge · Whetstones · Imbues' : 'Buy · Sell · Forge',
            170,
          );
          if (vignetteId === 'forge' && b) sparks(b, 26);
        }
      }
    },
    rewards({ mobile = true, hidden = false, reveal = -1 } = {}) {
      const root = document.querySelector('.mu-screen');
      const groups = ['Weapons', 'Consumables', 'Accessories', 'Forge'];
      root.querySelectorAll('.reward-card').forEach((card, k) => {
        if (!card.querySelector('.ia-socket')) {
          let name = card.querySelector('strong')?.textContent || '';
          if (/gold/i.test(name)) name = 'Gold';
          const urls = find(name, groups);
          card.querySelector('.reward-glyph')?.remove();
          card.classList.add('ia-row');
          card.style.minHeight = mobile ? '58px' : '64px';
          if (urls)
            card.prepend(socket(urls, { s: mobile ? 48 : 56, i: 48, tier: itemData(name).tier }));
          const q = card.querySelector('.reward-quality');
          if (q) {
            q.classList.add('ia-kicker');
            q.style.setProperty('--tier', TIER[itemData(name).tier] || '#978b94');
          }
        }
        card.querySelector('.ia-back')?.remove();
        card.style.position = 'relative';
        if (hidden && k > reveal) {
          const back = document.createElement('span');
          back.className = 'ia-back';
          card.append(back);
        }
        if (k === reveal) card.classList.add('ia-flash');
      });
      if (hidden && reveal < 0) {
        const det = root.querySelector('.mu-detail');
        det.style.position = 'relative';
        const veil = document.createElement('div');
        veil.className = 'ia-veil';
        veil.innerHTML = '<b>SPOILS</b><span>Tap a card to turn it</span>';
        det.append(veil);
      }
      const copy = root.querySelector('.mu-detail .mu-copy');
      const h2 = copy?.querySelector('h2');
      if (h2 && !copy.querySelector('.ia-hero') && !(hidden && reveal < 0)) {
        let name = h2.textContent;
        if (/gold/i.test(name)) name = 'Gold';
        const urls = find(name, groups);
        const hero = document.createElement('div');
        hero.className = 'ia-hero';
        if (urls)
          hero.append(
            socket(urls, { s: mobile ? 64 : 104, i: mobile ? 48 : 96, tier: itemData(name).tier }),
          );
        const txt = document.createElement('div');
        const k = copy.querySelector('.mu-help');
        if (k) {
          k.classList.add('ia-kicker');
          k.style.setProperty('--tier', TIER[itemData(name).tier] || '#978b94');
          txt.append(k);
        }
        txt.append(h2);
        hero.append(txt);
        copy.prepend(hero);
        if (itemData(name).lore) {
          const lore = document.createElement('p');
          lore.className = 'ia-lore';
          lore.textContent = itemData(name).lore;
          hero.after(lore);
        }
      }
    },
    upgrades({ mobile = true, stamp = null } = {}) {
      const root = document.querySelector('.mu-screen');
      for (const row of root.querySelectorAll('.mu-row')) {
        if (row.querySelector('.ia-socket')) continue;
        const name = row.querySelector('strong')?.textContent;
        const urls = find(name, ['Upgrades']);
        row.classList.add('ia-row');
        if (urls) row.prepend(socket(urls, { s: 44, i: 32 }));
        row.querySelector('.mu-pips')?.classList.add('ia-pips');
      }
      const copy = root.querySelector('.mu-detail .mu-copy');
      const h2 = copy?.querySelector('h2');
      if (h2 && !copy.querySelector('.ia-hero')) {
        const urls = find(h2.textContent, ['Upgrades']);
        const hero = document.createElement('div');
        hero.className = 'ia-hero';
        if (urls) hero.append(socket(urls, { s: mobile ? 64 : 104, i: mobile ? 48 : 96 }));
        hero.append(h2);
        copy.prepend(hero);
      }
      if (stamp) {
        const detail = root.querySelector('.mu-detail');
        detail.style.position = 'relative';
        const st = document.createElement('div');
        st.className = 'ia-stamp';
        st.textContent = stamp;
        detail.append(st);
        const row = root.querySelector('.mu-row');
        row?.classList.add('ia-hot');
        const pip = row?.querySelector('.mu-pips i');
        if (pip) {
          pip.classList.add('filled');
          pip.style.boxShadow = '0 0 10px 2px #f3cb6c';
        }
        const tier = row?.querySelector('small:last-child');
        if (tier) tier.textContent = tier.textContent.replace(/Tier 0/, 'Tier 1');
      }
    },
    blessing({ mobile = true, cards }) {
      const root = document.querySelector('.re-live-menu');
      const split = root.querySelector('.re-split');
      const wrap = document.createElement('div');
      wrap.className = 'ia-cards';
      wrap.style.setProperty('--cw', mobile ? '176px' : '264px');
      if (!mobile) wrap.classList.add('desk');
      cards.forEach((c, k) => {
        const b = document.createElement('button');
        b.className = 'ia-card';
        b.dataset.tier = String(c.tier);
        b.setAttribute('aria-pressed', String(k === 0));
        const art = IA.art[`card-${c.id}`] || IA.art[`emblem-${c.id}`];
        b.innerHTML = `<div class="art"><img src="${art}" alt=""><span class="nm">${c.name}</span></div>
          <span class="num">${['', 'I', 'II', 'III', 'IV'][c.tier]}</span>
          <div class="boon">${c.description}</div>
          <div class="cost ${c.cost ? '' : 'free'}"><i></i>${c.cost || 'No cost'}</div>`;
        wrap.append(b);
      });
      split.replaceWith(wrap);
      const footer = root.querySelector('.re-footer');
      const skip = document.createElement('button');
      skip.className = 're-btn ia-skip';
      skip.textContent = 'No blessing';
      footer.prepend(skip);
      footer.querySelectorAll('button').forEach((btn) => {
        if (/Details/.test(btn.textContent)) btn.remove();
      });
    },
    church({
      mobile = true,
      id = 'church',
      title = 'Church',
      kicker = 'Heal · Revive · Promote',
    } = {}) {
      const root = document.querySelector('.re-live-menu');
      const body = root.querySelector('.re-menu-body');
      if (mobile) vignette(root, id, { opacity: 0.55 });
      else band(body, id, title, kicker, 230);
    },
    arena({ mobile = true } = {}) {
      const root = document.querySelector('.re-live-menu');
      const body = root.querySelector('.re-menu-body');
      if (mobile) vignette(root, 'arena', { opacity: 0.55 });
      else band(body, 'arena', 'Colosseum', 'Fight · Hire', 230);
    },
  };
})();
