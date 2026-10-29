#!/bin/zsh
# Deploys the website (website-v4) to blades-app.com.
# First stamps every css/js link and the logbook demo pages with a short hash of the file
# (site.css?v=3c07dd40; also /css/... in 404.html, which links from the root), so browsers fetch changed files at once: the blades-app.com zone keeps them
# in the browser cache for 4 hours. data-manned/data-unmanned are the logbook frame's manned/unmanned sources.
# The site's one server-side bit, /api/price (Premium price by the visitor's country), lives in website-functions/.
set -e
cd "$(dirname "$0")/website-v4"
python3 - <<'PY'
import glob, hashlib, re
files = glob.glob('css/*.css') + glob.glob('js/*.js') + glob.glob('demo/*.html')
ver = {f: hashlib.sha1(open(f, 'rb').read()).hexdigest()[:8] for f in files}
for page in glob.glob('*.html'):
    html = open(page).read()
    for f, v in ver.items():
        html = re.sub(r'((?:href|src|data-manned|data-unmanned)="/?' + re.escape(f) + r')(\?v=[0-9a-f]+)?"', r'\1?v=' + v + '"', html)
    open(page, 'w').write(html)
print('Stamped', len(ver), 'files in', len(glob.glob('*.html')), 'pages')
PY
cd ../website-functions
# Run from website-functions/ so Pages picks up its functions/ (the site's own /api/price) next to the pages.
# --branch main: production (blades-app.com) whatever git branch this runs on; without it another branch would only
# make a preview.
npx wrangler pages deploy ../website-v4 --project-name blades-website --branch main --commit-dirty=true
