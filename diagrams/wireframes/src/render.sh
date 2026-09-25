#!/usr/bin/env bash
# Screenshots every built wireframe page to ../<name>.png
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUTD="$(cygpath -m ..)"
while read -r name h || [ -n "$name" ]; do h="${h//[^0-9]/}"
  "$CH" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --screenshot="$OUTD/$name.png" --window-size=1346,$((h + 66)) "file:///$(cygpath -m "$PWD")/$name.html" 2>/dev/null
done < sizes.txt
