#!/bin/zsh
# Regenerates the raw GPT Image textures listed in prompts.json into $OUT (default /tmp/meche-tex),
# then `python3 scripts/textures/process.py` turns them into public/textures/*.
set -e
OUT=${OUT:-/tmp/meche-tex}
mkdir -p $OUT
DIR=${0:a:h}
for name in $(python3 -c "import json;print(' '.join(json.load(open('$DIR/prompts.json'))))"); do
  size=$(python3 -c "import json;print(json.load(open('$DIR/prompts.json'))['$name']['size'])")
  prompt=$(python3 -c "import json;print(json.load(open('$DIR/prompts.json'))['$name']['prompt'])")
  [ -f $OUT/$name.png ] && [ -z "$FORCE" ] && continue
  python3 ~/.claude/scripts/generate_image.py "$prompt" $OUT/$name.png --size $size --quality high > $OUT/$name.log 2>&1 &
done
wait
ls -la $OUT
