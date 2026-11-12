#!/bin/zsh
# Deploys the NEXT website (website-v5, the site for the coming app version) to a test address only:
#   https://next.blades-website.pages.dev
# It never touches blades-app.com (that is ./deploy-website.sh, which deploys website-v4 to the branch main).
# Same stamping as deploy-website.sh: css/js/demo links get a short hash so browsers fetch changed files at once.
set -e
cd "$(dirname "$0")/website-v5"
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
npx wrangler pages deploy ../website-v5 --project-name blades-website --branch next --commit-dirty=true
