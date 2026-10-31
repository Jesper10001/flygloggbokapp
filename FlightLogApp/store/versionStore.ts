import { create } from 'zustand';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

// Startsekvensen väntar på versionskollen → aldrig mer än några sekunder per anrop (en hängande
// uppkoppling får inte hålla kvar appen på en tom skärm före onboarding/dashboard).
function fetchWithTimeout(url: string, ms = 4000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { method: 'GET', signal: ctrl.signal }).finally(() => clearTimeout(t));
}

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const VERSION_URL = PROXY_URL ? PROXY_URL.replace(/\/$/, '') + '/version' : '';

// Apples publika lookup: returnerar versionen som ligger live på App Store + direktlänk (trackViewUrl).
// Ingen inloggning/backend krävs — så fort Apple godkänt en release upptäcks den automatiskt.
// Kräver att appen är publicerad; annars är results[] tom och vi litar på proxyn i stället.
const BUNDLE_ID = Application.applicationId ?? 'com.blades.jointlogbook';
const DEFAULT_STORE_URL = 'https://apps.apple.com';

// Testläge för dev-builden: låtsas att nästa version (t.ex. 1.0.1) ligger i App Store, så att man ser hur
// användarna notifieras (popupen och bannern på dashboarden, badgen under About). __DEV__ är alltid false i
// riktiga byggen → syns aldrig i TestFlight eller App Store. Sätt till false när du testat klart.
const DEV_SIMULATE_UPDATE = __DEV__ && true;
const APP_STORE_PAGE = 'https://apps.apple.com/app/id6798360464';
const DEV_EXAMPLE_NOTES = [
  'New: Small fixes now reach you right away, without waiting for an App Store update.',
  'Fixed: Logbook totals in the EASA AMC1 layout now fill every column, also in PDF exports.',
  'Improved: Clearer crash reports help us find and fix problems faster.',
  'Minor visual polish across the app.',
  'Performance and stability improvements.',
].join('\n');

const HIGHLIGHT = /^(new|fixed|fix|improved|improvement)\s*[:–-]\s*/i;
const POPUP_MAX = 3; // popupen visar bara det viktigaste

/** En rad under "What's new" i uppdateringspopupen. */
export interface ReleaseNote {
  kind: 'new' | 'fix' | 'improved' | 'other'; // other = omärkt rad (visas utan etikett)
  text: string;
}

// "What's New in This Version" från App Store Connect (iTunes-lookupens releaseNotes) → popupens urval.
// Bara det väsentligaste visas: finns rader som börjar med "New:", "Fixed:" eller "Improved:" är det de
// (högst 3, i den ordning de står) — övriga rader står kvar i App Store men räknas bara som "and more".
// Saknas sådana rader visas de 3 första. more = det finns fler rader än popupen visar.
export function parseReleaseNotes(raw: unknown): { notes: ReleaseNote[]; more: boolean } {
  const text = Array.isArray(raw) ? raw.join('\n') : typeof raw === 'string' ? raw : '';
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[•●▪◦*–-]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 2);
  const tagged = lines.filter((l) => HIGHLIGHT.test(l));
  const notes = (tagged.length ? tagged : lines).slice(0, POPUP_MAX).map((l): ReleaseNote => {
    const m = l.match(HIGHLIGHT);
    const word = (m?.[1] ?? l.split(/\s/)[0]).toLowerCase();
    const kind: ReleaseNote['kind'] = /^(new|added|introducing)/.test(word) ? 'new' : /^fix/.test(word) ? 'fix'
      : /^(improv|faster|better|smoother)/.test(word) ? 'improved' : 'other';
    const rest = m ? l.slice(m[0].length) : l;
    const body = rest.charAt(0).toUpperCase() + rest.slice(1);
    return { kind, text: body.length > 120 ? `${body.slice(0, 117)}…` : body };
  });
  return { notes, more: lines.length > notes.length };
}

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
  releaseNotes: ReleaseNote[]; // popupens urval ur "What's new" (App Store Connect → proxyn som reserv)
  releaseNotesMore: boolean;   // fler ändringar än urvalet → "And more fixes and improvements."
  news: AppNews | null;
  lastChecked: number;
  check: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set, get) => ({
  updateAvailable: false,
  forceUpdate: false,
  latestVersion: '',
  storeUrl: DEFAULT_STORE_URL,
  releaseNotes: [],
  releaseNotesMore: false,
  news: null,
  lastChecked: 0,

  check: async () => {
    const now = Date.now();
    if (now - get().lastChecked < 60000) return;

    const currentVersion = Application.nativeApplicationVersion ?? '1.0.0';
    let storeVersion = ''; // version som ligger live på App Store (iTunes-lookup)
    let storeUrl = get().storeUrl;
    let storeNotes = ''; // "What's New in This Version" för App Store-versionen

    // 1) App Store-lookup (iOS) — automatiskt, kräver ingen backend-uppdatering vid release.
    if (Platform.OS === 'ios' && BUNDLE_ID) {
      try {
        const resp = await fetchWithTimeout(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(BUNDLE_ID)}`);
        if (resp.ok) {
          const data = await resp.json();
          const app = Array.isArray(data.results) && data.results.length ? data.results[0] : null;
          if (app?.version) storeVersion = String(app.version);
          if (app?.trackViewUrl) storeUrl = String(app.trackViewUrl);
          if (app?.releaseNotes) storeNotes = String(app.releaseNotes);
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
    let proxyNotes: unknown = '';
    if (VERSION_URL) {
      try {
        const resp = await fetchWithTimeout(VERSION_URL);
        if (resp.ok) {
          const data = await resp.json();
          proxyLatest = data.latest_version ?? '';
          proxyMin = data.min_version ?? '0.0.0';
          proxyForce = data.force_update === true;
          news = data.news ?? null;
          proxyNotes = data.release_notes ?? '';
        }
      } catch {
        // offline — behåll tidigare news
      }
    }

    if (DEV_SIMULATE_UPDATE) {
      const [ma = 1, mi = 0, pa = 0] = currentVersion.split('.').map(Number);
      const dev = parseReleaseNotes(DEV_EXAMPLE_NOTES);
      set({ updateAvailable: true, forceUpdate: false, latestVersion: `${ma}.${mi}.${pa + 1}`, storeUrl: APP_STORE_PAGE,
        releaseNotes: dev.notes, releaseNotesMore: dev.more, news, lastChecked: now });
      return;
    }

    // App Store-versionen vinner; annars proxyns latest_version.
    const latestVersion = storeVersion || proxyLatest || currentVersion;
    const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;
    const forceUpdate = proxyForce || compareVersions(currentVersion, proxyMin) < 0;

    const parsed = parseReleaseNotes(storeVersion ? storeNotes : proxyNotes);
    set({ updateAvailable, forceUpdate, latestVersion, storeUrl, releaseNotes: parsed.notes, releaseNotesMore: parsed.more, news, lastChecked: now });
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
