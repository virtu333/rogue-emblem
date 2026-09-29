#!/bin/bash
# Render a time range of a piece and tile it at 24 fps for frame-by-frame review.
#   PIECE=ford W=400 SEG_OUT=/tmp/seg tools/cutscene/unwritten/seg.sh 3.2 4.0 name [cols]

set -e
S=${SEG_OUT:-/tmp/seg}
mkdir -p $S
cd /home/user/rogue-emblem
rm -rf $S/$3.mp4.frames $S/$3.mp4; CHROMIUM_PATH=${CHROMIUM_PATH:-/opt/pw-browsers/chromium} node tools/cutscene/render.mjs --piece ${PIECE:-ford} --video $S/$3.mp4 --from $1 --to $2 --workers 4 >/dev/null 2>$S/$3.log || { tail -5 $S/$3.log; exit 1; }
N=$(python3 -c "print(round(($2-$1)*24))")
C=${4:-6}
R=$(( (N + C - 1) / C ))
ffmpeg -v error -y -i $S/$3.mp4 -vf "fps=24,scale=${W:-320}:-1,tile=${C}x${R}" -frames:v 1 $S/$3.jpg
echo $S/$3.jpg
