"""The Berserker King — the clan cell compressed into blows.

The Warchief's open-fifth clan music squeezed into repeated marcato strikes
(D D F E D A) on low brass and taiko, then again, harder. No corruption
effect: he is unchanged, only more so. In the key of the Act III boss theme.
"""

from stingers._common import cue

KEYED = False
TONIC = 'E'


def build(transpose=0):
    s = cue('boss_berserker_king', bpm=140, bars=2, title='Berserker King', transpose=transpose,
            seed=47, lufs=-15.5)
    cell = 'D3e^ D3e^ F3e^ E3e^ D3q^ A2q^'
    tbn = s.part('tbn', 'trombones', role='lead')
    tbn.at(1).play(f'@f {cell} | @ff {cell} |')
    hn = s.part('horns', 'horns', role='section')
    hn.at(1).play(f"@f {cell.replace('3', '4').replace('A2', 'A3')} | @ff "
                  f"{cell.replace('3', '4').replace('A2', 'A3')} |")
    tk = s.part('taiko', 'taiko', role='drums')
    tk.at(1).play('@f D2e D2e D2e D2e D2q D2q | @ff D2e D2e D2e D2e D2q D2q |')
    cb = s.part('cb', 'basses', role='low', art='spic')
    cb.at(1).play(f"@f {cell.replace('3', '2').replace('A2', 'A1')} | "
                  f"@ff {cell.replace('3', '2').replace('A2', 'A1')} |")
    return s
