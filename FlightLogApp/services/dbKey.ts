// DB-krypteringsnyckel: en 256-bitars slumpnyckel som genereras EN gång och lagras i iOS Keychain
// (expo-secure-store). Hämtas automatiskt vid appstart och används för att öppna SQLCipher-databasen —
// helt transparent för användaren (ingen prompt, inget lösenord). Nyckeln lämnar aldrig enheten (fas 1);
// iCloud-synk mellan enheter (fas 2) kräver att nyckeln även synkas via iCloud Keychain.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY_ID = 'blades_db_key_v1';
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let cached: string | null = null;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** Hämtar (eller skapar en gång) den 256-bitars DB-nyckeln ur Keychain. 64 hex-tecken. */
export async function getDbKey(): Promise<string> {
  if (cached) return cached;
  let key = await SecureStore.getItemAsync(KEY_ID, OPTS).catch(() => null);
  if (!key) {
    key = toHex(await Crypto.getRandomBytesAsync(32));
    await SecureStore.setItemAsync(KEY_ID, key, OPTS);
  }
  cached = key;
  return key;
}
