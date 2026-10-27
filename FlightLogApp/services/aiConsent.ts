// Spärr före varje AI-anrop (App Store 5.1.2(i)): användaren måste uttryckligen tillåta att data skickas till
// Anthropic innan första anropet. anthropicClient anropar ensureAiConsent() först i varje callAnthropic*.
// Dialogen är en inbyggd iOS-alert → syns ovanpå alla modaler (en egen Modal i app-roten gör inte det säkert).
import { Alert, Linking } from 'react-native';
import { useAiConsentStore } from '../store/aiConsentStore';

const PRIVACY_URL = 'https://blades-app.com/privacy.html';

const TITLE = 'Allow AI features?';
const MESSAGE =
  'Blades uses AI from Anthropic (Claude) to scan logbook pages and flight logs, read import files and look up aircraft and drone data.\n\n' +
  'When you use one of these features, the photo, file excerpt or text it needs is sent to Anthropic through the Blades server. ' +
  'Anthropic does not use it to train its models, and the Blades server does not store it.\n\n' +
  'Nothing is sent until you allow it. You can change this anytime in Settings.';

/** Kastas när användaren inte tillåtit AI. Anroparna visar inget fel för den (användaren valde själv). */
export class AiConsentDeclinedError extends Error {
  code = 'AI_CONSENT_DECLINED';
  constructor() {
    super('AI features are turned off. You can turn them on in Settings.');
    this.name = 'AiConsentDeclinedError';
  }
}

export function isAiConsentError(e: unknown): boolean {
  return !!e && (e instanceof AiConsentDeclinedError || (e as any).code === 'AI_CONSENT_DECLINED');
}

// En dialog åt gången: samtidiga anrop (t.ex. flera auto-uppslag) delar samma svar.
let pending: Promise<boolean> | null = null;
// Efter "Not now" frågar vi inte igen på ett par sekunder → en loop som fortsätter efter fel ger inte en
// ny dialog per varv (nästa varv kommer inom millisekunder eftersom spärren ligger före nätverket). Kort
// nog för att ett medvetet omtag från användaren ska få dialogen igen.
let declinedAt = 0;
const DECLINE_QUIET_MS = 2000;

/** Visar samtyckesdialogen och sparar valet. true = tillåtet. Används även av Settings-reglaget. */
export function requestAiConsent(): Promise<boolean> {
  if (pending) return pending;
  pending = new Promise<boolean>((resolve) => {
    const show = () => Alert.alert(TITLE, MESSAGE, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      // Länken lämnar appen → visa dialogen igen så den väntar när man kommer tillbaka.
      { text: 'Privacy Policy', onPress: () => { Linking.openURL(PRIVACY_URL).catch(() => {}).finally(() => setTimeout(show, 300)); } },
      { text: 'Allow', onPress: () => resolve(true) },
    ], { cancelable: false });
    show();
  })
    .then(async (ok) => {
      if (!ok) declinedAt = Date.now();
      await useAiConsentStore.getState().setConsent(ok ? 'granted' : 'declined');
      return ok;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** Har användaren tillåtit AI? (läser sparat val första gången). */
export async function hasAiConsent(): Promise<boolean> {
  return (await useAiConsentStore.getState().load()) === 'granted';
}

/**
 * Släpper igenom anropet om AI är tillåtet. Annars: prompt=true (användaren startade funktionen) → dialogen;
 * prompt=false (bakgrundsjobb som Fleet-berikning) → ingen dialog. Kastar AiConsentDeclinedError om det
 * inte blev tillåtet.
 */
export async function ensureAiConsent({ prompt = true }: { prompt?: boolean } = {}): Promise<void> {
  if (await hasAiConsent()) return;
  if (!prompt || Date.now() - declinedAt < DECLINE_QUIET_MS) throw new AiConsentDeclinedError();
  if (!(await requestAiConsent())) throw new AiConsentDeclinedError();
}

/** Som ensureAiConsent men true/false — för knappar som frågar INNAN kamera/filväljare öppnas (annars tas
 *  bilden eller väljs filen i onödan om användaren sen säger nej). */
export async function askAiConsent(): Promise<boolean> {
  try { await ensureAiConsent(); return true; } catch { return false; }
}
