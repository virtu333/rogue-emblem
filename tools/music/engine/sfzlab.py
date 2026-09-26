"""Generated SFZ programs for the sound lab (the alternative palette).

The lab drives third-party SFZ libraries (Sonatina Symphonic Orchestra 4,
Virtual Playing Orchestra 3, VCSL) through `sfizz_render`. Their programs use
`#include`, `#define` and paths relative to the library, and sometimes need a
tweak (a faster legato transition, an accent layer that fires only on a
phrase's first note, a second round robin). Rather than edit the libraries,
a program is parsed into blocks, transformed, and written as a flat file with
absolute sample paths into the lab directory (`MUSIC_LAB_DIR`, default
`References/music-lab`). Nothing here runs unless a lab palette is selected.

  prog = load(path)                      # flattened blocks
  prog = with_opcodes(prog, 'group', {'off_time': '0.12'}, where={'trigger': 'legato'})
  path = write(prog, 'violin-legato')    # content-addressed file
"""

from __future__ import annotations

import copy
import hashlib
import os
import re

from .theory import pitch as parse_pitch

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LAB_DIR = os.environ.get('MUSIC_LAB_DIR', os.path.join(ROOT, 'References', 'music-lab'))

_HEADER_OR_OPC = re.compile(r'<(\w+)>|([A-Za-z0-9_$]+)=')
KEY_OPCODES = ('lokey', 'hikey', 'key', 'pitch_keycenter', 'sw_lokey', 'sw_hikey', 'sw_last',
               'sw_default', 'fil_keycenter', 'sw_down', 'sw_up', 'sw_previous')


def _strip_comments(text: str) -> str:
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return re.sub(r'//[^\n]*', '', text)


def _expand(path: str, root_dir: str, defines: dict, depth=0) -> str:
    """File text with #include and #define resolved (includes are relative to
    the root program's folder, as sfizz resolves them)."""
    if depth > 16:
        raise ValueError(f'include depth exceeded at {path}')
    text = _strip_comments(open(path, encoding='utf-8', errors='replace').read())
    out = []
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r'#define\s+(\$\w+)\s+(.*)$', s)
        if m:
            defines[m.group(1)] = m.group(2).strip()
            continue
        m = re.match(r'#include\s+"([^"]+)"', s)
        if m:
            inc = m.group(1).replace('\\', '/')
            cand = os.path.join(root_dir, inc)
            if not os.path.exists(cand):
                cand = os.path.join(os.path.dirname(path), inc)
            out.append(_expand(cand, root_dir, defines, depth + 1))
            continue
        # longest names first so $VIB_PITCH is not eaten by $VIB
        for name in sorted(defines, key=len, reverse=True):
            line = line.replace(name, defines[name])
        out.append(line)
    return '\n'.join(out)


def load(path: str) -> list:
    """Parse an SFZ program into [(header, [(opcode, value), ...]), ...] with
    includes and defines resolved and sample paths made absolute."""
    path = os.path.abspath(path)
    root_dir = os.path.dirname(path)
    text = _expand(path, root_dir, {})
    blocks = [('_pre', [])]
    matches = list(_HEADER_OR_OPC.finditer(text))
    for i, m in enumerate(matches):
        if m.group(1):
            blocks.append((m.group(1), []))
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        raw = text[m.end():end]
        name = m.group(2)
        if name == 'sample':
            # a sample path runs to the end of its line and may contain spaces
            val = raw.split('\n')[0].strip()
        else:
            val = raw.split()[0] if raw.split() else ''
        blocks[-1][1].append((name, val))
    # bake default_path (a <control> opcode) into absolute sample paths
    default_path = ''
    out = []
    for header, ops in blocks:
        new_ops = []
        for k, v in ops:
            if header == 'control' and k == 'default_path':
                default_path = v.replace('\\', '/')
                continue
            if k == 'sample':
                v = v.replace('\\', '/')
                if not v.startswith('*'):
                    v = os.path.normpath(os.path.join(root_dir, default_path, v))
            new_ops.append((k, v))
        out.append((header, new_ops))
    return [b for b in out if b[0] != '_pre' or b[1]]


