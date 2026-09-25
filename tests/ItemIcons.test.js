// Item art: coverage (every item, blessing and upgrade in data has an icon), determinism
// (the committed atlases are exactly what the grammar renders, byte for byte), the
// runtime helper, and the mobile texture budget for icons, heroes and moments.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { loadGameData } from './testData.js';
import manifest from '../src/ui/itemIconManifest.json';
import {
  itemIconId,
  itemIconMeta,
  atlasStyle,
  pickAtlas,
  itemIcon,
  itemHero,
  hasItemIcon,
} from '../src/ui/itemIcons.js';
import { itemSlug, baseItemName } from '../src/ui/itemIconIds.js';
import { buildAtlases, SIZES, ATLAS_DIRS } from '../tools/art/icons/build.mjs';
import { encodeIndexed, decodePng } from '../tools/art/icons/lib/png.mjs';

const data = loadGameData();
const imbues = JSON.parse(fs.readFileSync('data/imbues.json', 'utf8'));
const upgrades = data.metaUpgrades.upgrades || data.metaUpgrades;
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

describe('item icon coverage', () => {
  it('every weapon, scroll, consumable, accessory, whetstone and stone has its own icon', () => {
    const items = [
      ...data.weapons,
      ...data.consumables,
      ...data.accessories,
      ...data.whetstones,
      ...imbues.imbues.map((i) => ({ name: i.stone.name, type: 'ImbueStone' })),
      { name: imbues.prismaticStone.name, type: 'ImbueStone' },
    ];
    const missing = items.filter((it) => itemIconId(it) !== itemSlug(it.name));
    expect(missing.map((m) => m.name)).toEqual([]);
    // One cell per item: no two items share an icon id.
    expect(new Set(items.map((it) => itemIconId(it))).size).toBe(items.length);
  });

  it('every blessing and every upgrade resolves to its own icon', () => {
    for (const b of data.blessings.blessings) expect(itemIconId(b)).toBe(`blessing-${b.id}`);
    for (const u of upgrades) expect(itemIconId(u)).toBe(`upgrade-${u.id}`);
  });

  it('run-state names resolve to the base item (forge level, imbue adjective)', () => {
    const forged = {
      name: 'Iron Sword +2',
      _baseName: 'Iron Sword',
      _forgeLevel: 2,
      type: 'Sword',
    };
    expect(itemIconId(forged)).toBe('iron-sword');
    const imbued = {
      name: 'Vampiric Silver Lance +1',
      _baseName: 'Vampiric Silver Lance',
      _imbueId: 'vampiric',
      type: 'Lance',
    };
    expect(itemIconId(imbued)).toBe('silver-lance');
    expect(baseItemName('Keen Killer Axe +3')).toBe('Keen Killer Axe');
    expect(itemIconId({ name: 'Keen Killer Axe +3', type: 'Axe' })).toBe('killer-axe');
  });

  it('reward choices, gold and unknown items still get an icon', () => {
    expect(itemIconId({ type: 'gold', item: null })).toBe('gold');
    expect(itemIconId({ type: 'skip' })).toBe('gold');
    expect(itemIconId({ type: 'weapon', item: { name: 'Steel Axe', type: 'Axe' } })).toBe(
      'steel-axe',
    );
    expect(itemIconId({ name: 'Mystery Blade', type: 'Sword' })).toBe('generic-sword');
    expect(itemIconId({ name: 'Odd Scroll', type: 'Scroll', skillId: 'x' })).toBe(
      'generic-skill-scroll',
    );
    expect(itemIconId({ name: 'Odd Scroll', type: 'Scroll', teachesWeaponArtId: 'x' })).toBe(
      'generic-art-scroll',
    );
    expect(itemIconId({ name: 'Bauble', type: 'Accessory', effects: {} })).toBe(
      'generic-accessory',
    );
    expect(itemIconId(null)).toBe('generic-supply');
    for (const id of Object.keys(manifest.icons).filter((k) => k.startsWith('generic-')))
      expect(hasItemIcon(id)).toBe(true);
  });

  it('sockets follow the category and rims follow the tier', () => {
    expect(itemIconMeta('iron-sword')).toMatchObject({ socket: 'weapon', rim: 'Iron' });
    expect(itemIconMeta('ragnarok')).toMatchObject({ socket: 'weapon', rim: 'Legend' });
    expect(itemIconMeta('sol-scroll')).toMatchObject({ socket: 'scroll', rim: 'Rare' });
    expect(itemIconMeta('vulnerary').socket).toBe('supply');
    expect(itemIconMeta('gamblers-coin').socket).toBe('accessory');
    expect(itemIconMeta('mentors-band').rim).toBe('Legend');
    expect(itemIconMeta('silver-whetstone').socket).toBe('forge');
    expect(itemIconMeta('blessing-forbidden_tome')).toMatchObject({
      socket: 'blessing',
      rim: 'IV',
    });
    expect(itemIconMeta('upgrade-unlock_sol').socket).toBe('upgrade');
  });
});

