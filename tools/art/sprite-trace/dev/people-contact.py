#!/usr/bin/env python3
"""Contact sheet of the shipped person sprites: for every class, each portrait person's
PC-98 portrait next to the sprite the game bakes for them (read from the traced atlas and
its manifest, i.e. exactly what ships), plus the runtime NPC recolour of a few of them.

  python3 tools/art/sprite-trace/dev/people-contact.py <out.png> [--zoom 2] [--portrait 64]
      [--classes Fighter,Warrior] [--npc]

Run from the repository root. Writes docs/art-direction/sprites-v3/people_contact.png when
asked to (see README there).
"""
import json
import sys

from PIL import Image, ImageDraw

args = sys.argv[1:]


def flag(name, default):
    return args[args.index('--' + name) + 1] if '--' + name in args else default


out = args[0]
Z = int(flag('zoom', 2))
P = int(flag('portrait', 64))
only = flag('classes', None)
only = only.split(',') if only else None
manifest = json.load(open('src/ui/TracedSpriteManifest.json'))
table = json.load(open('src/data/portraitVariants.json'))
pages = [Image.open('assets/sprites/traced/' + f).convert('RGBA') for f in manifest['pages']]
key = lambda name: name.lower().replace(' ', '_')
swap = {int(a, 16): int(b, 16) for a, b in manifest.get('npcSwap', [])}

INK = (24, 24, 28, 255)
PLATE = (66, 72, 84, 255)
GRASS = (122, 138, 92, 255)
LABEL = (221, 208, 189, 255)


def sprite(k, npc=False):
    e = manifest['sprites'][k]
    im = pages[e['page']].crop((e['x'], e['y'], e['x'] + e['w'], e['y'] + e['h']))
    if npc:
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a:
                    t = swap.get((r << 16) | (g << 8) | b)
                    if t is not None:
                        px[x, y] = (t >> 16, (t >> 8) & 255, t & 255, a)
    # the figure within its logical cell's upper part, on grass
    cell = Image.new('RGBA', (e['w'] + 4, e['h'] + 4), GRASS)
    cell.alpha_composite(im, (2, 2))
    return cell.resize((cell.width * Z, cell.height * Z), Image.NEAREST)


def portrait(pid):
    plate = Image.new('RGBA', (P, P), PLATE)
    try:
        plate.alpha_composite(Image.open(f'public/assets/portraits/pc98/{P}/{pid}.png').convert('RGBA').resize((P, P)))
    except FileNotFoundError:
        pass
    return plate


rows = []
for cls in table['classes']:
    if only and cls not in only:
        continue
    tiles = []
    for person in table['classes'][cls]:
        k = f'{key(cls)}-{person}'
        s = sprite(k)
        f = portrait(table['identities'][person]['renders'][cls])
        who = manifest['sprites'][k]['person']
        w = f.width + 2 + s.width
        h = max(f.height, s.height) + 22
        t = Image.new('RGBA', (w, h), INK)
        t.alpha_composite(f, (0, 0))
        t.alpha_composite(s, (f.width + 2, 0))
        d = ImageDraw.Draw(t)
        d.text((1, h - 21), f"{person} {who['g']}{who['design'].upper()}", fill=LABEL)
        d.text((1, h - 11), f"{who['skin'][4:]} {who['hair'][4:]}{' bald' if who.get('bald') else ''}", fill=LABEL)
        tiles.append(t)
    head = Image.new('RGBA', (96, 20), INK)
    ImageDraw.Draw(head).text((2, 4), cls, fill=(255, 230, 150, 255))
    # five people per row (the Falcon Knight and Wyvern Lord have ten)
    for i in range(0, len(tiles), 5):
        part = [head if i == 0 else Image.new('RGBA', head.size, INK)] + tiles[i:i + 5]
        W = sum(t.width for t in part) + 6 * len(part)
        H = max(t.height for t in part)
        row = Image.new('RGBA', (W, H), INK)
        x = 0
        for t in part:
            row.alpha_composite(t, (x, 0))
            x += t.width + 6
        rows.append(row)

if '--npc' in args:
    tiles = []
    head = Image.new('RGBA', (96, 32), INK)
    ImageDraw.Draw(head).text((2, 4), 'NPC recolour\n(runtime swap)', fill=(150, 230, 170, 255))
    tiles.append(head)
    for cls, person in [('Fighter', 'fighter_d'), ('Archer', 'archer_a'), ('Mage', 'mage_e'), ('Cleric', 'cleric_d'),
                        ('Cavalier', 'cavalier_c'), ('Myrmidon', 'myrmidon_b'), ('Thief', 'thief_c'), ('Knight', 'knight_c')]:
        k = f'{key(cls)}-{person}'
        a, b = sprite(k), sprite(k, npc=True)
        t = Image.new('RGBA', (a.width * 2 + 2, a.height), INK)
        t.alpha_composite(a, (0, 0))
        t.alpha_composite(b, (a.width + 2, 0))
        tiles.append(t)
    W = sum(t.width for t in tiles) + 6 * len(tiles)
    H = max(t.height for t in tiles)
    row = Image.new('RGBA', (W, H), INK)
    x = 0
    for t in tiles:
        row.alpha_composite(t, (x, 0))
        x += t.width + 6
    rows.append(row)

W = max(r.width for r in rows)
H = sum(r.height for r in rows) + 6 * len(rows)
sheet = Image.new('RGBA', (W, H), INK)
y = 0
for r in rows:
    sheet.alpha_composite(r, (0, y))
    y += r.height + 6
sheet.convert('RGB').save(out, optimize=True)
print(out, sheet.size)