def _num_key(v: str) -> int:
    v = v.strip()
    if re.fullmatch(r'-?\d+', v):
        return int(v)
    # sfizz / SSO note names: c4 = 60, sharps with '#', flats with 'b'
    m = re.fullmatch(r'([A-Ga-g])([#b]?)(-?\d+)', v)
    if not m:
        raise ValueError(f'bad key {v!r}')
    return parse_pitch(m.group(1).upper() + m.group(2) + m.group(3))


def get(ops, name, default=None):
    for k, v in reversed(ops):
        if k == name:
            return v
    return default


def set_op(ops, name, value):
    ops[:] = [(k, v) for k, v in ops if k != name] + [(name, str(value))]


def with_opcodes(prog, header: str, opcodes: dict, where: dict | None = None):
    """Set opcodes on every block of `header` whose own opcodes match `where`."""
    prog = copy.deepcopy(prog)
    for h, ops in prog:
        if h != header:
            continue
        if where and any(get(ops, k) != str(v) for k, v in where.items()):
            continue
        for k, v in opcodes.items():
            if v is None:
                ops[:] = [(a, b) for a, b in ops if a != k]
            else:
                set_op(ops, k, v)
    return prog


def regions(prog):
    """Effective opcodes of every region (control/global/master/group inherited)."""
    ctx = {'control': [], 'global': [], 'master': [], 'group': []}
    out = []
    for h, ops in prog:
        if h in ('control', 'global'):
            ctx[h] = ops
            ctx['master'] = []
            ctx['group'] = []
        elif h == 'master':
            ctx['master'] = ops
            ctx['group'] = []
        elif h == 'group':
            ctx['group'] = ops
        elif h == 'region':
            eff = {}
            for layer in (ctx['global'], ctx['master'], ctx['group'], ops):
                for k, v in layer:
                    eff[k] = v
            out.append(eff)
    return out


def key_span(prog) -> tuple[int, int]:
    """Lowest and highest playable key (keyswitch ranges excluded)."""
    lo, hi = 127, 0
    for r in regions(prog):
        if 'sample' not in r:
            continue
        if 'key' in r:
            a = b = _num_key(r['key'])
        else:
            a, b = _num_key(r.get('lokey', '0')), _num_key(r.get('hikey', '127'))
        lo, hi = min(lo, a), max(hi, b)
    return lo, hi


def region_keys(ops) -> tuple[int, int, int]:
    k = get(ops, 'key')
    lo = _num_key(get(ops, 'lokey', k if k is not None else '0'))
    hi = _num_key(get(ops, 'hikey', k if k is not None else '127'))
    kc = _num_key(get(ops, 'pitch_keycenter', k if k is not None else str(lo)))
    return lo, hi, kc


def round_robin_by_cc(prog, cc: int = 20, shift: int = 1):
    """Two round robins selected by a CC (0-63: the library's own sample,
    64-127: the neighbouring sample `shift` semitones up, played down to pitch).

    A real second take of the same note is not available, so the next note's
    recording stands in for it: a different bow stroke, a different string
    resonance, the same pitch. Keys the shifted set cannot reach fall back to
    the original sample.
    """
    prog = copy.deepcopy(prog)
    out = []
    for h, ops in prog:
        if h != 'region':
            out.append((h, ops))
            continue
        a = list(ops) + [('locc%d' % cc, '0'), ('hicc%d' % cc, '63')]
        out.append((h, a))
    # the shifted copies, in the same group context as their originals
    shifted = []
    cur_ctx = []
    for h, ops in prog:
        if h != 'region':
            cur_ctx.append((h, ops))
            continue
        lo, hi, kc = region_keys(ops)
        b = [(k, v) for k, v in ops if k not in ('key', 'lokey', 'hikey', 'pitch_keycenter')]
        b += [('lokey', str(lo - shift)), ('hikey', str(hi - shift)), ('pitch_keycenter', str(kc)),
              ('locc%d' % cc, '64'), ('hicc%d' % cc, '127')]
        shifted.append((list(cur_ctx), (h, b), (lo, hi, ops)))
    # keys at the top of the range have no shifted neighbour: reuse the original
    covered = set()
    for _, (h, b), (lo, hi, _) in shifted:
        covered.update(range(lo - shift, hi - shift + 1))
    fill = []
    for ctx, _, (lo, hi, ops) in shifted:
        miss = [k for k in range(lo, hi + 1) if k not in covered]
        if miss:
            c = [(k, v) for k, v in ops if k not in ('key', 'lokey', 'hikey')]
            if get(ops, 'pitch_keycenter') is None:
                c.append(('pitch_keycenter', str(region_keys(ops)[2])))
            c += [('lokey', str(min(miss))), ('hikey', str(max(miss))), ('locc%d' % cc, '64'),
                  ('hicc%d' % cc, '127')]
            fill.append((ctx, ('region', c)))
            covered.update(miss)
    # re-emit: original program, then each shifted region under a copy of its group header
    last_group = None
    for ctx, reg, _ in shifted + [(c, r, None) for c, r in fill]:
        grp = [b for b in ctx if b[0] in ('control', 'global', 'master', 'group')]
        head = grp[-1] if grp else None
        if head is not None and head is not last_group:
            out.append((head[0], list(head[1])))
            last_group = head
        out.append(reg)
    return out


