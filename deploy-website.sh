#!/bin/zsh
# Deploys the website (website-v4) to blades-app.com.
# First stamps every css/js link with a short hash of the file (site.css?v=3c07dd40), so browsers
# fetch changed files at once: the blades-app.com zone keeps css/js in the browser cache for 4 hours.
set -e
cd "$(dirname "$0")/website-v4"
python3 - <<'PY'
import glob, hashlib, re
files = glob.glob('css/*.css') + glob.glob('js/*.js')
ver = {f: hashlib.sha1(open(f, 'rb').read()).hexdigest()[:8] for f in files}
for page in glob.glob('*.html'):
    html = open(page).read()
    for f, v in ver.items():
        html = re.sub(r'((?:href|src)="' + re.escape(f) + r')(\?v=[0-9a-f]+)?"', r'\1?v=' + v + '"', html)
    open(page, 'w').write(html)
print('Stamped', len(ver), 'files in', len(glob.glob('*.html')), 'pages')
PY
cd ..
npx wrangler pages deploy website-v4 --project-name blades-website --commit-dirty=true
