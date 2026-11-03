// Publicerar en EAS Update: ny JS-kod till appen utan App Store-granskning (bara rättningar och små förbättringar
// av det Apple redan godkänt — nya funktioner, behörigheter och inbyggda moduler går som vanlig uppdatering).
//
//   node scripts/publish-update.mjs preview "Rättar BLADES-IOS-9: flygningsvyn utan rutt"
//       → testkanalen. Bara din TestFlight-app (byggd med --profile testflight) får den.
//   node scripts/publish-update.mjs production
//       → flyttar den senast publicerade preview-uppdateringen, exakt som du testade den, till alla användare.
//         Bygger inget nytt. Körs bara när du sagt "publicera".
//   node scripts/publish-update.mjs preview "…" --dry-run
//       → exporterar och kontrollerar paketet, men laddar inte upp.
//   Vad som är nytt ("Blades was updated"-popupen, UpdateAppliedModal) står i constants/updateNotes.json: en ny
//   post överst (id +1) per uppdatering, committad med koden, med bara den uppdateringens egna ändringar på engelska.
//   Popupen visar posterna sedan användaren senast såg den, så den som hoppat över några får de största.
//   Följer med när paketet flyttas till production, så skriv för användarna.
//   node scripts/publish-update.mjs preview "…" --no-notes
//       → en tyst rättning utan ny post (popupen visar då bara rubriken).
//
// Säkerhet:
//  • .env läses aldrig (EXPO_NO_DOTENV=1) — där ligger utvecklarnycklar som aldrig får hamna i appen.
//  • Proxyadress, RevenueCat-nyckel och Sentry-DSN tas ur eas.json → build.production.env, samma som App Store-bygget.
//    Saknas något av dem i paketet avbryts publiceringen (annars slutar köp eller felrapporter fungera för alla).
//  • Paketet exporteras först och genomsöks efter hemliga nycklar innan något laddas upp.
//  • Källkartorna går till Sentry efter publiceringen. Token hämtas ur EAS (miljön production) och skrivs aldrig ut.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run'); // exportera och kontrollera, men ladda inte upp
const noNotes = process.argv.includes('--no-notes');
if (process.argv.includes('--notes')) {
  console.error('--notes används inte längre: lägg raderna som en ny post överst i constants/updateNotes.json (id +1) och committa.');
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => a !== '--dry-run' && a !== '--no-notes');
const [target, ...rest] = args;
const message = rest.join(' ').trim();
const usage = () => {
  console.error('Användning:\n  node scripts/publish-update.mjs preview "vad som ändrats"\n  node scripts/publish-update.mjs production ["notering"]');
  process.exit(2);
};
const run = (args, env = process.env) => {
  const r = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (target === 'production') {
  // Samma uppdateringsgrupp som testades på preview publiceras om på production — inget byggs om.
  run(['eas-cli', 'update:republish', '--branch', 'preview', '--destination-branch', 'production',
    '--message', message || 'Testad på preview', '--non-interactive']);
  console.log('\nKlart: uppdateringen går nu till alla användare. De får den nästa gång de startar appen med nät.');
  process.exit(0);
}
if (target !== 'preview' || !message) usage();

// Byggmiljön ur eas.json, inget annat (inga EXPO_PUBLIC_-variabler från skalet eller .env).
const eas = JSON.parse(readFileSync(path.join(root, 'eas.json'), 'utf8'));
const buildEnv = eas.build?.production?.env ?? {};
const env = { ...process.env, ...buildEnv, EXPO_NO_DOTENV: '1', NODE_ENV: 'production' };
for (const k of Object.keys(env)) if (k.startsWith('EXPO_PUBLIC_') && !(k in buildEnv)) delete env[k];

// Popupens rader: constants/updateNotes.json. Varje post ska ha ett eget id och märkta rader.
const notesData = JSON.parse(readFileSync(path.join(root, 'constants', 'updateNotes.json'), 'utf8'));
const entries = notesData.updates ?? [];
const notesProblem = entries.find((e, i) => !Number.isInteger(e.id) || e.id < 1 || (i > 0 && e.id >= entries[i - 1].id)
  || !Array.isArray(e.notes) || !e.notes.length || e.notes.some((l) => typeof l !== 'string' || !/^(New|Improved|Fixed):\s\S/.test(l)));
if (notesProblem) {
  console.error(`\nAvbrutet: constants/updateNotes.json, post ${notesProblem.id ?? '?'}: id:n ska minska nedåt i listan och varje rad börja med New:, Improved: eller Fixed:.`);
  process.exit(1);
}
const newest = entries[0];
// Förra uppdateringens post står i dess meddelande ("[notes N]"). Samma post igen = ingen ny post skrevs.
const listed = spawnSync('npx', ['eas-cli', 'update:list', '--branch', 'preview', '--limit', '1', '--json', '--non-interactive'], { cwd: root, encoding: 'utf8' });
const lastNotes = Number((listed.stdout ?? '').match(/\[notes (\d+)\]/)?.[1] ?? 0);
if (!noNotes && (!newest || newest.id <= lastNotes)) {
  console.error(`\nAvbrutet: ingen ny post i constants/updateNotes.json sedan förra uppdateringen (post ${lastNotes}). Lägg till en överst (id ${lastNotes + 1}) och committa, eller kör med --no-notes för en tyst rättning.`);
  process.exit(1);
}
const notes = !noNotes && newest ? newest.notes : [];
const publishMessage = newest ? `${message} [notes ${newest.id}]` : message;
console.log(notes.length ? `Popupen visar (post ${newest.id}):\n  ${notes.join('\n  ')}` : 'Ingen ny post: popupen visar bara rubriken.');

const out = path.join(root, 'dist-update');
rmSync(out, { recursive: true, force: true });
// --clear: Metros cache minns EXPO_PUBLIC_-värden från förra exporten (eller dev-servern), så utan den kan
// fel miljö följa med.
run(['expo', 'export', '--platform', 'ios', '--output-dir', out, '--source-maps', '--clear'], env);

// Kontroll av paketet innan uppladdning.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(hbc|js|json)$/.test(name) && !name.endsWith('.map')) files.push(p);
  }
};
walk(out);
const bundles = files.filter((f) => /\.(hbc|js)$/.test(f));
if (!bundles.length || !existsSync(path.join(out, 'metadata.json'))) {
  console.error('\nAvbrutet: exporten saknar JS-paket eller metadata.json.');
  process.exit(1);
}
const text = bundles.map((f) => readFileSync(f).toString('latin1')).join('\n');
// Källkartorna går också iväg (till Sentry), så de genomsöks efter nycklar på samma sätt.
const maps = [];
const walkMaps = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkMaps(p);
    else if (name.endsWith('.map')) maps.push(p);
  }
};
walkMaps(out);
const mapText = maps.map((f) => readFileSync(f).toString('latin1')).join('\n');
const leaks = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, 'en Anthropic-nyckel'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'en privat nyckel'],
].filter(([re]) => re.test(text) || re.test(mapText)).map(([, what]) => what);
// Exakta värden ur .env (utvecklarnycklar) som inte är publika produktionsvärden får aldrig finnas i paketet.
// Breda mönster som "sk_" ger falsklarm i Hermes-paketet, där strängarna ligger tätt ihop. Värdena skrivs aldrig ut.
const dotenv = path.join(root, '.env');
if (existsSync(dotenv)) {
  const publicValues = new Set(Object.values(buildEnv));
  for (const line of readFileSync(dotenv, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12 && !publicValues.has(value) && (text.includes(value) || mapText.includes(value))) leaks.push(`värdet av ${m[1]} ur .env`);
  }
}
if (leaks.length) {
  rmSync(out, { recursive: true, force: true });
  console.error(`\nAvbrutet: paketet innehåller ${leaks.join(' och ')}. Inget har laddats upp.`);
  process.exit(1);
}
const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
const expected = [
  [host(buildEnv.EXPO_PUBLIC_PROXY_URL), 'proxyadressen ur eas.json'],
  [buildEnv.EXPO_PUBLIC_REVENUECAT_IOS_KEY, 'RevenueCat-nyckeln ur eas.json'],
  [host(buildEnv.EXPO_PUBLIC_SENTRY_DSN), 'Sentry-adressen ur eas.json'],
  ...(notes.length ? [[notes[0], 'raderna ur constants/updateNotes.json']] : []),
].filter(([v]) => !v || !text.includes(v));
if (expected.length) {
  rmSync(out, { recursive: true, force: true });
  console.error(`\nAvbrutet: paketet saknar ${expected.map(([, what]) => what).join(", ")}. Inget har laddats upp.`);
  process.exit(1);
}
console.log(`\nKontroll OK: ${bundles.length} paket och ${maps.length} källkartor, inga nycklar, produktionsvärdena finns med.`);
if (dryRun) {
  rmSync(out, { recursive: true, force: true });
  console.log('Torrkörning: inget laddades upp.');
  process.exit(0);
}

