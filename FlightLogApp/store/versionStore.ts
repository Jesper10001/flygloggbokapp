import { create } from 'zustand';
import * as Application from 'expo-application';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const VERSION_URL = PROXY_URL ? PROXY_URL.replace(/\/$/, '') + '/version' : '';

export interface AppNews {
  title: string;
  body: string;
  type: 'info' | 'warning' | 'update';
}

interface VersionState {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersion: string;
  news: AppNews | null;
  lastChecked: number;
  check: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set, get) => ({
  updateAvailable: false,
  forceUpdate: false,
  latestVersion: '',
  news: null,
  lastChecked: 0,

  check: async () => {
    if (!VERSION_URL) return;
    const now = Date.now();
    if (now - get().lastChecked < 60000) return;

    try {
      const resp = await fetch(VERSION_URL, { method: 'GET' });
      if (!resp.ok) return;
      const data = await resp.json();

      const currentVersion = Application.nativeApplicationVersion ?? '1.0.0';
      const minVersion = data.min_version ?? '0.0.0';
      const latestVersion = data.latest_version ?? currentVersion;
      const needsUpdate = compareVersions(currentVersion, latestVersion) < 0;
      const forceUpdate = compareVersions(currentVersion, minVersion) < 0;

      set({
        updateAvailable: needsUpdate,
        forceUpdate: data.force_update === true || forceUpdate,
        latestVersion,
        news: data.news ?? null,
        lastChecked: now,
      });
    } catch {
      // offline — ignore
    }
  },
}));

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
