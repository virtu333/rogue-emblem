# The Unwritten Page engine

Cutscenes in the Unwritten Page style (`docs/art-direction/anime-op/STYLE.md`): a few
generated paintings, and code for everything that moves. **How it works and how to make a
shot: [ENGINE.md](ENGINE.md).**

Pieces:

- **"Again", bars 28–56** (`again.js`, 46.4 s): the second half of the opening, from the
  snare roll into the chorus to the title. Preview: `docs/art-direction/anime-op/px/again_bars28-56.mp4`.
- **The proof, bars 47–56** (`proof.js`, 16 s): the first test of the paint stages.

```sh
npm run dev                         # then open /tools/cutscene/unwritten/  (?piece=proof, ?t=24)
node tools/cutscene/render.mjs --piece again --stills 2.4,25.8 --out References/cutscene/unwritten/stills
node tools/cutscene/render.mjs --piece again --video References/cutscene/unwritten/again.mp4 --workers 6
```

The music is a local copy of the battle theme from the music branch (not committed):

```sh
mkdir -p References/cutscene/unwritten
git show origin/claude/anime-op-broken-sun:public/assets/audio/music/music_battle_broken_sun.mp3 \
  > References/cutscene/unwritten/broken_sun.mp3
```

The files are listed in [ENGINE.md](ENGINE.md#files).
