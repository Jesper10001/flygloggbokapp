import { Alert } from 'react-native';
import { create } from 'zustand';
import * as sync from '../services/icloudSync';
import type { BackupManifest } from '../services/backupManifest';

// Delad status för iCloud-synk: driver toggle-raden i Settings och "iCloud Storage"-vyn. All tung
// logik ligger i services/icloudSync.ts — storen håller bara UI-tillstånd och anropar tjänsten.
export type SyncStatus = 'idle' | 'checking' | 'uploading' | 'restoring' | 'synced' | 'error';

interface ICloudStore {
  hasModule: boolean;   // native-modulen finns i bygget (annars: dölj UI)
  available: boolean;   // inloggad i iCloud + container nåbar
  signedIn: boolean;
  enabled: boolean;     // användarens toggle (settings)
  status: SyncStatus;
  lastError: string | null;
  manifest: BackupManifest | null; // senaste kända moln-backup (för vyn)
  busy: boolean;

  refresh: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
  backupNow: () => Promise<void>;
  restoreNow: () => Promise<void>;
  deleteBackup: () => Promise<void>;
}

export const useICloudStore = create<ICloudStore>((set, get) => ({
  hasModule: false,
  available: false,
  signedIn: false,
  enabled: false,
  status: 'idle',
  lastError: null,
  manifest: null,
  busy: false,

  // Läs konto + toggle + fjärr-manifest. Anropas när Settings/iCloud-vyn fokuseras.
  refresh: async () => {
    set({ status: 'checking' });
    const [acct, enabled] = await Promise.all([sync.getAccount(), sync.isEnabled()]);
    let manifest: BackupManifest | null = null;
    if (acct.available) { try { manifest = await sync.readRemoteManifest(); } catch { manifest = null; } }
    set({
      hasModule: acct.hasModule, available: acct.available, signedIn: acct.signedIn,
      enabled, manifest,
      status: manifest ? 'synced' : 'idle',
      lastError: null,
    });
  },

  setEnabled: async (v: boolean) => {
    if (!v) { await sync.setEnabled(false); set({ enabled: false, status: 'idle', lastError: null }); return; }
    // Kan inte slå på utan iCloud → visa fel, lämna toggeln av.
    const acct = await sync.getAccount();
    if (!acct.available) {
      set({
        hasModule: acct.hasModule, available: false, signedIn: acct.signedIn,
        status: 'error',
        lastError: acct.hasModule
          ? (acct.signedIn ? 'iCloud Drive is off for this app. Turn it on in Settings › Apple ID › iCloud.' : 'Sign in to iCloud to use sync.')
          : 'iCloud needs a native build (not available in Expo Go).',
      });
      return;
    }
    await sync.setEnabled(true);
    set({ enabled: true, available: true, hasModule: true, signedIn: true });
    // FAILSAFE: kolla iCloud FÖRST. Finns en tidigare backup → skriv ALDRIG över den tyst; fråga om
    // användaren vill återställa den. (Skyddar särskilt en ny/tom enhet från att radera gamla telefonens backup.)
    const remote = await sync.hasRestorableBackup().catch(() => null);
    if (remote) {
      set({ manifest: remote, status: 'synced' });
      const when = (() => { try { return new Date(remote.createdAt).toLocaleDateString(); } catch { return ''; } })();
      Alert.alert(
        'Restore from iCloud?',
        `Found an existing iCloud backup from ${remote.device}${when ? ` (${when})` : ''}. Restore it to this device, or keep this device's data? Keeping this device's data replaces that backup with this device's logbook.`,
        [
          {
            text: 'Keep this device', style: 'cancel',
            onPress: async () => {
              // Skriv bara över den gamla backupen om DEN HÄR enheten faktiskt har data att säkerhetskopiera.
              if (!(await sync.isLocalEmpty().catch(() => false))) await get().backupNow();
            },
          },
          { text: 'Restore', onPress: async () => { await get().restoreNow(); } },
        ],
        { cancelable: false },
      );
      return;
    }
    // Ingen tidigare backup → första säkerhetskopian.
    await get().backupNow();
  },

  backupNow: async () => {
    if (get().busy) return;
    set({ busy: true, status: 'uploading', lastError: null });
    try {
      const manifest = await sync.backupNow();
      set({ manifest, status: 'synced', busy: false });
    } catch (e: any) {
      set({ status: 'error', lastError: e?.message ?? 'Backup failed.', busy: false });
    }
  },

  restoreNow: async () => {
    if (get().busy) return;
    set({ busy: true, status: 'restoring', lastError: null });
    try {
      const manifest = await sync.restoreNow();
      set({ manifest, status: 'synced', busy: false, enabled: true });
    } catch (e: any) {
      set({ status: 'error', lastError: e?.message ?? 'Restore failed.', busy: false });
    }
  },

  deleteBackup: async () => {
    if (get().busy) return;
    set({ busy: true });
    try { await sync.deleteBackup(); set({ manifest: null, status: 'idle', busy: false }); }
    catch (e: any) { set({ status: 'error', lastError: e?.message ?? 'Could not delete backup.', busy: false }); }
  },
}));
