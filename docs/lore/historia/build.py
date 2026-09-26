"""Build the Rogue Dawn Historia page: inline the portraits the source references.

    python3 docs/lore/historia/build.py [out.html]

The source uses {{IMG:<portrait name>}} for files in assets/portraits/.
The output is a single self-contained HTML page (published as an Artifact).
"""
import base64
import pathlib
import re
import sys

here = pathlib.Path(__file__).resolve().parent
root = here.parents[2]
src = (here / 'historia.src.html').read_text(encoding='utf-8')


def inline(match):
    data = (root / 'assets' / 'portraits' / f'{match.group(1)}.png').read_bytes()
    return 'data:image/png;base64,' + base64.b64encode(data).decode()


out = re.sub(r'\{\{IMG:([a-z_]+)\}\}', inline, src)
target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / 'rogue-dawn-historia.html'
target.write_text(out, encoding='utf-8')
print(f'wrote {target} ({len(out) // 1024} KB)')