// --environment krävs av nyare eas-cli. Paketet är redan byggt (--skip-bundler), så miljön ändrar inget i det;
// production är samma miljö som TestFlight- och App Store-bygget.
run(['eas-cli', 'update', '--branch', 'preview', '--message', publishMessage, '--platform', 'ios', '--environment', 'production',
  '--skip-bundler', '--input-dir', out, '--non-interactive'], env);

// Källkartor till Sentry, så att en krasch i uppdateringen visar fil och rad. Uppdateringen är redan publicerad,
// så ett fel här stoppar ingenting — kraschen syns då bara utan källkod.
const sentryPlugin = (JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo?.plugins ?? [])
  .find((p) => Array.isArray(p) && p[0] === '@sentry/react-native')?.[1] ?? {};
const upload = maps.length ? spawnSync('npx', ['eas-cli', 'env:exec', 'production',
  `npx sentry-expo-upload-sourcemaps ${path.basename(out)}`, '--non-interactive'], {
  cwd: root, stdio: 'inherit',
  env: { ...env, SENTRY_ORG: sentryPlugin.organization, SENTRY_PROJECT: sentryPlugin.project, SENTRY_URL: sentryPlugin.url },
}) : { status: 1 };
if (upload.status !== 0) console.warn('\nVarning: källkartorna kom inte fram till Sentry. Uppdateringen fungerar, men krascher i den visas utan fil och rad.');
rmSync(out, { recursive: true, force: true });
console.log('\nKlart: uppdateringen ligger på testkanalen. Starta om TestFlight-appen två gånger: första starten hämtar, andra använder den.');
