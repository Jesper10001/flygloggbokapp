#!/usr/bin/env node
// Genererar constants/licenses.json → Settings → About → Acknowledgements. Listar öppen källkod och typsnitt som
// FAKTISKT skeppas i iOS-appen (inte hela node_modules, där det mesta är byggverktyg):
//  1) JS-paket i produktionsbundlen — ur source map från `npx expo export --platform ios --source-maps`
//  2) Autolänkade native-moduler (expo-modules-autolinking) — deras native-kod länkas in i appen
//  3) Native-/inbäddade komponenter som inte är npm-paket: React Natives pods, SQLCipher, RevenueCat-SDK:erna,
//     globe.gl-paketet i assets/globe m.fl. Licenstexterna ligger i scripts/third-party-licenses/ (hämtade ur
//     respektive repo 2026-10-27) så skriptet fungerar offline.
//  4) Typsnitt i assets/fonts + ikonfonterna i @expo/vector-icons
// Identiska licenstexter (t.ex. MIT) lagras en gång; varje post har egna upphovsrättsrader.
//
// Kör före release (och efter nya beroenden):  node scripts/gen-licenses.mjs [sökväg/till/entry.hbc.map]
// Utan argument körs exporten (~1,5 min) i en temporär katalog.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'constants', 'licenses.json');
const THIRD = path.join(ROOT, 'scripts', 'third-party-licenses');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

// ── 1) Source map ────────────────────────────────────────────────────────────
function findMap(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const m = findMap(p); if (m) return m; }
    else if (/\.map$/.test(e.name) && /entry/.test(e.name)) return p;
  }
  return null;
}
let mapPath = process.argv[2];
let tmp = null;
if (!mapPath) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blades-lic-'));
  console.log(`Exporterar iOS-bundle med source maps → ${tmp} …`);
  execSync(`npx expo export --platform ios --source-maps --output-dir "${tmp}"`, { cwd: ROOT, stdio: 'inherit' });
  mapPath = findMap(tmp);
}
if (!mapPath || !fs.existsSync(mapPath)) throw new Error('Hittade ingen source map (entry*.map).');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); // exporten behövs inte längre (~40 MB)

const pkgDirs = new Set();
// Källsökvägarna är relativa till bundlens standardplats (dist/_expo/static/js/ios), inte projektroten →
// förankra vid FÖRSTA node_modules/ (behåller nästlade node_modules/a/node_modules/b) under ROOT.
const addPkgFromPath = (p) => {
  const first = p.indexOf('node_modules/');
  if (first < 0) return;
  const rel = p.slice(first);
  const i = rel.lastIndexOf('node_modules/');
  const rest = rel.slice(i + 13).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  pkgDirs.add(path.join(ROOT, rel.slice(0, i + 13) + name));
};
for (const s of map.sources ?? []) addPkgFromPath(s);
const fromBundle = pkgDirs.size;

