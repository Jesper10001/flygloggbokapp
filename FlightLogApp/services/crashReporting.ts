// Kraschrapporter via Sentry. PÅ bara i release-byggen som har en DSN (EXPO_PUBLIC_SENTRY_DSN i EAS-miljön) —
// annars gör allt här ingenting. Skickar stacktrace + enhetsmodell, iOS- och appversion. Ingen loggboksdata,
// ingen IP/PII (sendDefaultPii av), ingen prestandaspårning, inga skärmdumpar/vyträd; konsol-brödsmulor släpps
// och URL:er rensas från query-strängar (sökord som flygplanstyper följer inte med).
// Lazy require → appen startar även i ett äldre bygge utan Sentrys native-modul.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
let sentry: any = null;

export function initCrashReporting(): void {
  if (!DSN || __DEV__ || sentry) return;
  try {
    sentry = require('@sentry/react-native');
    sentry.init({
      dsn: DSN,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      beforeBreadcrumb(b: any) {
        if (b?.category === 'console') return null;
        if (typeof b?.data?.url === 'string') b.data.url = b.data.url.split('?')[0];
        return b;
      },
    });
  } catch {
    sentry = null;
  }
}

/** Rapportera ett fångat fel (t.ex. från ErrorBoundary). No-op utan Sentry. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try { sentry?.captureException(error, context ? { extra: context } : undefined); } catch { /* får aldrig fälla appen */ }
}
