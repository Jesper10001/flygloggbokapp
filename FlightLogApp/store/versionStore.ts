import { create } from 'zustand';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const VERSION_URL = PROXY_URL ? PROXY_URL.replace(/\/$/, '') + '/version' : '';

// Apples publika lookup: returnerar versionen som ligger live på App Store + direktlänk (trackViewUrl).
// Ingen inloggning/backend krävs — så fort Apple godkänt en release upptäcks den automatiskt.
// Kräver att appen är publicerad; annars är results[] tom och vi litar på proxyn i stället.
const BUNDLE_ID = Application.applicationId ?? 'com.blades.jointlogbook';
const DEFAULT_STORE_URL = 'https://apps.apple.com';

export interface AppNews {
  title: string;
  body: string;
  type: 'info' | 'warning' | 'update';
}

interface VersionState {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersion: string;
  storeUrl: string; // direktlänk till appens App Store-sida (trackViewUrl); fallback = generisk
  news: AppNews | null;
  lastChecked: number;
  check: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set, get) => ({
  updateAvailable: false,
  forceUpdate: false,
  latestVersion: '',
  storeUrl: DEFAULT_STORE_URL,
  news: null,
  lastChecked: 0,

  check: async () => {
    const now = Date.now();
    if (now - get().lastChecked < 60000) return;

    const currentVersion = Application.nativeApplicationVersion ?? '1.0.0';
    let storeVersion = ''; // version som ligger live på App Store (iTunes-lookup)
    let storeUrl = get().storeUrl;

    // 1) App Store-lookup (iOS) — automatiskt, kräver ingen backend-uppdatering vid release.
    if (Platform.OS === 'ios' && BUNDLE_ID) {
      try {
        const resp = await fetch(
          `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(BUNDLE_ID)}`,
          { method: 'GET' },
        );
        if (resp.ok) {
          const data = await resp.json();
          const app = Array.isArray(data.results) && data.results.length ? data.results[0] : null;
          if (app?.version) storeVersion = String(app.version);
          if (app?.trackViewUrl) storeUrl = String(app.trackViewUrl);
        }
      } catch {
        // offline eller appen ej publicerad än — ignorera, faller tillbaka på proxyn nedan
      }
    }

    // 2) Proxy (/version) — news + min_version/force_update, samt fallback för latest_version
    //    om App Store-lookup inte gav något (appen ej publicerad, eller Android).
    let news: AppNews | null = get().news;
    let proxyLatest = '';
    let proxyMin = '0.0.0';
    let proxyForce = false;
    if (VERSION_URL) {
      try {
        const resp = await fetch(VERSION_URL, { method: 'GET' });
        if (resp.ok) {
          const data = await resp.json();
          proxyLatest = data.latest_version ?? '';
          proxyMin = data.min_version ?? '0.0.0';
          proxyForce = data.force_update === true;
          news = data.news ?? null;
        }
      } catch {
        // offline — behåll tidigare news
      }
    }

    // App Store-versionen vinner; annars proxyns latest_version.
    const latestVersion = storeVersion || proxyLatest || currentVersion;
    const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;
    const forceUpdate = proxyForce || compareVersions(currentVersion, proxyMin) < 0;

    set({ updateAvailable, forceUpdate, latestVersion, storeUrl, news, lastChecked: now });
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
