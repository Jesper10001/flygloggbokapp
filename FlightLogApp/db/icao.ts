import { getDatabase } from './database';
import type { IcaoAirport } from '../types/flight';

// Exakt samma flygplatsdatabas som hemsidans AIRPORT_DB
// Format: [icao, name, country, region, lat, lon]
const SEED_AIRPORTS: [string, string, string, string, number, number][] = [
  // ── Sverige — Södra ──────────────────────────────────────────────────────
  ['ESMS', 'Malmö / Sturup',           'Sweden', 'ES', 55.5363, 13.3762],
  ['ESMO', 'Oskarshamn',               'Sweden', 'ES', 57.3505, 16.4980],
  ['ESMA', 'Emmaboda',                 'Sweden', 'ES', 56.6333, 15.5833],
  ['ESTA', 'Ängelholm / Helsingborg',  'Sweden', 'ES', 56.2962, 12.8471],
  ['ESDF', 'Ronneby / Blekinge',       'Sweden', 'ES', 56.2667, 15.2650],
  ['ESMT', 'Halmstad',                 'Sweden', 'ES', 56.6911, 12.8202],
  ['ESMQ', 'Kalmar',                   'Sweden', 'ES', 56.6855, 16.2876],
  ['ESMX', 'Växjö / Kronoberg',        'Sweden', 'ES', 56.9291, 14.7280],
  ['ESIB', 'Såtenäs',                  'Sweden', 'ES', 58.4264, 12.7017],
  ['ESSF', 'Hultsfred',                'Sweden', 'ES', 57.5254, 15.8233],
  ['ESSV', 'Visby',                    'Sweden', 'ES', 57.6628, 18.3462],
  ['ESMK', 'Kristianstad',             'Sweden', 'ES', 56.0133, 14.0856],
  ['ESMI', 'Sjöbo / Sövde',            'Sweden', 'ES', 55.6917, 13.7433],
  // ── Sverige — Västra ─────────────────────────────────────────────────────
  ['ESGG', 'Göteborg Landvetter',      'Sweden', 'ES', 57.6628, 12.2798],
  ['ESGP', 'Göteborg Säve',            'Sweden', 'ES', 57.7745, 11.8703],
  ['ESGT', 'Trollhättan / Vänersborg', 'Sweden', 'ES', 58.3181, 12.3447],
  ['ESGE', 'Borås / Viared',           'Sweden', 'ES', 57.7503, 12.9295],
  ['ESGL', 'Lidköping / Hovby',        'Sweden', 'ES', 58.4655, 13.1744],
  ['ESGJ', 'Jönköping',                'Sweden', 'ES', 57.7576, 14.0687],
  ['ESGR', 'Skövde',                   'Sweden', 'ES', 58.4572, 13.9727],
  ['ESGU', 'Uddevalla',                'Sweden', 'ES', 58.3520, 11.9369],
  ['ESGV', 'Varberg',                  'Sweden', 'ES', 57.1064, 12.3014],
  ['ESGA', 'Backamo',                  'Sweden', 'ES', 58.1833, 11.9500],
  ['ESGO', 'Vårgårda',                 'Sweden', 'ES', 58.0300, 12.8200],
  // ── Sverige — Mitt ───────────────────────────────────────────────────────
  ['ESSA', 'Stockholm Arlanda',        'Sweden', 'ES', 59.6519, 17.9186],
  ['ESSB', 'Stockholm Bromma',         'Sweden', 'ES', 59.3544, 17.9416],
  ['ESKN', 'Nyköping / Skavsta',       'Sweden', 'ES', 58.7886, 16.9122],
  ['ESOW', 'Västerås',                 'Sweden', 'ES', 59.5894, 16.6337],
  ['ESOE', 'Örebro',                   'Sweden', 'ES', 59.2237, 15.0380],
  ['ESOK', 'Karlstad',                 'Sweden', 'ES', 59.4447, 13.3374],
  ['ESSP', 'Norrköping',               'Sweden', 'ES', 58.5863, 16.2508],
  ['ESSL', 'Linköping / SAAB',         'Sweden', 'ES', 58.4026, 15.6805],
  ['ESCF', 'Linköping / Malmen',       'Sweden', 'ES', 58.4022, 15.5253],
  ['ESSD', 'Borlänge / Dala',          'Sweden', 'ES', 60.4227, 15.5151],
  ['ESSE', 'Eskilstuna',               'Sweden', 'ES', 59.3511, 16.7084],
  ['ESSH', 'Laxå',                     'Sweden', 'ES', 59.0578, 14.5919],
  ['ESVS', 'Mora / Siljan',            'Sweden', 'ES', 60.9574, 14.5114],
  ['ESUD', 'Hudiksvall',               'Sweden', 'ES', 61.7681, 17.0996],
  ['ESST', 'Torsby',                   'Sweden', 'ES', 60.1576, 12.9912],
  ['ESNH', 'Hagfors',                  'Sweden', 'ES', 60.0200, 13.5790],
  ['ESVQ', 'Köping',                   'Sweden', 'ES', 59.5167, 16.0500],
  ['ESDA', 'Ljungbyhed',               'Sweden', 'ES', 56.1286, 13.2122],
  ['ESSK', 'Gävle / Sandviken',        'Sweden', 'ES', 60.5933, 16.9514],
  ['ESSC', 'Eskilstuna / Ekeby',       'Sweden', 'ES', 59.4367, 16.7242],
  ['ESQO', 'Arboga',                   'Sweden', 'ES', 59.3978, 15.9245],
  ['ESKV', 'Arvika',                   'Sweden', 'ES', 59.6742, 12.5981],
  ['ESUB', 'Uppsala / Ärna',           'Sweden', 'ES', 59.8981, 17.5886],
  ['ESCM', 'Ärna Air Base (F16)',       'Sweden', 'ES', 59.8973, 17.5886],
  // ── Sverige — Norra ──────────────────────────────────────────────────────
  ['ESPA', 'Luleå / Kallax',           'Sweden', 'ES', 65.5438, 22.1220],
  ['ESNU', 'Umeå',                     'Sweden', 'ES', 63.7918, 20.2828],
  ['ESNS', 'Skellefteå',               'Sweden', 'ES', 64.6248, 21.0769],
  ['ESNZ', 'Åre / Östersund',          'Sweden', 'ES', 63.1944, 14.5003],
  ['ESNQ', 'Kiruna',                   'Sweden', 'ES', 67.8220, 20.3368],
  ['ESNL', 'Lycksele',                 'Sweden', 'ES', 64.5483, 18.7162],
  ['ESNO', 'Örnsköldsvik',             'Sweden', 'ES', 63.4083, 18.9900],
  ['ESNX', 'Arvidsjaur',               'Sweden', 'ES', 65.5903, 19.2819],
  ['ESPC', 'Pajala',                   'Sweden', 'ES', 67.2456, 23.0689],
  ['ESUE', 'Hemavan / Tärnaby',        'Sweden', 'ES', 65.8060, 15.0828],
  ['ESNC', 'Härnösand',                'Sweden', 'ES', 62.6483, 17.9683],
  ['ESND', 'Härjedalen / Sveg',        'Sweden', 'ES', 62.0477, 14.4233],
  ['ESPE', 'Vidsel',                   'Sweden', 'ES', 65.8753, 20.1500],
  ['ESUF', 'Fallfors',                 'Sweden', 'ES', 64.3600, 20.3667],
  ['ESNV', 'Vilhelmina',               'Sweden', 'ES', 64.5792, 16.8336],
  ['ESNG', 'Gällivare',                'Sweden', 'ES', 67.1324, 20.8146],
  ['ESNN', 'Sundsvall-Härnösand',      'Sweden', 'ES', 62.5281, 17.4436],
  ['ESNK', 'Kramfors / Höga Kusten',   'Sweden', 'ES', 62.9208, 17.7686],
  // ── Norge ────────────────────────────────────────────────────────────────
  ['ENGM', 'Oslo Gardermoen',          'Norway', 'EN', 60.1939, 11.1004],
  ['ENRY', 'Oslo / Rygge',             'Norway', 'EN', 59.3789, 10.7856],
  ['ENTO', 'Sandefjord / Torp',        'Norway', 'EN', 59.1867, 10.2586],
  ['ENSN', 'Skien / Geiteryggen',      'Norway', 'EN', 59.1850,  9.5669],
  ['ENBR', 'Bergen Flesland',          'Norway', 'EN', 60.2934,  5.2181],
  ['ENHD', 'Haugesund / Karmøy',       'Norway', 'EN', 59.3453,  5.2086],
  ['ENSO', 'Stord / Sørstokken',       'Norway', 'EN', 59.7919,  5.3408],
  ['ENCN', 'Kristiansand / Kjevik',    'Norway', 'EN', 58.2042,  8.0853],
  ['ENFL', 'Florø',                    'Norway', 'EN', 61.5836,  5.0247],
  ['ENSG', 'Sogndal / Haukåsen',       'Norway', 'EN', 61.1560,  7.1378],
  ['ENVA', 'Trondheim / Værnes',       'Norway', 'EN', 63.4578, 10.9258],
  ['ENOL', 'Ørland',                   'Norway', 'EN', 63.6989,  9.6042],
  ['ENKB', 'Kristiansund / Kvernberget','Norway','EN', 63.1119,  7.8247],
  ['ENRA', 'Mo i Rana / Røssvoll',     'Norway', 'EN', 66.3639, 14.3015],
  ['ENMS', 'Mosjøen / Kjærstad',       'Norway', 'EN', 65.7840, 13.2150],
  ['ENST', 'Sandnessjøen / Stokka',    'Norway', 'EN', 65.9568, 12.4689],
  ['ENRO', 'Røros',                    'Norway', 'EN', 62.5782, 11.3424],
  ['ENBO', 'Bodø',                     'Norway', 'EN', 67.2692, 14.3653],
  ['ENVR', 'Svolvær / Helle',          'Norway', 'EN', 68.2433, 14.6692],
  ['ENAS', 'Andøya',                   'Norway', 'EN', 69.2925, 16.1442],
  ['ENEV', 'Harstad / Narvik',         'Norway', 'EN', 68.4913, 16.6781],
  ['ENTC', 'Tromsø / Langnes',         'Norway', 'EN', 69.6833, 18.9189],
  ['ENKR', 'Kirkenes / Høybuktmoen',   'Norway', 'EN', 69.7258, 29.8913],
  ['ENVD', 'Vadsø',                    'Norway', 'EN', 70.0653, 29.8440],
  ['ENSS', 'Vardø / Svartnes',         'Norway', 'EN', 70.3553, 31.0447],
  // ── Danmark ──────────────────────────────────────────────────────────────
  ['EKCH', 'København / Kastrup',      'Denmark', 'EK', 55.6180, 12.6560],
  ['EKRK', 'Roskilde',                 'Denmark', 'EK', 55.5856, 12.1314],
  ['EKYT', 'Aalborg',                  'Denmark', 'EK', 57.0928,  9.8492],
  ['EKBI', 'Billund',                  'Denmark', 'EK', 55.7403,  9.1519],
  ['EKAH', 'Aarhus / Tirstrup',        'Denmark', 'EK', 56.2999, 10.6190],
  ['EKSB', 'Sønderborg',               'Denmark', 'EK', 54.9644,  9.7922],
  ['EKEB', 'Esbjerg',                  'Denmark', 'EK', 55.5258,  8.5533],
  ['EKVG', 'Vágar (Färöarna)',         'Faroe Islands', 'EK', 62.0636, -7.2772],
  ['EKOD', 'Odense / Beldringe',       'Denmark', 'EK', 55.4767, 10.3311],
  ['EKRN', 'Bornholm',                 'Denmark', 'EK', 55.0633, 14.7595],
  // ── Finland ──────────────────────────────────────────────────────────────
  ['EFHK', 'Helsinki / Vantaa',        'Finland', 'EF', 60.3172, 24.9633],
  ['EFTU', 'Turku',                    'Finland', 'EF', 60.5141, 22.2628],
  ['EFOU', 'Oulu',                     'Finland', 'EF', 64.9301, 25.3546],
  ['EFRO', 'Rovaniemi',                'Finland', 'EF', 66.5648, 25.8304],
  ['EFTP', 'Tampere / Pirkkala',       'Finland', 'EF', 61.4142, 23.6044],
  ['EFVA', 'Vaasa',                    'Finland', 'EF', 63.0507, 21.7622],
  ['EFJO', 'Joensuu',                  'Finland', 'EF', 62.6629, 29.6076],
  ['EFKU', 'Kuopio',                   'Finland', 'EF', 63.0071, 27.7978],
  ['EFIV', 'Ivalo',                    'Finland', 'EF', 68.6073, 27.4053],
  ['EFKT', 'Kittilä',                  'Finland', 'EF', 67.7010, 24.8468],
  // ── Baltikum ─────────────────────────────────────────────────────────────
  ['EVRA', 'Riga',                     'Latvia',    'EV', 56.9236, 23.9711],
  ['EYVI', 'Vilnius',                  'Lithuania', 'EY', 54.6341, 25.2858],
  ['EETN', 'Tallinn',                  'Estonia',   'EE', 59.4133, 24.8328],
  // ── Tyskland — Civilt ────────────────────────────────────────────────────
  ['EDDB', 'Berlin Brandenburg',       'Germany', 'ED', 52.3667, 13.5033],
  ['EDDE', 'Erfurt / Weimar',          'Germany', 'ED', 50.9798, 10.9581],
  ['EDDF', 'Frankfurt / Main',         'Germany', 'ED', 50.0379,  8.5622],
  ['EDDG', 'Münster / Osnabrück',      'Germany', 'ED', 52.1347,  7.6848],
  ['EDDH', 'Hamburg',                  'Germany', 'ED', 53.6304,  9.9882],
  ['EDDK', 'Köln / Bonn',              'Germany', 'ED', 50.8659,  7.1427],
  ['EDDL', 'Düsseldorf',               'Germany', 'ED', 51.2895,  6.7668],
  ['EDDM', 'München',                  'Germany', 'ED', 48.3537, 11.7750],
  ['EDDN', 'Nürnberg',                 'Germany', 'ED', 49.4987, 11.0669],
  ['EDDP', 'Leipzig / Halle',          'Germany', 'ED', 51.4324, 12.2416],
  ['EDDR', 'Saarbrücken',              'Germany', 'ED', 49.2146,  7.1095],
  ['EDDS', 'Stuttgart',                'Germany', 'ED', 48.6899,  9.2220],
  ['EDDV', 'Hannover',                 'Germany', 'ED', 52.4611,  9.6850],
  ['EDDW', 'Bremen',                   'Germany', 'ED', 53.0475,  8.7867],
  ['EDDX', 'Heringsdorf / Usedom',     'Germany', 'ED', 53.8788, 14.1525],
  ['EDDC', 'Dresden',                  'Germany', 'ED', 51.1328, 13.7672],
  ['EDLV', 'Weeze / Niederrhein',      'Germany', 'ED', 51.6022,  6.1422],
  ['EDLP', 'Paderborn / Lippstadt',    'Germany', 'ED', 51.6142,  8.6162],
  ['EDLN', 'Mönchengladbach',          'Germany', 'ED', 51.2303,  6.5046],
  ['EDMA', 'Augsburg',                 'Germany', 'ED', 48.4252, 10.9317],
  ['EDMO', 'Oberpfaffenhofen',         'Germany', 'ED', 48.0814, 11.2831],
  ['EDNX', 'Ainring',                  'Germany', 'ED', 47.8064, 12.9947],
  ['EDQD', 'Bayreuth',                 'Germany', 'ED', 49.9855, 11.6400],
  ['EDQM', 'Hof / Plauen',             'Germany', 'ED', 50.2888, 11.8564],
  ['EDRY', 'Speyer',                   'Germany', 'ED', 49.3045,  8.4517],
  ['EDRZ', 'Zweibrücken',              'Germany', 'ED', 49.2094,  7.4003],
  ['EDTL', 'Lahr',                     'Germany', 'ED', 48.3693,  7.8278],
  ['EDTD', 'Donaueschingen',           'Germany', 'ED', 47.9733,  8.5222],
  ['EDHI', 'Hamburg / Finkenwerder',   'Germany', 'ED', 53.5353,  9.8353],
  ['EDHK', 'Kiel / Holtenau',          'Germany', 'ED', 54.3794, 10.1453],
  // ── Tyskland — Militärt ──────────────────────────────────────────────────
  ['ETHA', 'Altenstadt (Heer)',        'Germany', 'ET', 47.8289, 10.8722],
  ['ETHB', 'Bückeburg (Heer)',         'Germany', 'ET', 52.2783,  9.0822],
  ['ETHE', 'Celle / Arloh (Heer)',     'Germany', 'ET', 52.5922, 10.0214],
  ['ETHF', 'Fritzlar (Heer)',          'Germany', 'ET', 51.1142,  9.2869],
  ['ETHH', 'Holzdorf (Heer)',          'Germany', 'ET', 51.7678, 13.1677],
  ['ETHI', 'Itzehoe / Hungriger Wolf', 'Germany', 'ET', 53.9319,  9.5394],
  ['ETHL', 'Laupheim (Heer)',          'Germany', 'ET', 48.2233,  9.9103],
  ['ETHN', 'Niederstetten (Heer)',     'Germany', 'ET', 49.3911,  9.9578],
  ['ETHR', 'Roth (Heer)',              'Germany', 'ET', 49.2178, 11.1003],
  ['ETHS', 'Fassberg',                 'Germany', 'ET', 52.9219, 10.1867],
  ['ETAD', 'Diepholz (Lw)',            'Germany', 'ET', 52.5775,  8.3428],
  ['ETAI', 'Ingolstadt / Manching',    'Germany', 'ET', 48.7156, 11.5342],
  ['ETAR', 'Ramstein AB (USAF)',       'Germany', 'ET', 49.4369,  7.6003],
  ['ETAS', 'Schwäbisch Hall (Lw)',     'Germany', 'ET', 49.1133,  9.7839],
  ['ETAT', 'Trier / Föhren',           'Germany', 'ET', 49.8653,  6.7878],
  ['ETAU', 'Aalen / Heidenheim',       'Germany', 'ET', 48.7778, 10.2647],
  ['ETGY', 'Geilenkirchen (NATO)',     'Germany', 'ET', 50.9608,  6.0422],
  ['ETNL', 'Rostock / Laage (Lw)',     'Germany', 'ET', 53.9183, 12.2783],
  ['ETNS', 'Schleswig / Jagel',        'Germany', 'ET', 54.4592,  9.5167],
  ['ETNU', 'Nordholz (Mar)',           'Germany', 'ET', 53.7678,  8.6583],
  ['ETOR', 'Rhein-Main AB',            'Germany', 'ET', 50.0432,  8.5847],
  ['ETSN', 'Neuburg a.d. Donau',       'Germany', 'ET', 48.7100, 11.2119],
  // ── Österrike ────────────────────────────────────────────────────────────
  ['LOWW', 'Wien / Schwechat',         'Austria',        'LO', 48.1103, 16.5697],
  ['LOWI', 'Innsbruck',                'Austria',        'LO', 47.2602, 11.3439],
  ['LOWL', 'Linz / Hörsching',         'Austria',        'LO', 48.2333, 14.1875],
  ['LOWG', 'Graz',                     'Austria',        'LO', 46.9911, 15.4397],
  ['LOWS', 'Salzburg',                 'Austria',        'LO', 47.7933, 13.0043],
  ['LKPR', 'Prag',                     'Czech Republic', 'LK', 50.1008, 14.2600],
  // ── Schweiz ──────────────────────────────────────────────────────────────
  ['LSZH', 'Zürich',                   'Switzerland', 'LS', 47.4647,  8.5492],
  ['LSGG', 'Genève',                   'Switzerland', 'LS', 46.2381,  6.1089],
  ['LFSB', 'Basel / Mulhouse',         'France',      'LF', 47.5896,  7.5299],
  ['LSMM', 'Bern / Belp',              'Switzerland', 'LS', 46.9141,  7.4972],
  // ── Övriga Europa ────────────────────────────────────────────────────────
  ['EHAM', 'Amsterdam Schiphol',       'Netherlands', 'EH', 52.3086,  4.7639],
  ['EBBR', 'Bryssel',                  'Belgium',     'EB', 50.9014,  4.4844],
  ['EGLL', 'London Heathrow',          'United Kingdom','EG', 51.4775, -0.4614],
  ['EGKK', 'London Gatwick',           'United Kingdom','EG', 51.1481, -0.1903],
  ['LFPG', 'Paris CDG',                'France',      'LF', 49.0097,  2.5478],
  ['LFPO', 'Paris Orly',               'France',      'LF', 48.7233,  2.3794],
  ['EPWA', 'Warszawa / Chopin',        'Poland',      'EP', 52.1657, 20.9671],
  ['EPKK', 'Kraków',                   'Poland',      'EP', 50.0778, 19.7847],
];

