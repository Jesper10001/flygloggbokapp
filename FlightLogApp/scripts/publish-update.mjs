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
//
// Säkerhet:
//  • .env läses aldrig (EXPO_NO_DOTENV=1) — där ligger utvecklarnycklar som aldrig får hamna i appen.
//  • Proxyadress, RevenueCat-nyckel och Sentry-DSN tas ur eas.json → build.production.env, samma som App Store-bygget.
//    Saknas något av dem i paketet avbryts publiceringen (annars slutar köp eller felrapporter fungera för alla).
//  • Paketet exporteras först och genomsöks efter hemliga nycklar innan något laddas upp.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run'); // exportera och kontrollera, men ladda inte upp
const [target, ...rest] = process.argv.slice(2).filter((a) => a !== '--dry-run');
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

const out = path.join(root, 'dist-update');
rmSync(out, { recursive: true, force: true });
run(['expo', 'export', '--platform', 'ios', '--output-dir', out], env);

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
const leaks = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, 'en Anthropic-nyckel'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'en privat nyckel'],
].filter(([re]) => re.test(text)).map(([, what]) => what);
// Exakta värden ur .env (utvecklarnycklar) som inte är publika produktionsvärden får aldrig finnas i paketet.
// Breda mönster som "sk_" ger falsklarm i Hermes-paketet, där strängarna ligger tätt ihop. Värdena skrivs aldrig ut.
const dotenv = path.join(root, '.env');
if (existsSync(dotenv)) {
  const publicValues = new Set(Object.values(buildEnv));
  for (const line of readFileSync(dotenv, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12 && !publicValues.has(value) && text.includes(value)) leaks.push(`värdet av ${m[1]} ur .env`);
  }
}
if (leaks.length) {
  rmSync(out, { recursive: true, force: true });
  console.error(`\nAvbrutet: paketet innehåller ${leaks.join(' och ')}. Inget har laddats upp.`);
  process.exit(1);
}
const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
const expected = [
  [host(buildEnv.EXPO_PUBLIC_PROXY_URL), 'proxyadressen'],
  [buildEnv.EXPO_PUBLIC_REVENUECAT_IOS_KEY, 'RevenueCat-nyckeln'],
  [host(buildEnv.EXPO_PUBLIC_SENTRY_DSN), 'Sentry-adressen'],
].filter(([v]) => !v || !text.includes(v));
if (expected.length) {
  rmSync(out, { recursive: true, force: true });
  console.error(`\nAvbrutet: paketet saknar ${expected.map(([, what]) => what).join(', ')} från eas.json. Inget har laddats upp.`);
  process.exit(1);
}
console.log(`\nKontroll OK: ${bundles.length} paket, inga nycklar, produktionsvärdena finns med.`);
if (dryRun) {
  rmSync(out, { recursive: true, force: true });
  console.log('Torrkörning: inget laddades upp.');
  process.exit(0);
}

run(['eas-cli', 'update', '--branch', 'preview', '--message', message, '--platform', 'ios',
  '--skip-bundler', '--input-dir', out, '--non-interactive'], env);
rmSync(out, { recursive: true, force: true });
console.log('\nKlart: uppdateringen ligger på testkanalen. Starta om TestFlight-appen två gånger: första starten hämtar, andra använder den.');
