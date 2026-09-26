"""Build the Rogue Dawn Historia page: inline every asset the source references.

    python3 docs/lore/historia/build.py [out.html]

The source uses {{ASSET:<path from the repo root>}} for images: the game's
PC-98 portraits (assets/portraits/pc98/, the set the game renders) and the
chapter plates in docs/lore/historia/art/ (made by art.mjs). The output is a
single self-contained HTML page (published as an Artifact).
"""
import base64
import pathlib
import re
import sys

here = pathlib.Path(__file__).resolve().parent
root = here.parents[2]
src = (here / 'historia.src.html').read_text(encoding='utf-8')
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'}


def inline(match):
    path = root / match.group(1)
    data = path.read_bytes()
    return f'data:{MIME[path.suffix]};base64,' + base64.b64encode(data).decode()


out = re.sub(r'\{\{ASSET:([^}]+)\}\}', inline, src)
target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / 'rogue-dawn-historia.html'
target.write_text(out, encoding='utf-8')
print(f'wrote {target} ({len(out) // 1024} KB)')
