#!/usr/bin/env bash
# Fetch the free sample libraries the score is rendered with into
# References/music-libs/ (gitignored). About 11 GB.
#   --lab   also the whole VCSL (5.8 GB more), for the sound lab's other candidates
set -euo pipefail
LAB=0
[ "${1:-}" = "--lab" ] && LAB=1
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIBS="$ROOT/References/music-libs"
mkdir -p "$LIBS"
cd "$LIBS"

clone() { # repo dir [branch]
  local repo="$1" dir="$2" branch="${3:-}"
  if [ -d "$dir" ]; then echo "have $dir"; return; fi
  if [ -n "$branch" ]; then
    git clone --depth 1 --single-branch --branch "$branch" "https://github.com/$repo" "$dir"
  else
    git clone --depth 1 "https://github.com/$repo" "$dir"
  fi
  rm -rf "$dir/.git"
}

clone sgossner/VSCO-2-CE VSCO-2-CE SFZ
clone mrbumpy409/GeneralUser-GS GeneralUser-GS
clone sfzinstruments/virtuosity_drums virtuosity_drums
clone sfzinstruments/karoryfer.growlybass karoryfer.growlybass
clone sfzinstruments/SplendidGrandPiano SplendidGrandPiano
# the house palette (engine/palette.py; credits in docs/music-credits.md)
clone peastman/sso SSO4
clone eodowd/VirtualPlayingOrchestra VPO3
# VCSL: the sfz branch carries the programs beside the samples. The house palette
# plays one of its instruments (the colosseum's frame drum), so only that is fetched.
if [ ! -d VCSL ]; then
  git clone --depth 1 --single-branch --branch sfz --filter=blob:none --no-checkout \
    https://github.com/sgossner/VCSL VCSL
  if [ "$LAB" = 1 ]; then
    git -C VCSL checkout sfz
  else
    git -C VCSL sparse-checkout set --no-cone LICENSE README.md \
      '/Membranophones/Struck Membranophones/Frame Drum.sfz' \
      '/Membranophones/Struck Membranophones/Frame Drum/'
    git -C VCSL checkout sfz
  fi
  rm -rf VCSL/.git
else
  echo "have VCSL"
fi
echo "libraries ready in $LIBS"
