// The art of the Events wave (docs/specs/event-art.md): the route-map medal with its Dark
// Omen, the ten event vignettes and the page band that shows them. Art never gates play, so
// the failures worth catching are: an event with no painting (or a stale manifest hash that
// serves an old cached one), a file that is the wrong size or only in one of the two asset
// trees, a band that blocks the page or flashes on every re-render, a missing painting that
// is retried or crashes, and a missing medal sheet that leaves a blank node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import manifest from '../src/ui/momentArtManifest.json';
import { eventVignetteFocus, eventVignetteUrl } from '../src/ui/itemMoments.js';
import { createEventBand, resetEventBandCache } from '../src/ui/eventBand.js';
import sharp from 'sharp';
import { decodePng } from '../tools/art/icons/lib/png.mjs';
import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const allEventIds = data.events.events.map((e) => e.id);
// The Phase 2D events (docs/specs/event-nodes-phase2.md "2D as built") wait for their paintings
// (docs/specs/event-art.md: "Phase 2 events as they land"). Art never gates play: an event with no
// painting wears the plain band. Remove an id from this list in the commit that ships its painting.
const PAINTING_PENDING = [
  'bad_map',
  'cartographer',
  'chained_shelf',
  'collectors',
  'deserters_revenge',
  'hollow_herald',
  'merc_contract',
  'old_faces',
  'plague_village',
  'sunken_mine',
  'turncoat',
  'wandering_smith',
];
const eventIds = allEventIds.filter((id) => !PAINTING_PENDING.includes(id));
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const read = (dir, f) => fs.readFileSync(path.join(dir, f));

describe('event vignettes ship for every event', () => {
  it('the list of events still waiting for a painting only names real events with none yet', () => {
    for (const id of PAINTING_PENDING) {
      expect(allEventIds, `${id} is not an event`).toContain(id);
      expect(
        manifest.events[id],
        `${id} has art now: take it off the pending list`,
      ).toBeUndefined();
      expect(eventVignetteUrl(id), `${id}: no painting, no URL (the plain band)`).toBeNull();
    }
  });

  it('each event in events.json has a painting, a manifest entry and a cache-busting URL', () => {
    expect(Object.keys(manifest.events).sort()).toEqual([...eventIds].sort());
    for (const id of eventIds) {
      const png = read('assets/ui/moments/events', `${id}.png`);
      expect(manifest.events[id].v, `${id}: manifest hash is the shipped bytes'`).toBe(sha(png));
      expect(eventVignetteUrl(id), id).toMatch(
        new RegExp(`assets/ui/moments/events/${id}\\.png\\?v=${manifest.events[id].v}$`),
      );
    }
    expect(eventVignetteUrl('no_such_event')).toBeNull();
    expect(eventVignetteUrl(null)).toBeNull();
  });

  it('ships display-size palette PNGs, in both asset trees, and nothing else', () => {
    const files = fs.readdirSync('assets/ui/moments/events').sort();
    expect(files).toEqual(eventIds.map((id) => `${id}.png`).sort());
    expect(fs.readdirSync('public/assets/ui/moments/events').sort()).toEqual(files);
    for (const f of files) {
      const buf = read('assets/ui/moments/events', f);
      const png = decodePng(buf);
      expect([png.width, png.height], f).toEqual(manifest.event);
      expect(buf.length, f).toBeLessThanOrEqual(48 * 1024);
      expect(read('public/assets/ui/moments/events', f).equals(buf), `${f} synced`).toBe(true);
    }
    // One band decoded at a time, lazy: never part of the boot load.
    expect(manifest.event[0] * manifest.event[1] * 4).toBeLessThanOrEqual(1024 * 1024);
    expect(fs.readFileSync('src/scenes/BootScene.js', 'utf8')).not.toMatch(/moments\/events/);
  });

  it('every painting is a real picture, not a blank or a flat fill', () => {
    for (const id of eventIds) {
      const png = decodePng(read('assets/ui/moments/events', `${id}.png`));
      const seen = new Set();
      for (let i = 0; i < png.rgba.length; i += 4 * 17) {
        seen.add((png.rgba[i] << 16) | (png.rgba[i + 1] << 8) | png.rgba[i + 2]);
      }
      expect(seen.size, id).toBeGreaterThan(12);
    }
  });
});

describe('the Event medal sheet', () => {
  it('ships the 2-frame sheet and the 48 px canvas fallback, synced', async () => {
    for (const [file, w, h] of [
      ['event-nodes.png', 192, 96],
      ['node_event.png', 48, 48],
    ]) {
      const buf = read('assets/sprites/nodes', file);
      const meta = await sharp(buf).metadata();
      expect([meta.width, meta.height], file).toEqual([w, h]);
      expect(buf.length, file).toBeLessThanOrEqual(8 * 1024);
      expect(read('public/assets/sprites/nodes', file).equals(buf), `${file} synced`).toBe(true);
    }
  });

  it('both frames carry a picture on a transparent field, and they differ', async () => {
    const { data, info } = await sharp(read('assets/sprites/nodes', 'event-nodes.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const frame = (n) => {
      const px = [];
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 96; x++) {
          const i = (y * info.width + n * 96 + x) * 4;
          px.push(data[i], data[i + 1], data[i + 2], data[i + 3]);
        }
      return px;
    };
    const frames = [frame(0), frame(1)];
    for (const px of frames) {
      let solid = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 200) solid += 1;
      expect(solid).toBeGreaterThan(96 * 96 * 0.12);
      expect(solid).toBeLessThan(96 * 96 * 0.8);
      expect(px[3], 'the corner is clear').toBeLessThan(16);
    }
    expect(frames[0].join()).not.toBe(frames[1].join());
  });
});

