// DB-krypteringsnyckel för den valfria extra krypteringen (SQLCipher AES-256): en 256-bitars slumpnyckel som
// genereras EN gång — när användaren slår på krypteringen — och lagras i iOS Keychain. För att backupen ska
// kunna återställas på en NY enhet speglas nyckeln även till **iCloud Keychain** (synchronizable) via
// native-modulen icloud-sync → den följer med till nästa telefon, helt transparent.
//
// Invariant: en enhet som REDAN har en lokal nyckel behåller alltid den nyckeln och speglar upp den
// add-if-absent. En FÄRSK enhet adopterar kontots synkade nyckel om den finns (så dess DB krypteras med samma
// nyckel som backupen), annars genereras en ny och speglas upp. En nyckel skapas ALDRIG för att öppna en redan
// krypterad loggbok — bara getOrCreateDbKey (när krypteringen slås på) får generera.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as ICloud from '../modules/icloud-sync';

const KEY_ID = 'blades_db_key_v1';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let cached: string | null = null;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// Läsfel ≠ "ingen nyckel". Går Keychain inte att läsa just nu får vi ALDRIG gå vidare och skapa en ny nyckel:
// den skulle skriva över den riktiga och göra den krypterade databasen permanent oläsbar. Kasta i stället →
// startsekvensen visar felet med "Try again" (cachen sätts bara efter en lyckad läsning).
const legacyGet = async (): Promise<string | null> => {
  try { return await SecureStore.getItemAsync(KEY_ID, OPTS); }
  catch (e: any) { throw new Error(`Keychain unavailable: ${e?.message ?? e}`); }
};
// Kan nyckeln inte sparas → kasta (en databas krypterad med en osparad nyckel vore oläsbar vid nästa start).
const legacySet = (k: string) => SecureStore.setItemAsync(KEY_ID, k, OPTS);

// Läs den iCloud-synkade nyckeln (null om native saknas eller inget synkats hit). Kort retry för att
// ge iCloud Keychain tid att synka på en nyinstallerad enhet (vanligen redan klart efter enhets-setup).
async function fetchSyncedKey(retries = 0): Promise<string | null> {
  if (!ICloud.isAvailable()) return null;
  for (let i = 0; i <= retries; i++) {
    const k = await ICloud.getDbKey().catch(() => null);
    if (k) return k;
    if (i < retries) await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** Nyckeln finns varken lokalt eller i iCloud Keychain. Startsidan visar ett eget besked för den här koden. */
export class DbKeyMissingError extends Error {
  code = 'DB_KEY_MISSING' as const;
  constructor() {
    super('The encryption key for your logbook is not available on this device.');
    this.name = 'DbKeyMissingError';
  }
}

/** Den befintliga 256-bitars DB-nyckeln (64 hex-tecken) — för att öppna en redan krypterad loggbok.
 *  Skapar ALDRIG en ny: en ny nyckel kan inte läsa filen, och sparad lokalt skulle den för alltid skymma den
 *  riktiga nyckeln om den senare synkas hit. Saknas nyckeln kastas DbKeyMissingError.
 *  VIKTIGT: pushar ALDRIG nyckeln till iCloud Keychain. Det görs bara när en backup körs
 *  (services/icloudSync.backupNow → ICloud.setDbKey, add-if-absent). */
export async function getDbKey(): Promise<string> {
  if (cached) return cached;

  // 1) Finns en LOKAL nyckel? Den gäller alltid, oavsett vad som ligger i molnet.
  const legacy = await legacyGet();
  if (legacy) {
    cached = legacy;
    return legacy;
  }

  // 2) Ingen lokal nyckel: adoptera kontots synkade nyckel om den finns (vänta kort på iCloud Keychain).
  const synced = await fetchSyncedKey(5);
  if (synced) {
    await legacySet(synced);
    cached = synced;
    return synced;
  }

  throw new DbKeyMissingError();
}

/** Nyckel för att SLÅ PÅ extra kryptering: den befintliga om den finns (lokal → iCloud Keychain, så en färsk
 *  enhet krypterar med samma nyckel som kontots backuper), annars en ny som sparas LOKALT (pushas till iCloud
 *  först vid backup — annars kunde en långsam enhet skriva över kontots nyckel innan den hunnit synka hit). */
export async function getOrCreateDbKey(): Promise<string> {
  try {
    return await getDbKey();
  } catch (e) {
    if (!(e instanceof DbKeyMissingError)) throw e;
  }
  const fresh = toHex(await Crypto.getRandomBytesAsync(32));
  await legacySet(fresh);
  cached = fresh;
  return fresh;
}

/** Nycklar som en iCloud-backup kan vara krypterad med vid restore: kontots synkade nyckel först, sedan den
 *  lokala. Skapar aldrig en ny (en okrypterad backup behöver ingen nyckel alls). */
export async function getBackupKeyCandidates(): Promise<string[]> {
  const keys: string[] = [];
  const synced = await fetchSyncedKey(0);
  if (synced) keys.push(synced);
  const local = cached ?? (await legacyGet().catch(() => null));
  if (local && !keys.includes(local)) keys.push(local);
  return keys;
}
