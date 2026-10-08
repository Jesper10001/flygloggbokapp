// DB-krypteringsnyckel: en 256-bitars slumpnyckel som genereras EN gång och lagras i iOS Keychain.
// För att backupen ska kunna återställas på en NY enhet speglas nyckeln även till **iCloud Keychain**
// (synchronizable) via native-modulen icloud-sync → den följer med till nästa telefon, helt transparent.
//
// Invariant: en enhet som REDAN har en lokal nyckel (och därmed en DB krypterad med den) behåller alltid
// den nyckeln och speglar upp den add-if-absent. En FÄRSK enhet adopterar kontots synkade nyckel om den
// finns (så dess DB skapas med samma nyckel som backupen), annars genereras en ny och speglas upp.
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

const legacyGet = () => SecureStore.getItemAsync(KEY_ID, OPTS).catch(() => null);
const legacySet = (k: string) => SecureStore.setItemAsync(KEY_ID, k, OPTS).catch(() => {});

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

/** Hämtar (eller skapar en gång) den 256-bitars DB-nyckeln. 64 hex-tecken.
 *  VIKTIGT: denna funktion pushar ALDRIG nyckeln till iCloud Keychain. Det görs bara när en backup körs
 *  (services/icloudSync.backupNow → ICloud.setDbKey, add-if-absent). Annars skulle en ny/långsam enhet
 *  kunna generera en nyckel och skriva över kontots kanoniska nyckel innan den riktiga hunnit synka hit
 *  → backupen vore permanent oläsbar. */
export async function getDbKey(): Promise<string> {
  if (cached) return cached;

  // 1) Finns redan en LOKAL nyckel? Då har den här enhetens DB redan krypterats med den → behåll den,
  //    oavsett vad som ligger i molnet (att byta nu skulle göra den lokala DB:n oläsbar).
  const legacy = await legacyGet();
  if (legacy) {
    cached = legacy;
    return legacy;
  }

  // 2) Färsk enhet (ingen lokal nyckel): adoptera kontots synkade nyckel om den finns (vänta kort) → då
  //    skapas den lokala DB:n med SAMMA nyckel som backupen och restore kan dekryptera den.
  const synced = await fetchSyncedKey(5);
  if (synced) {
    await legacySet(synced);
    cached = synced;
    return synced;
  }

  // 3) Ingen nyckel någonstans → generera och spara LOKALT (pushas till iCloud först vid backup).
  const fresh = toHex(await Crypto.getRandomBytesAsync(32));
  await legacySet(fresh);
  cached = fresh;
  return fresh;
}

/** Nyckeln som en iCloud-backup är krypterad med (= kontots synkade nyckel). Används vid restore för att
 *  ATTACH:a snapshoten. Faller tillbaka på den lokala nyckeln (samma enhet / native saknas). */
export async function getBackupKey(): Promise<string> {
  const synced = await fetchSyncedKey(0);
  if (synced) return synced;
  return getDbKey();
}