// ── 2) Autolänkade native-moduler ────────────────────────────────────────────
const resolvePkgDir = (name) => {
  const direct = path.join(ROOT, 'node_modules', name);
  if (fs.existsSync(path.join(direct, 'package.json'))) return direct;
  try { return path.dirname(execSync(`node -p "require.resolve('${name}/package.json')"`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); }
  catch { return null; }
};
try {
  const expo = JSON.parse(execSync('npx expo-modules-autolinking resolve --platform ios --json', { cwd: ROOT }).toString());
  for (const m of expo.modules ?? []) {
    const dir = resolvePkgDir(m.packageName);
    if (dir && dir.includes('node_modules')) pkgDirs.add(dir); // lokala moduler (modules/…) är appens egen kod
  }
  const rn = JSON.parse(execSync('npx expo-modules-autolinking react-native-config --platform ios --json', { cwd: ROOT }).toString());
  for (const [name, d] of Object.entries(rn.dependencies ?? {})) {
    const dir = d?.root || resolvePkgDir(name);
    if (dir && dir.includes('node_modules')) pkgDirs.add(dir);
  }
} catch (e) {
  console.warn('⚠️  autolinking kunde inte läsas — native-moduler som saknas i bundlen kan fattas:', e.message);
}

// ── Licenstext → (upphovsrättsrader, brödtext) ───────────────────────────────
const texts = {};               // id → brödtext (en per unik licens)
// Riktiga notiser: "Copyright (c) …", "Copyright © …", "Copyright 2021 …", "© 2010 …", "(c) 2004 …" — inte meningar i
// licenstexten som börjar med ordet ("copyright notice that is included…" i Apache-2.0).
const COPYRIGHT_LINE = /^\s*(copyright\s*(\(c\)|©|\d{4})|©\s*\d{4}|\(c\)\s*\d{4})/i;
function addText(body) {
  const id = crypto.createHash('sha1').update(body).digest('hex').slice(0, 10);
  texts[id] = body;
  return id;
}
/** Delar en licenstext i upphovsrättsrader + brödtext. Stycken slås ihop till en rad (mobilen radbryter själv)
 *  och titelrader som "MIT License" tas bort → samma licens med olika radbrytning/titel lagras en gång. */
function splitLicense(raw) {
  const lines = raw.split('\n');
  const copyright = [];
  const rest = [];
  for (const l of lines) {
    if (COPYRIGHT_LINE.test(l) && copyright.length < 6 && !/above copyright/i.test(l)) copyright.push(l.trim());
    else if (copyright.length && /,$/.test(copyright[copyright.length - 1]) && /^\s*with Reserved Font Name/i.test(l)) copyright[copyright.length - 1] += ' ' + l.trim();
    else rest.push(l);
  }
  const body = rest.join('\n')
    .replace(/^\s*(the )?mit license( \(mit\))?\s*$/gim, '')
    .replace(/^\s*all rights reserved\.?\s*$/gim, '')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((x) => x.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return { copyright, body };
}

// Standardtexter när ett paket saknar licensfil (sällsynt) — MIT/ISC/0BSD räcker för det som förekommer.
const STANDARD = {
  MIT: 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  '0BSD': 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
};

const repoUrl = (pkg) => {
  let u = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!u) return pkg.homepage || `https://www.npmjs.com/package/${pkg.name}`;
  u = u.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://');
  if (/^github:/.test(u)) u = 'https://github.com/' + u.slice(7);
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = 'https://github.com/' + u;
  return u;
};
const licenseId = (pkg) => {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ');
  return 'UNKNOWN';
};
const authorName = (a) => (typeof a === 'string' ? a.replace(/\s*[<(].*$/, '') : a?.name) || '';

// ── 3) npm-paketen ───────────────────────────────────────────────────────────
const appPkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const software = new Map(); // namn → post (en per paketnamn; dubbletter i olika versioner slås ihop)
const missing = [];
const unreadable = [];
for (const dir of [...pkgDirs].sort()) {
  let pkg;
  try { pkg = JSON.parse(read(path.join(dir, 'package.json'))); } catch { unreadable.push(path.relative(ROOT, dir)); continue; }
  if (!pkg.name || pkg.name === appPkg.name) continue;
  const files = fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying)([.-_].*)?$/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
  files.sort((a, b) => a.length - b.length);
  const lic = licenseId(pkg);
  let copyright = [];
  let body = '';
  if (files.length) {
    let raw = read(path.join(dir, files[0]));
    const notice = fs.readdirSync(dir).find((f) => /^notice(\..*)?$/i.test(f));
    if (notice) raw += '\n\n' + read(path.join(dir, notice));
    ({ copyright, body } = splitLicense(raw));
  } else {
    const std = STANDARD[lic.replace(/[()]/g, '').split(' ')[0]];
    if (!std) missing.push(`${pkg.name}@${pkg.version} (${lic})`);
    body = std || `Licensed under ${lic}. See ${repoUrl(pkg)}.`;
    const who = authorName(pkg.author);
    if (who) copyright = [`Copyright (c) ${who}`];
  }
  // React Natives/Metros delpaket skeppas utan egen licensfil — samma upphovsman som react-native (Meta).
  if (!copyright.length && /^(@react-native\/|metro)/.test(pkg.name)) copyright = ['Copyright (c) Meta Platforms, Inc. and affiliates.'];
  const prev = software.get(pkg.name);
  if (prev && prev.version >= pkg.version) continue;
  software.set(pkg.name, { name: pkg.name, version: pkg.version, license: lic, url: repoUrl(pkg), copyright, text: addText(body) });
}

// ── 4) Native-/inbäddade komponenter (inte npm-paket) ─────────────────────────
const fromFile = (file) => splitLicense(read(file));
const globeBundle = read(path.join(ROOT, 'assets/globe/globe-gl-2.34.4.dat'));
const helvetiker = (() => {
  const i = globeBundle.indexOf("license_description:'");
  const j = globeBundle.indexOf("',manufacturer_name", i);
  return i > 0 && j > i ? globeBundle.slice(i + 21, j).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
})();
const NATIVE = [
  // React Native-runtime (pods)
  { name: 'Hermes', license: 'MIT', url: 'https://github.com/facebook/hermes', ...fromFile(path.join(THIRD, 'hermes.txt')) },
  { name: 'Folly', license: 'Apache-2.0', url: 'https://github.com/facebook/folly', ...fromFile(path.join(THIRD, 'folly.txt')), copyright: ['Copyright (c) Meta Platforms, Inc. and affiliates.'] },
  { name: 'glog', license: 'BSD-3-Clause', url: 'https://github.com/google/glog', ...fromFile(path.join(THIRD, 'glog.txt')) },
  { name: 'Boost', license: 'BSL-1.0', url: 'https://www.boost.org', ...fromFile(path.join(THIRD, 'boost.txt')) },
  { name: 'double-conversion', license: 'BSD-3-Clause', url: 'https://github.com/google/double-conversion', ...fromFile(path.join(THIRD, 'double-conversion.txt')) },
  { name: '{fmt}', license: 'MIT', url: 'https://github.com/fmtlib/fmt', ...fromFile(path.join(THIRD, 'fmt.txt')) },
  { name: 'fast_float', license: 'MIT', url: 'https://github.com/fastfloat/fast_float', ...fromFile(path.join(THIRD, 'fast_float.txt')) },
  // Databas (op-sqlite bygger in SQLCipher, som bygger på SQLite)
  { name: 'SQLCipher', license: 'BSD-3-Clause', url: 'https://www.zetetic.net/sqlcipher/', ...fromFile(path.join(ROOT, 'node_modules/@op-engineering/op-sqlite/cpp/sqlcipher/LICENSE.txt')) },
  { name: 'SQLite', license: 'Public domain', url: 'https://sqlite.org/copyright.html', copyright: [], body: 'The author disclaims copyright to this source code. SQLite is in the public domain.' },
  // Köp (react-native-purchases drar in RevenueCats native-SDK:er)
  { name: 'RevenueCat SDK (purchases-ios)', license: 'MIT', url: 'https://github.com/RevenueCat/purchases-ios', ...fromFile(path.join(THIRD, 'purchases-ios.txt')) },
  { name: 'PurchasesHybridCommon', license: 'MIT', url: 'https://github.com/RevenueCat/purchases-hybrid-common', ...fromFile(path.join(THIRD, 'purchases-hybrid-common.txt')) },
  // Kraschrapporter (@sentry/react-native drar in Sentrys native-SDK)
  { name: 'Sentry Cocoa SDK', license: 'MIT', url: 'https://github.com/getsentry/sentry-cocoa', ...fromFile(path.join(THIRD, 'sentry-cocoa.txt')) },
  // Dashboard-globen (assets/globe: globe.gl 2.34.4 med inbyggda beroenden, i en WebView)
  { name: 'globe.gl 2.34.4', license: 'MIT', url: 'https://github.com/vasturiano/globe.gl', ...fromFile(path.join(THIRD, 'globe.gl.txt')),
    note: 'Bundled with its dependencies, including three-globe, three-render-objects, kapsule, tween.js, d3 modules, tinycolor2 and earcut (MIT/ISC/BSD licensed).' },
  { name: 'three-globe', license: 'MIT', url: 'https://github.com/vasturiano/three-globe', ...fromFile(path.join(THIRD, 'three-globe.txt')) },
  { name: 'three.js', license: 'MIT', url: 'https://github.com/mrdoob/three.js', ...fromFile(path.join(THIRD, 'three.js.txt')) },
  { name: 'H3 (h3-js)', license: 'Apache-2.0', url: 'https://github.com/uber/h3-js', ...fromFile(path.join(THIRD, 'h3-js.txt')), copyright: ['Copyright 2018-2019, 2022 Uber Technologies, Inc.'] },
  ...(helvetiker ? [{ name: 'Helvetiker typeface (MgOpen)', license: 'MgOpen', url: 'http://www.ellak.gr/fonts/MgOpen/license.html', ...splitLicense(helvetiker) }] : []),
  // Övrigt inbäddat
  { name: 'SunCalc (ported)', license: 'BSD-2-Clause', url: 'https://github.com/mourner/suncalc', ...fromFile(path.join(THIRD, 'suncalc.txt')) },
  { name: 'flag-icons 7.5.0', license: 'MIT', url: 'https://github.com/lipis/flag-icons', ...fromFile(path.join(ROOT, 'assets/flag-icons-main/LICENSE')) },
];
for (const n of NATIVE) {
  software.set(n.name, { name: n.name, version: '', license: n.license, url: n.url, copyright: n.copyright, text: addText(n.body), ...(n.note ? { note: n.note } : {}) });
}

// ── 5) Typsnitt (upphovsrätt ur filernas namntabell, verifierad 2026-10-27) ───
const ofl = splitLicense(read(path.join(ROOT, 'assets/fonts/Chakra_Petch/OFL.txt'))).body;
const oflId = addText(ofl);
const dseg = splitLicense(read(path.join(ROOT, 'assets/fonts/fonts-DSEG_v046/DSEG-LICENSE.txt')));
const fonts = [
  { name: 'Fraunces', license: 'OFL-1.1', url: 'https://github.com/undercasetype/Fraunces', copyright: ['Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)'], text: oflId },
  { name: 'JetBrains Mono', license: 'OFL-1.1', url: 'https://github.com/JetBrains/JetBrainsMono', copyright: ['Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)'], text: oflId },
  { name: 'Space Grotesk', license: 'OFL-1.1', url: 'https://github.com/floriankarsten/space-grotesk', copyright: ['Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)'], text: oflId },
  { name: 'Chakra Petch', license: 'OFL-1.1', url: 'https://github.com/cadsondemak/chakra-petch', copyright: ['Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git)'], text: oflId },
  { name: 'DSEG7 Classic', license: 'OFL-1.1', url: 'https://www.keshikan.net/fonts-e.html', copyright: dseg.copyright, text: addText(dseg.body) },
  { name: 'Ionicons', license: 'MIT', url: 'https://ionic.io/ionicons', copyright: ['Copyright (c) 2015-present Ionic (http://ionic.io/)'], text: addText(STANDARD.MIT) },
  { name: 'Material Design Icons', license: 'Pictogrammers Free License', url: 'https://pictogrammers.com/docs/general/license/', copyright: ['Copyright (c) Pictogrammers'], text: addText('Icons from the Material Design Icons collection by Pictogrammers, used under the Pictogrammers Free License. See https://pictogrammers.com/docs/general/license/') },
];

// ── 6) Data och innehåll (attribution; licenser verifierade 2026-10-27) ──────
const mitId = addText(STANDARD.MIT);
const data = [
  { name: 'airportmap.de', credit: 'Airport database by komed3 — airport names, codes and positions.', license: 'MIT',
    url: 'https://github.com/komed3/airportmap-database', ...splitLicense(read(path.join(THIRD, 'airportmap-database.txt'))) },
  { name: 'OurAirports', credit: 'Airports, runways and radio frequencies.', license: 'Public domain', url: 'https://ourairports.com/data/' },
  { name: 'Natural Earth', credit: 'Country and region borders. Made with Natural Earth.', license: 'Public domain', url: 'https://www.naturalearthdata.com' },
  { name: 'geoBoundaries', license: 'CC BY 4.0 · ODbL 1.0 · Public domain', url: 'https://www.geoboundaries.org',
    credit: 'Up-to-date region borders for Norway, Kenya, DR Congo and Kazakhstan (gbOpen ADM1, simplified). Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries. PLoS ONE 15(4): e0231866.\n\n'
      + 'Norway: © Kartverket, licensed under CC BY 4.0. Kenya: RCMRD GeoPortal, public domain. DR Congo and Kazakhstan: © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0 — the derived boundary data for these two countries is available under the ODbL on request: support@blades-app.com.' },
  { name: 'Aviation Weather Center (NOAA)', credit: 'METAR and TAF reports from aviationweather.gov.', license: 'Public domain (U.S. Government)', url: 'https://aviationweather.gov' },
  { name: 'Esri World Imagery', credit: 'Satellite imagery on shared flight cards. Powered by Esri. Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community.', license: 'Esri terms of use', url: 'https://www.esri.com/en-us/legal/terms/full-master-agreement' },
  { name: 'Wikimedia Commons & Wikipedia', credit: 'Aircraft and drone photos on Fleet cards. Each photo shows its author and license on the card — tap the credit to open the photo’s page. Photos may be cropped or have their background removed for display.', license: 'CC BY · CC BY-SA · Public domain', url: 'https://commons.wikimedia.org' },
  { name: 'Apple Maps', credit: 'Maps and satellite views in the app are provided by Apple. Legal notices are shown on the map itself.', license: 'Apple', url: 'https://www.apple.com/legal/internet-services/maps/' },
  { name: 'three-globe', credit: 'Night-lights and topology textures on the dashboard globe come from the three-globe project.', license: 'MIT', url: 'https://github.com/vasturiano/three-globe', ...splitLicense(read(path.join(THIRD, 'three-globe.txt'))) },
].map((d) => ({ name: d.name, credit: d.credit, license: d.license, url: d.url, ...(d.body ? { copyright: d.copyright, text: addText(d.body) } : {}) }));
void mitId;

// ── Skriv ────────────────────────────────────────────────────────────────────
const sorted = [...software.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
const out = { generated: new Date().toISOString().slice(0, 10), texts, data, software: sorted, fonts };
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`✓ ${path.relative(ROOT, OUT)}: ${data.length} datakällor, ${sorted.length} programvaror (${fromBundle} paket ur bundlen + autolinking + ${NATIVE.length} native), ${fonts.length} typsnitt, ${Object.keys(texts).length} unika licenstexter, ${kb} kB`);
if (missing.length) console.log('⚠️  saknar licensfil (fick standard-/hänvisningstext):\n   ' + missing.join('\n   '));
if (unreadable.length) console.log('ℹ️  ej paket (ingen package.json):\n   ' + unreadable.join('\n   '));