export async function seedIcaoAirports(): Promise<void> {
  const db = await getDatabase();

  // Alltid INSERT OR IGNORE — idempotent, lägger till nya utan att röra befintliga
  await db.withTransactionAsync(async () => {
    for (const [icao, name, country, region, lat, lon] of SEED_AIRPORTS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO icao_airports (icao, name, country, region, lat, lon, custom)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [icao, name, country, region, lat, lon]
      );
    }
  });
}

export async function searchAirports(query: string): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const q = `%${query.toUpperCase()}%`;
  return await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE icao LIKE ? OR UPPER(name) LIKE ?
     ORDER BY
       CASE WHEN icao = ? THEN 0
            WHEN icao LIKE ? THEN 1
            ELSE 2 END,
       custom DESC,
       name ASC
     LIMIT 20`,
    [q, `%${query}%`, query.toUpperCase(), `${query.toUpperCase()}%`]
  );
}

export async function getAirportByIcao(icao: string): Promise<IcaoAirport | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE icao=?',
    [icao.toUpperCase()]
  );
}

export async function getAirportCoordinates(
  icaoCodes: string[]
): Promise<{ icao: string; name: string; lat: number; lon: number }[]> {
  if (!icaoCodes.length) return [];
  const db = await getDatabase();
  const placeholders = icaoCodes.map(() => '?').join(',');
  return await db.getAllAsync<{ icao: string; name: string; lat: number; lon: number }>(
    `SELECT icao, name, lat, lon FROM icao_airports WHERE icao IN (${placeholders}) AND lat IS NOT NULL`,
    icaoCodes
  );
}

export async function addCustomAirport(airport: Omit<IcaoAirport, 'custom'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [airport.icao.toUpperCase(), airport.name, airport.country, airport.region, airport.lat, airport.lon]
  );
}

export async function deleteCustomAirport(icao: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM icao_airports WHERE icao=? AND custom=1',
    [icao.toUpperCase()]
  );
}

export async function addTemporaryPlace(icao: string, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO icao_airports (icao, name, country, region, lat, lon, custom, temporary)
     VALUES (?, ?, '', '', 0, 0, 0, 1)`,
    [icao.toUpperCase(), name || icao.toUpperCase()]
  );
}

// Beräkna avstånd i km med Haversine-formeln
export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