// A fake Image: the test says when (and whether) a probe loads.
function installImages() {
  const probes = [];
  vi.stubGlobal(
    'Image',
    class {
      set src(value) {
        this._src = value;
        probes.push(this);
      }
      get src() {
        return this._src;
      }
    },
  );
  return probes;
}

describe('the Event page band', () => {
  let probes;
  beforeEach(() => {
    installFakeDom(vi);
    probes = installImages();
    resetEventBandCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a plain strip at once and gains its painting when the file loads', () => {
    const band = createEventBand('quiet_road');
    expect(band.className).toContain('ev-band');
    expect(band.attributes['aria-hidden']).toBe('true');
    expect(band.dataset.event).toBe('quiet_road');
    expect(band.classList.contains('has-art')).toBe(false);
    expect(probes).toHaveLength(1);
    expect(probes[0].src).toBe(eventVignetteUrl('quiet_road'));
    probes[0].onload();
    expect(band.classList.contains('has-art')).toBe(true);
    expect(band.style.getPropertyValue('--ev-art')).toContain('quiet_road.png');
  });

  it('paints straight away on a re-render of an event it already loaded', () => {
    createEventBand('toll_bridge');
    probes[0].onload();
    const again = createEventBand('toll_bridge');
    expect(again.classList.contains('has-art')).toBe(true);
    expect(again.classList.contains('is-ready')).toBe(true); // no fade-in flash
    expect(probes).toHaveLength(1); // not probed twice
  });

  it('a painting with a focal point carries it into the band, others keep the centre', () => {
    expect(eventVignetteFocus('twin_altar')).toMatch(/^\d{1,3}%$/);
    expect(eventVignetteFocus('quiet_road')).toBeNull();
    expect(eventVignetteFocus('no_such_event')).toBeNull();
    const band = createEventBand('twin_altar');
    probes[0].onload();
    expect(band.style.getPropertyValue('--ev-focus')).toBe(eventVignetteFocus('twin_altar'));
    const plain = createEventBand('quiet_road');
    probes[1].onload();
    expect(plain.style.getPropertyValue('--ev-focus')).toBe('');
  });

  it('a missing or failed painting leaves the strip and is never retried', () => {
    const band = createEventBand('the_echo');
    probes[0].onerror();
    expect(band.classList.contains('has-art')).toBe(false);
    const again = createEventBand('the_echo');
    expect(again.classList.contains('has-art')).toBe(false);
    expect(probes).toHaveLength(1);
  });

  it('an event without a painting (or no id) draws the strip and probes nothing', () => {
    for (const id of ['no_such_event', null, undefined]) {
      const band = createEventBand(id);
      expect(band.className).toContain('ev-band');
      expect(band.classList.contains('has-art')).toBe(false);
    }
    expect(probes).toHaveLength(0);
  });

  it('Reduce motion shows the painting without the fade', () => {
    const scene = { registry: { get: () => ({ getReduceMotion: () => true }) } };
    const band = createEventBand('drill_yard', scene);
    expect(band.classList.contains('is-still')).toBe(true);
    const calm = createEventBand('moneylender', {
      registry: { get: () => ({ getReduceMotion: () => false }) },
    });
    expect(calm.classList.contains('is-still')).toBe(
      Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
    );
  });

  it('survives an environment with no Image (the strip stays)', () => {
    vi.stubGlobal('Image', undefined);
    expect(() => createEventBand('twin_altar')).not.toThrow();
  });
});

describe('the Event medal in the loom', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeDom(vi);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the baked sheet, a different frame for the Dark Omen', async () => {
    const probes = installImages();
    const { createNodeArt, EVENT_ART_FRAME, EVENT_DARK_ART_FRAME } =
      await import('../src/ui/NodeArt.js');
    const normal = createNodeArt(EVENT_ART_FRAME, 29);
    const dark = createNodeArt(EVENT_DARK_ART_FRAME, 29);
    expect(normal.style.backgroundImage).toContain('event-nodes.png');
    expect(dark.style.backgroundImage).toContain('event-nodes.png');
    expect(normal.style.backgroundPosition).not.toBe(dark.style.backgroundPosition);
    expect(normal.dataset.fallback).toBeUndefined();
    probes.forEach((p) => p.onload());
    expect(normal.dataset.fallback).toBeUndefined();
  });

  it('falls back to the Ruins medal with a "?" when the sheet is missing', async () => {
    const probes = installImages();
    const { createNodeArt, EVENT_ART_FRAME } = await import('../src/ui/NodeArt.js');
    const before = createNodeArt(EVENT_ART_FRAME, 29);
    probes.forEach((p) => p.onerror());
    expect(before.dataset.fallback).toBe('true');
    expect(before.style.backgroundImage).toBe('');
    expect(before.textContent).toBe('?');
    // A medal drawn after the answer is already the fallback; no new probe is needed.
    const after = createNodeArt(EVENT_ART_FRAME, 29);
    expect(after.dataset.fallback).toBe('true');
    expect(after.textContent).toBe('?');
    expect(probes).toHaveLength(1);
  });

  it('other medals are untouched by the Event sheet', async () => {
    const probes = installImages();
    const { createNodeArt } = await import('../src/ui/NodeArt.js');
    const ruins = createNodeArt(4, 29);
    expect(ruins.style.backgroundImage ?? '').not.toContain('event-nodes');
    expect(probes).toHaveLength(0);
  });
});
