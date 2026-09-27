"""Where the OP experiment writes: $ANIME_OP_OUT, or References/music-lab/anime_op
(gitignored). Nothing here ever writes game assets."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.path.abspath(os.path.join(MUSIC, '..', '..'))
OUT_DIR = os.environ.get('ANIME_OP_OUT', os.path.join(ROOT, 'References', 'music-lab', 'anime_op'))
os.makedirs(OUT_DIR, exist_ok=True)