def merge(*progs):
    """Concatenate programs (the later ones' <control> blocks are dropped)."""
    out = list(copy.deepcopy(progs[0]))
    for p in progs[1:]:
        out += [b for b in copy.deepcopy(p) if b[0] != 'control']
    return out


def regions_only(prog, where: dict):
    """Keep only the groups (and their regions) whose group opcodes match `where`."""
    out, keep = [], True
    for h, ops in prog:
        if h == 'group':
            keep = all(get(ops, k) == str(v) for k, v in where.items())
        if h in ('control', 'global', 'master'):
            keep = True
        if keep:
            out.append((h, ops))
    return out


def sustain_offsets(prog, level=0.8, max_s=0.6, min_frames=0):
    """Start every region where its sample has finished speaking.

    For legato regions: the new note must enter already sounding, not with a
    fresh bow attack. (SSO's legato groups set `offset=20000` at group level,
    but every included region sets its own `offset`, which wins: the library's
    legato voices start from the attack.) The point is measured per sample:
    the first frame whose 20 ms RMS reaches `level` of the sample's median
    level over its first `max_s` seconds after the peak-rise."""
    import numpy as np
    import soundfile as sf
    prog = copy.deepcopy(prog)
    cache = {}
    for h, ops in prog:
        if h != 'region':
            continue
        path = get(ops, 'sample')
        if path is None:
            continue
        if path not in cache:
            x, sr = sf.read(path, dtype='float32', always_2d=True)
            m = x.mean(axis=1).astype(np.float64)
            hop = int(0.02 * sr)
            n = len(m) // hop
            rms = np.sqrt((m[: n * hop] ** 2).reshape(n, hop).mean(axis=1))
            head = rms[: int(1.5 / 0.02)]
            ref = float(np.median(head[head > head.max() * 0.1])) if (head > 0).any() else 0.0
            idx = np.nonzero(rms >= level * ref)[0]
            cut = int(idx[0] * hop) if len(idx) else 0
            cache[path] = min(cut, int(max_s * sr))
        cur = int(get(ops, 'offset', '0'))
        set_op(ops, 'offset', max(cur, cache[path], min_frames))
    return prog


def text(prog) -> str:
    lines = ['// generated by tools/music/engine/sfzlab.py; do not edit']
    for h, ops in prog:
        if h != '_pre':
            lines.append(f'<{h}>')
        for k, v in ops:
            lines.append(f'{k}={v}')
        lines.append('')
    return '\n'.join(lines)


def ram_based(prog):
    """Load every sample fully into memory (`hint_ram_based`). By default sfizz
    preloads 8192 frames per sample and streams the rest from a background
    thread; in sfizz_render that thread is not reliably waited for, so a
    voice that outruns its preload (a long note, or a legato region that
    starts 20000 frames in) can fall silent. In RAM, every render is whole
    and identical."""
    prog = copy.deepcopy(prog)
    for h, ops in prog:
        if h == 'control':
            set_op(ops, 'hint_ram_based', 1)
            return prog
    return [('control', [('hint_ram_based', '1')])] + prog


def write(prog, name: str) -> str:
    """Write a program into the lab dir; the file name carries a content hash."""
    body = text(ram_based(prog))
    h = hashlib.sha1(body.encode()).hexdigest()[:10]
    d = os.path.join(LAB_DIR, 'sfz')
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{name}-{h}.sfz')
    if not os.path.exists(path):
        tmp = path + f'.{os.getpid()}.tmp'
        with open(tmp, 'w') as f:
            f.write(body)
        os.replace(tmp, path)
    return path