describe('item icon atlases are deterministic', () => {
  let built;
  beforeAll(() => {
    built = buildAtlases();
  }, 120_000);

  it('the grammar renders exactly the committed atlases', () => {
    expect(built.entries.map((e) => e.id)).toEqual(
      Object.entries(manifest.icons)
        .sort((a, b) => a[1][0] - b[1][0])
        .map(([id]) => id),
    );
    for (const size of SIZES) {
      const a = built.atlases[size];
      expect(sha(a.rgba), `atlas ${size} pixels`).toBe(manifest.atlases[size].rgba);
      const png = encodeIndexed(a.rgba, a.w, a.h);
      for (const dir of ATLAS_DIRS) {
        const file = fs.readFileSync(`${dir}/atlas-${size}.png`);
        expect(file.equals(png), `${dir}/atlas-${size}.png bytes`).toBe(true);
        const decoded = decodePng(file);
        expect([decoded.width, decoded.height]).toEqual([a.w, a.h]);
        expect(sha(decoded.rgba)).toBe(manifest.atlases[size].rgba);
      }
    }
  });

  it('rendering twice gives the same pixels', () => {
    const again = buildAtlases();
    for (const size of [16, 32])
      expect(sha(again.atlases[size].rgba)).toBe(sha(built.atlases[size].rgba));
  }, 120_000);
});

describe('itemIcon helper', () => {
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      props: {},
      attrs: {},
      className: '',
      classList: {
        set: new Set(),
        add(...c) {
          c.forEach((v) => this.set.add(v));
        },
      },
      style: { setProperty: (k, v) => (node.props[k] = v) },
      setAttribute: (k, v) => (node.attrs[k] = v),
      append: (...c) => node.children.push(...c),
    };
    return node;
  };
  let original;
  beforeAll(() => {
    original = globalThis.document;
    globalThis.document = { createElement: make, baseURI: 'http://localhost/' };
  });
  afterAll(() => {
    globalThis.document = original;
  });

  it('picks a native atlas and an integer scale for every supported size', () => {
    expect(pickAtlas(16)).toEqual({ native: 16, scale: 1 });
    expect(pickAtlas(32)).toEqual({ native: 32, scale: 1 });
    expect(pickAtlas(48)).toEqual({ native: 48, scale: 1 });
    expect(pickAtlas(64)).toEqual({ native: 32, scale: 2 });
    expect(pickAtlas(96)).toEqual({ native: 48, scale: 2 });
    const st = atlasStyle('iron-sword', 64);
    const cell = manifest.icons['iron-sword'][0];
    expect(st.backgroundSize).toBe(
      `${manifest.atlases[32].w * 2}px ${manifest.atlases[32].h * 2}px`,
    );
    expect(st.backgroundPosition).toBe(`-${(cell % 16) * 64}px -${Math.floor(cell / 16) * 64}px`);
  });

  it('builds a socketed icon with forge and imbue marks', () => {
    const el = itemIcon(
      {
        name: 'Vampiric Iron Sword +2',
        _baseName: 'Vampiric Iron Sword',
        _forgeLevel: 2,
        _imbueId: 'vampiric',
        type: 'Sword',
      },
      { size: 32 },
    );
    expect(el.dataset).toMatchObject({ iconId: 'iron-sword', socket: 'weapon', rim: 'Iron' });
    const [socket, glyph, forge, imbue] = el.children;
    expect(socket.className).toBe('ia-socket');
    expect(glyph.dataset.atlas).toBe('32');
    expect(glyph.style.backgroundImage).toMatch(/assets\/ui\/items\/atlas-32\.png\?v=/);
    expect(forge.textContent).toBe('+2');
    expect(imbue.dataset.imbue).toBe('vampiric');
    const bare = itemIcon('Elixir', { size: 16, socket: false });
    expect(bare.children).toHaveLength(1);
    expect(bare.classList.set.has('is-bare')).toBe(true);
  });

  it('shows the pixel icon at 2x when an item has no approved painting', () => {
    const hero = itemHero({ name: 'Sol Scroll', type: 'Scroll', skillId: 'sol' });
    expect(hero.dataset.art).toBe('pixel');
    expect(hero.children[1].dataset.atlas).toBe('48');
    const painted = Object.keys(manifest.heroes)[0];
    if (painted) {
      const h = itemHero(painted.replace(/-/g, ' '));
      expect(h.dataset.art).toBe('painted');
      expect(h.children[1].src).toMatch(new RegExp(`hero/${painted}\\.png\\?v=`));
      // Never shrunk: a 64 px slot falls back to the pixel icon.
      expect(itemHero(painted.replace(/-/g, ' '), { size: 64 }).dataset.art).toBe('pixel');
    }
  });
});

describe('item art texture budget (mobile)', () => {
  const decoded = (w, h) => w * h * 4;
  it('atlases stay small: sides <= 1024, decoded <= 4.5 MB total, download <= 160 KB', () => {
    let bytes = 0;
    let dec = 0;
    for (const size of SIZES) {
      const a = manifest.atlases[size];
      expect(a.w).toBeLessThanOrEqual(1024);
      expect(a.h).toBeLessThanOrEqual(1024);
      bytes += a.bytes;
      dec += decoded(a.w, a.h);
    }
    expect(dec).toBeLessThanOrEqual(4.5 * 1024 * 1024);
    expect(bytes).toBeLessThanOrEqual(160 * 1024);
  });

  it('painted heroes are 96 px palette PNGs under 12 KB each', () => {
    const dir = 'assets/ui/items/hero';
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(files.sort()).toEqual(
      Object.keys(manifest.heroes)
        .map((id) => `${id}.png`)
        .sort(),
    );
    for (const f of files) {
      const buf = fs.readFileSync(`${dir}/${f}`);
      const png = decodePng(buf);
      expect([png.width, png.height], f).toEqual([96, 96]);
      expect(buf.length, f).toBeLessThanOrEqual(12 * 1024);
      expect(fs.readFileSync(`public/${dir}/${f}`).equals(buf), `public copy of ${f}`).toBe(true);
    }
  });
});
