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
  globalmap?: boolean; // specialsteg: globmeny → öppna global map → sök/zooma KJFK → tillbaka
}

export const TOURS: Record<TourMode, TourStep[]> = {
  pilot: [
    { key: 'dashboard', tab: '/(tabs)',
      title: 'Your dashboard', body: 'Your home base — total hours, recent flights, currency status and milestones at a glance. Pull down to refresh your stats and weather.' },
    { key: 'logflight', tab: '/(tabs)', press: 'fab', modal: '/flight/add',
      title: 'Log a flight', body: 'The glowing B in the center logs a flight. Pick a quick entry for the essentials, or the full form for times, crew, approaches and the rest.' },
    { key: 'logbook', tab: '/(tabs)/log?view=list', logExpandLatest: true,
      title: 'Your logbook', body: 'Every flight you record, grouped by year and month — tap one for the full details. Use the toggle up top to switch between List, Book and Fleet.' },
    { key: 'createbook', tab: '/(tabs)/log?view=book',
      title: 'Build your logbook', body: 'Blades lays your flights out like a real paper logbook — page spreads with totals carried forward. Create one and it fills itself as you fly.' },
    { key: 'fleet', tab: '/(tabs)/log?view=fleet',
      title: 'Your fleet', body: 'Every aircraft you have flown, grouped by type with hours and details. Tap one to edit its registration, add specs or merge duplicates.' },
    { key: 'settings', tab: '/(tabs)/settings',
      title: 'Settings', body: 'Your profile, airports, aircraft, data and export all live here. This is also where you switch between your Pilot and Drone logbooks.' },
    { key: 'import', tab: '/(tabs)/settings?expand=import', press: 'import-section',
      title: 'Import your flights', body: 'Already have hours from another logbook? Bring them in — from a CSV file, by typing totals by hand, or review what you have imported.' },
    { key: 'manual', tab: '/(tabs)/settings?expand=import', press: 'import-manual', modal: '/import/manual',
      title: 'Add flights by hand', body: 'No file to import? Enter your totals by hand — ideal for carrying hours over from a paper logbook without logging each flight.' },
    { key: 'history', tab: '/(tabs)/settings?expand=import', press: 'import-history', modal: '/import/history',
      title: 'Imported data', body: 'Every batch you have imported, kept separate. Review what came in, and delete a whole import in one tap if something went wrong.' },
    { key: 'backfill', tab: '/(tabs)/settings?expand=import', modal: '/import/history', backfill: true, press: 'backfill',
      title: 'Fill in missing hours', body: 'Imported a CSV but a few totals look low? Add the missing hours per field here — they flow into your stats and currency without creating fake flights.' },
    { key: 'security', tab: '/(tabs)/settings?expand=app', press: 'app-security', modal: '/settings/encryption',
      title: 'Your data is secure', body: 'Your whole logbook is encrypted on your device with AES-256. The key never leaves your phone — not even Blades can read your data.' },
    { key: 'globalmap', tab: '/(tabs)', globalmap: true,
      title: 'The global map', body: "Every airport and airfield on Earth, on one map. Open it from the globe on your dashboard, then search any ICAO — like KJFK — to fly straight there." },
    { key: 'checklist', tab: '/(tabs)', checklist: true,
      title: "You're all set", body: 'A few things to get you started:' },
  ],
  drone: [
    { key: 'dashboard', tab: '/(tabs)/drone-dashboard',
      title: 'Your dashboard', body: 'Your home base — total flights and hours, your fleet and the places you have flown at a glance. Pull down to refresh.' },
    { key: 'logflight', tab: '/(tabs)/drone-dashboard', press: 'fab', modal: '/drone-flight/add',
      title: 'Log a flight', body: 'The glowing B in the center logs a drone flight. Pick a quick entry for the essentials, or the full form for every detail.' },
    { key: 'logbook', tab: '/(tabs)/drone-log?view=flights',
      title: 'Your logbook', body: 'Every drone flight you record, grouped by month — tap one for the full details. Switch between List, Book and Fleet with the toggle up top.' },
    { key: 'createbook', tab: '/(tabs)/drone-log?view=book',
      title: 'Build your logbook', body: 'Blades lays your flights out like a real paper logbook, totals carried forward. Create one and it fills itself as you fly.' },
    { key: 'fleet', tab: '/(tabs)/drone-log?view=fleet',
      title: 'Your fleet', body: 'Every drone you fly, grouped by model with hours and details. Tap one to edit its registration or add specs.' },
    { key: 'settings', tab: '/(tabs)/drone-settings',
      title: 'Settings', body: 'Your drones, operator ID, data and export all live here. This is also where you switch between your Drone and Pilot logbooks.' },
    { key: 'import', tab: '/(tabs)/drone-settings?expand=import', press: 'import-section',
      title: 'Import your flights', body: 'Already have drone hours elsewhere? Bring them in — from a CSV file, by typing totals by hand, or review what you have imported.' },
    { key: 'manual', tab: '/(tabs)/drone-settings?expand=import', press: 'import-manual', modal: '/drone-import/manual',
      title: 'Add flights by hand', body: 'No file to import? Enter your drone totals by hand — ideal for carrying over past hours without logging each flight.' },
    { key: 'history', tab: '/(tabs)/drone-settings?expand=import', press: 'import-history', modal: '/drone-import/history',
      title: 'Imported data', body: 'Every batch you have imported, kept separate. Review what came in, and delete a whole import in one tap if something went wrong.' },
    { key: 'backfill', tab: '/(tabs)/drone-settings?expand=import', modal: '/drone-import/history', backfill: true, press: 'backfill',
      title: 'Fill in missing hours', body: 'Imported a CSV but a few totals look low? Add the missing hours per field here — they flow into your stats without creating fake flights.' },
    { key: 'security', tab: '/(tabs)/drone-settings?expand=app', press: 'app-security', modal: '/settings/encryption',
      title: 'Your data is secure', body: 'Your whole logbook is encrypted on your device with AES-256. The key never leaves your phone — not even Blades can read your data.' },
    { key: 'globalmap', tab: '/(tabs)/drone-dashboard', globalmap: true,
      title: 'The global map', body: "Every airport and airfield on Earth, on one map. Open it from the globe on your dashboard, then search any ICAO — like KJFK — to fly straight there." },
    { key: 'checklist', tab: '/(tabs)/drone-dashboard', checklist: true,
      title: "You're all set", body: 'A few things to get you started:' },
  ],
};
