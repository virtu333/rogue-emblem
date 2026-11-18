"""Where the suite renders to: $OCARINA_BOSSES_OUT, or References/music-lab/ocarina_bosses
(gitignored). Nothing here ever writes game assets or the game's loop tables."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.path.abspath(os.path.join(MUSIC, '..', '..'))
OUT_DIR = os.environ.get('OCARINA_BOSSES_OUT',
                         os.path.join(ROOT, 'References', 'music-lab', 'ocarina_bosses'))
os.makedirs(OUT_DIR, exist_ok=True)
