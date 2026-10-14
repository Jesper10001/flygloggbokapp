#!/bin/zsh
# Gör råa iPhone-skärmdumpar webbredo för blades-app.com.
#   1) Lägg skärmdumparna i screenshots/raw/ med rätt filnamn (se listan nedan), t.ex. hero-pilot.png.
#   2) Kör:  ./screenshots/optimize.sh
# Resultat: website/screens/<namn>.jpg (max 1800 px hög, JPEG 82 %). Sajten visar dem automatiskt —
# saknas en bild ligger dagens mockup/glob kvar på den platsen. Råbilderna ligger UTANFÖR website/
# så de aldrig laddas upp (stora filer + kan innehålla personlig info).
set -e
cd "${0:A:h}"
OUT="../website/screens"
mkdir -p raw "$OUT"
names=(hero-pilot hero-drone role-pilot role-drone how-log how-book how-book-drone how-insights map)
count=0
for f in raw/*.(png|PNG|jpg|JPG|jpeg|JPEG|heic|HEIC)(N); do
  base="${${f:t}:r}"
  if (( ! ${names[(Ie)$base]} )); then
    echo "⚠︎  okänt filnamn: ${f:t}  (förväntat: ${names[*]})"
    continue
  fi
  sips -s format jpeg -s formatOptions 82 -Z 1800 "$f" --out "$OUT/$base.jpg" >/dev/null
  echo "✓  $base.jpg  ($(( $(stat -f%z "$OUT/$base.jpg") / 1024 )) KB)"
  count=$((count + 1))
done
(( count )) || echo "Inga bilder i screenshots/raw/ ännu."
