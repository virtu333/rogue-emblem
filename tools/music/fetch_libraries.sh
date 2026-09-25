#!/usr/bin/env bash
# Fetch the free sample libraries the score is rendered with into
# References/music-libs/ (gitignored). About 9 GB.
set -euo pipefail
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
echo "libraries ready in $LIBS"
