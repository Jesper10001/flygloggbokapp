// Blades introduction — en guidad rundtur i den RIKTIGA appen: sju stopp som spelas upp av sig själva.
// Ett kort längst ner beskriver stoppet, ett ljus (TourSpot) visar vad texten handlar om, och strecket i
// kortet fylls medan kortet visas. Paus stannar allt; pilarna hoppar ett stopp bakåt eller framåt.
// En sekvens för pilot, en för drönare. UI-texter = engelska och korta.
//
// Fält per steg:
//   stop      — vilket av de sju stoppen steget hör till (strecken i kortet). Loggningsexemplet delar
//               stopp med "Log a flight".
//   seconds   — hur länge kortet visas innan rundturen går vidare själv (efter hur mycket det finns att läsa)
//   tab       — flikens route (får ha query: ?view=, ?expand=)
//   page      — sidan steget öppnar ovanpå fliken (bara Log flight); stängs när man lämnar steget
//   spots     — id på det som ska lysas upp (TourSpot). Syns inget av dem visas kortet ändå.
//   menu      — knappen som lyser "trycks" och dess val visas bredvid (skanningsknappen). Ritas av rundturen
//               själv: appens riktiga meny är en ruta som skulle lägga sig ovanpå kortet.
//   logDemo   — Log flight fyller själv i ett kort exempel; kortet ersätts av en smal bildtextrad och
//               rundturen går vidare när exemplet är klart
//   focusToday— loggboken: fäll ut exempelradens månad
//   final     — sista stoppet: "You're ready" med nästa steg. Här stannar uppspelningen.

import { TOUR_EXAMPLE_ID } from './tourDemoData';

export type TourMode = 'pilot' | 'drone';

export interface TourStep {
  key: string;
  stop: number;
  title: string;
  body: string;
  seconds: number;
  tab: string;
  page?: string;
  spots?: string[];
  menu?: boolean;
  logDemo?: boolean;
  focusToday?: boolean;
  final?: boolean;
}

export const TOUR_STOPS = 7;
/** Ungefärlig längd, som frågan efter onboarding lovar ("Take the 90-second tour?"). */
export const TOUR_SECONDS = 90;

export const TOURS: Record<TourMode, TourStep[]> = {
  pilot: [
    { key: 'dashboard', stop: 1, seconds: 8, tab: '/(tabs)', spots: ['dash-stats'],
      title: 'Your flying at a glance',
      body: 'Your total hours, this year so far and your recent workload. Everything here updates the moment you log a flight.' },
    { key: 'logflight', stop: 2, seconds: 6, tab: '/(tabs)', spots: ['fab', 'dash-log'],
      title: 'Two ways to log a flight',
      body: 'Tap the B or Log flight when you land. Quicklog asks only for the route, the times and the aircraft.' },
    { key: 'logscan', stop: 2, seconds: 6, tab: '/(tabs)', spots: ['dash-scan'], menu: true,
      title: 'Or let Blades read it',
      body: 'The scan button fills in the flight from a photo of an ACARS printout or the flight log screen.' },
    { key: 'logdemo', stop: 2, seconds: 24, tab: '/(tabs)', page: '/flight/add', logDemo: true,
      title: 'Logging an example flight', body: '' },
    { key: 'share', stop: 3, seconds: 9, tab: '/(tabs)', spots: ['dash-share'],
      title: 'Share a flight',
      body: 'The share button sends the flight to the pilot you flew with, who logs it in Blades with one tap. Hold it to save the flight as a file. The camera adds your photos to the flight.' },
    { key: 'logbook', stop: 3, seconds: 9, tab: '/(tabs)/log?view=list', focusToday: true, spots: [`logrow-p${TOUR_EXAMPLE_ID}`],
      title: 'It lands in your logbook',
      body: 'Newest first. Tap any flight to see or change it. The example disappears when the tour ends.' },
    { key: 'book', stop: 4, seconds: 11, tab: '/(tabs)/log?view=book', spots: ['book-spread'],
      title: 'A real logbook, kept for you',
      body: 'Book lays your flights out like paper pages, with totals carried forward and a PDF when you need one. Fleet keeps every aircraft you have flown.' },
    { key: 'insights', stop: 5, seconds: 10, tab: '/(tabs)/insights', spots: ['insights-top'],
      title: 'See where your flying is heading',
      body: 'When you reach your next hour mark, how far you are from your next licence, and records like your longest cross-country.' },
    { key: 'hours', stop: 6, seconds: 10, tab: '/(tabs)/settings?expand=import', spots: ['import-rows'],
      title: 'Already have hours? Bring them',
      body: 'Import a file from another logbook app or enter your totals by hand. Your stats update at once.' },
    { key: 'ready', stop: 7, seconds: 0, tab: '/(tabs)', final: true,
      title: "You're ready", body: '' },
  ],
  drone: [
    { key: 'dashboard', stop: 1, seconds: 8, tab: '/(tabs)/drone-dashboard', spots: ['dash-stats'],
      title: 'Your flying at a glance',
      body: 'Your total flight time, this year so far and your recent workload. Everything here updates as you log.' },
    { key: 'logflight', stop: 2, seconds: 6, tab: '/(tabs)/drone-dashboard', spots: ['fab', 'dash-log'],
      title: 'Two ways to log a flight',
      body: 'Tap the B or Log flight after you land. One session can hold several flights, so a day in the field is logged in one go.' },
    { key: 'logscan', stop: 2, seconds: 6, tab: '/(tabs)/drone-dashboard', spots: ['dash-scan'], menu: true,
      title: 'Or scan your flight log',
      body: 'The scan button reads the flight list in your drone app, from a screenshot or a photo, and logs every flight in it.' },
    { key: 'logdemo', stop: 2, seconds: 20, tab: '/(tabs)/drone-dashboard', page: '/drone-flight/add', logDemo: true,
      title: 'Logging an example session', body: '' },
    { key: 'logbook', stop: 3, seconds: 9, tab: '/(tabs)/drone-log?view=flights', focusToday: true, spots: [`logrow-d${TOUR_EXAMPLE_ID}`],
      title: 'It lands in your logbook',
      body: 'Newest first. Tap any session to see or change it. The example disappears when the tour ends.' },
    { key: 'book', stop: 4, seconds: 11, tab: '/(tabs)/drone-log?view=book', spots: ['book-spread'],
      title: 'A real logbook, kept for you',
      body: 'Book lays your flights out like paper pages, with totals carried forward and a PDF when you need one. Fleet keeps every drone you fly.' },
    { key: 'insights', stop: 5, seconds: 10, tab: '/(tabs)/drone-insights', spots: ['insights-top'],
      title: 'See how you fly',
      body: 'Your hours over time, how much is VLOS and BVLOS, and which drones and places you fly the most.' },
    { key: 'hours', stop: 6, seconds: 10, tab: '/(tabs)/drone-settings?expand=import', spots: ['import-rows'],
      title: 'Already have hours? Bring them',
      body: 'Scan a screenshot from your controller, import a file, or enter your totals by hand. Your stats update at once.' },
    { key: 'ready', stop: 7, seconds: 0, tab: '/(tabs)/drone-dashboard', final: true,
      title: "You're ready", body: '' },
  ],
};
