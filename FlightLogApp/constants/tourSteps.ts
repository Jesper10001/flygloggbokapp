// Blades introduction — en guidad rundtur som navigerar runt i den RIKTIGA appen, "trycker" på
// knappar (TourPress), öppnar sidor och visar funktionerna steg för steg. En rik sekvens för pilot,
// en för drönare. UI-texter = engelska, korta (kortet är avsiktligt lågt).
//
// Fält per steg:
//   tab            — tab-route som ska visas i bakgrunden (får ha query: ?view=, ?expand=)
//   modal          — modal-route som ska öppnas i steget (pushas; stängs när man lämnar steget)
//   press          — id på knappen rundturen "trycker" på innan sidan öppnas (se TourPress)
//   backfill       — steget fäller ut "Backfill missing hours" inuti Imported data-vyn
//   logExpandLatest— steget (loggboken) fäller ut senaste år+månad om det finns flygningar
//   checklist      — sista steget: checklista med nästa steg (ingen vanlig text/kort)

export type TourMode = 'pilot' | 'drone';

export interface TourStep {
  key: string;
  title: string;
  body: string;
  tab?: string;
  modal?: string;
  press?: string;
  backfill?: boolean;
  logExpandLatest?: boolean;
  checklist?: boolean;
}

export const TOURS: Record<TourMode, TourStep[]> = {
  pilot: [
    { key: 'dashboard', tab: '/(tabs)',
      title: 'Your dashboard', body: 'Your flying at a glance — totals, recent flights, currency and milestones.' },
    { key: 'logflight', tab: '/(tabs)', press: 'fab', modal: '/flight/add',
      title: 'Log a flight', body: 'Every flight starts here — a quick entry, or the full form for all the details.' },
    { key: 'logbook', tab: '/(tabs)/log?view=list', logExpandLatest: true,
      title: 'Your logbook', body: 'All your flights, grouped by year and month. Tap one for the full details.' },
    { key: 'createbook', tab: '/(tabs)/log?view=book',
      title: 'Build your logbook', body: 'Lay your flights out like a real logbook — it fills in the totals for you.' },
    { key: 'fleet', tab: '/(tabs)/log?view=fleet',
      title: 'Your fleet', body: 'Every aircraft you fly, with hours per type. Tap one to edit its details.' },
    { key: 'settings', tab: '/(tabs)/settings',
      title: 'Settings', body: 'Profile, airports, data and export — it all lives here.' },
    { key: 'import', tab: '/(tabs)/settings?expand=import', press: 'import-section',
      title: 'Import your flights', body: 'Already have hours? Bring them in — from a CSV, by hand, or review past imports.' },
    { key: 'manual', tab: '/(tabs)/settings?expand=import', press: 'import-manual', modal: '/import/manual',
      title: 'Add flights by hand', body: 'No file? Type your totals in by hand — ideal for a paper logbook.' },
    { key: 'history', tab: '/(tabs)/settings?expand=import', press: 'import-history', modal: '/import/history',
      title: 'Imported data', body: 'Every import in one place — review it, or remove it.' },
    { key: 'backfill', tab: '/(tabs)/settings?expand=import', modal: '/import/history', backfill: true, press: 'backfill',
      title: 'Fill in missing hours', body: 'CSV missing some totals? Add them per field here and they flow into your stats.' },
    { key: 'security', tab: '/(tabs)/settings', modal: '/settings/encryption',
      title: 'Your data is secure', body: 'Your logbook is encrypted on-device (AES-256). Only your device holds the key.' },
    { key: 'checklist', tab: '/(tabs)', checklist: true,
      title: "You're all set", body: 'A few things to get you started:' },
  ],
  drone: [
    { key: 'dashboard', tab: '/(tabs)/drone-dashboard',
      title: 'Your dashboard', body: 'Your drone ops at a glance — flights, hours, fleet and places flown.' },
    { key: 'logflight', tab: '/(tabs)/drone-dashboard', press: 'fab', modal: '/drone-flight/add',
      title: 'Log a flight', body: 'Every drone flight starts here — a quick entry, or the full form.' },
    { key: 'logbook', tab: '/(tabs)/drone-log?view=flights',
      title: 'Your logbook', body: 'All your drone flights, grouped by month. Tap one for the full details.' },
    { key: 'createbook', tab: '/(tabs)/drone-log?view=book',
      title: 'Build your logbook', body: 'Lay your flights out like a real logbook — it fills in the totals for you.' },
    { key: 'fleet', tab: '/(tabs)/drone-log?view=fleet',
      title: 'Your fleet', body: 'Every drone you fly, with hours per model. Tap one to edit its details.' },
    { key: 'settings', tab: '/(tabs)/drone-settings',
      title: 'Settings', body: 'Your drones, operator ID, data and export — it all lives here.' },
    { key: 'import', tab: '/(tabs)/drone-settings?expand=import', press: 'import-section',
      title: 'Import your flights', body: 'Already have hours? Bring them in — from a CSV, by hand, or review past imports.' },
    { key: 'manual', tab: '/(tabs)/drone-settings?expand=import', press: 'import-manual', modal: '/drone-import/manual',
      title: 'Add flights by hand', body: 'No file? Type your drone hours in by hand — ideal for past logs.' },
    { key: 'history', tab: '/(tabs)/drone-settings?expand=import', press: 'import-history', modal: '/drone-import/history',
      title: 'Imported data', body: 'Every import in one place — review it, or remove it.' },
    { key: 'backfill', tab: '/(tabs)/drone-settings?expand=import', modal: '/drone-import/history', backfill: true, press: 'backfill',
      title: 'Fill in missing hours', body: 'CSV missing some totals? Add them per field here and they flow into your stats.' },
    { key: 'security', tab: '/(tabs)/drone-settings', modal: '/settings/encryption',
      title: 'Your data is secure', body: 'Your logbook is encrypted on-device (AES-256). Only your device holds the key.' },
    { key: 'checklist', tab: '/(tabs)/drone-dashboard', checklist: true,
      title: "You're all set", body: 'A few things to get you started:' },
  ],
};
