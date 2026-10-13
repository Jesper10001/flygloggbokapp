// Demo-loggbok: kommersiell drönarpilot (EASA). Inspektion (vindkraft, kraftledning, sol, fjärrvärme,
// fasad, bro, mast), kartering (fotogrammetri, LiDAR), foto/video, SAR (ideellt), utbildning, tester och
// fritid. Open A1/A2/A3 → Specific (EVLOS 2024, BVLOS 2025). Riktiga platser med koordinater (drönar-
// globen), lokal starttid, nattid ur solhöjd, observatörer, instruktörstid.
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeRng, isNight, localToUtc, isoDate, dur, DAY, csvLine, pad2 } from './common.mjs';

const OUT_DIR = process.argv[2] ?? './out';
const rng = makeRng(4211);
const rows = [];

// ── Flotta (modell, "registrering" = operatörens flott-ID, i tjänst från–till) ──
const FLEET = {
  'M3E-01': { model: 'DJI Mavic 3 Enterprise', from: '2023-01-10' },
  'M30T-01': { model: 'DJI Matrice 30T', from: '2023-02-01', to: '2025-04-30' },
  'M350-01': { model: 'DJI Matrice 350 RTK', from: '2023-08-15' },
  'MINI4-01': { model: 'DJI Mini 4 Pro', from: '2023-10-01' },
  'M3T-01': { model: 'DJI Mavic 3 Thermal', from: '2024-04-01' },
  'M4T-01': { model: 'DJI Matrice 4T', from: '2025-03-01' },
  'M350-02': { model: 'DJI Matrice 350 RTK', from: '2025-05-15' },
};
const inService = (reg, date) => date >= FLEET[reg].from && (!FLEET[reg].to || date <= FLEET[reg].to);

// ── Platser [namn, lat, lon, land] ──
const S = (name, lat, lon, cc = 'SE') => ({ name, lat, lon, cc });
const URBAN = [S('Stockholm – Södermalm', 59.314, 18.072), S('Solna – Arenastaden', 59.370, 18.002), S('Nacka – Sickla', 59.304, 18.123), S('Lidingö – Torsvik', 59.358, 18.130), S('Sundbyberg – centrum', 59.361, 17.971), S('Täby – Täby Park', 59.437, 18.059), S('Uppsala – Rosendal', 59.840, 17.630), S('Västerås – Kopparlunden', 59.613, 16.528), S('Örebro – Ladugårdsängen', 59.271, 15.250), S('Eskilstuna – Munktell', 59.372, 16.505), S('Gävle – Brynäs', 60.665, 17.155), S('Norrköping – Inre hamnen', 58.595, 16.195), S('Linköping – Vallastaden', 58.395, 15.570), S('Södertälje – hamnen', 59.192, 17.632), S('Nyköping – Brandholmen', 58.740, 17.030), S('Enköping – Västerleden', 59.640, 17.060), S('Göteborg – Lindholmen', 57.707, 11.938), S('Malmö – Västra hamnen', 55.614, 12.977), S('Karlstad – inre hamn', 59.379, 13.497), S('Falun – Lugnet', 60.614, 15.660), S('Sundsvall – Norra kajen', 62.393, 17.320), S('Umeå – Ålidhem', 63.818, 20.300), S('Luleå – Kronan', 65.591, 22.117)];
const BRIDGES = [S('Älvsborgsbron, Göteborg', 57.690, 11.900), S('Högakustenbron, Kramfors', 62.800, 17.940), S('Sundsvallsbron', 62.374, 17.334), S('Tranebergsbron, Stockholm', 59.333, 17.994), S('Ölandsbron, Kalmar', 56.668, 16.420), S('Tjörnbron', 58.001, 11.640), S('Västerbron, Stockholm', 59.324, 18.031)];
const WIND = [S('Wind farm, Markbygden (Piteå)', 65.450, 20.800), S('Wind farm, Hammerdal (Jämtland)', 63.580, 15.350), S('Wind farm, Näsudden (Gotland)', 57.080, 18.210), S('Wind farm, Degerhamn (Öland)', 56.350, 16.410), S('Wind farm, Ånge (Medelpad)', 62.520, 15.660), S('Wind farm, Orsa (Dalarna)', 61.120, 14.620), S('Wind farm, Laholm (Halland)', 56.520, 12.950), S('Wind farm, Lycksele (Västerbotten)', 64.600, 18.670), S('Wind farm, Fosen (Trøndelag, Norway)', 63.900, 10.700, 'NO')];
const POWER = [S('400 kV line, Tierp (Uppland)', 60.340, 17.510), S('130 kV line, Mockfjärd (Dalarna)', 60.500, 14.970), S('Power line, Torsby (Värmland)', 60.130, 13.000), S('Power line, Krokom (Jämtland)', 63.330, 14.460), S('Power line, Ljusdal (Hälsingland)', 61.830, 16.090), S('Power line, Vindeln (Västerbotten)', 64.200, 19.720), S('Power line, Hallstahammar', 59.610, 16.230)];
const SOLAR = [S('Solar park, Strängnäs', 59.370, 17.030), S('Solar park, Sjöbo (Skåne)', 55.630, 13.700), S('Solar park, Nybro (Kalmar)', 56.740, 15.910), S('Solar park, Mjölby', 58.330, 15.130), S('Solar park, Klintehamn (Gotland)', 57.390, 18.200), S('Solar park, Västerås', 59.580, 16.700), S('Solar park, Fyrislund (Uppsala)', 59.850, 17.700), S('Solar park, Salo (Finland)', 60.390, 23.120, 'FI')];
const MAPPING = [S('Quarry, Glasberga (Södertälje)', 59.150, 17.650), S('Quarry, Rosersberg', 59.580, 17.900), S('Quarry, Skidbacken (Gävle)', 60.660, 17.050), S('Construction site, Hagastaden', 59.348, 18.030), S('Construction site, Barkarbystaden', 59.420, 17.860), S('Construction site, Norra Djurgårdsstaden', 59.352, 18.110), S('Logistics park, Eskilstuna', 59.390, 16.580), S('Battery plant site, Skellefteå', 64.735, 20.950), S('Mine site, Garpenberg', 60.310, 16.200), S('Railway corridor, Ostlänken (Nyköping)', 58.800, 16.900), S('Road project, E4 Förbifart Stockholm', 59.360, 17.860), S('Harbour expansion, Norvik (Nynäshamn)', 58.950, 17.920)];
const TELECOM = [S('Telecom mast, Hallstavik', 60.050, 18.600), S('Telecom mast, Norrtälje', 59.760, 18.700), S('Telecom mast, Heby', 59.940, 16.860), S('Telecom mast, Kungsör', 59.420, 16.100), S('Telecom mast, Tierp', 60.350, 17.520), S('Telecom mast, Östhammar', 60.260, 18.370)];
const SAR = [S('Tyresta forest', 59.170, 18.270), S('Kolmården', 58.660, 16.400), S('Bergslagen (Ludvika)', 60.050, 15.100), S('Roslagen (Rimbo)', 59.750, 18.370), S('Tiveden', 58.720, 14.620), S('Öregrund coast', 60.340, 18.430), S('Järvsö (Hälsingland)', 61.710, 16.170)];
const PHOTO = [S('Real estate, Djursholm', 59.398, 18.085), S('Real estate, Saltsjöbaden', 59.278, 18.300), S('Real estate, Vaxholm', 59.402, 18.351), S('Event, Strängnäs marina', 59.374, 17.032), S('Film shoot, Gåsinge (Södermanland)', 59.110, 17.150), S('Hotel marketing, Sigtuna', 59.617, 17.723), S('Golf course, Bro Hof', 59.528, 17.660), S('Vineyard, Österlen', 55.580, 14.250)];
const REC = [S('Sandhamn, Stockholm archipelago', 59.288, 18.915), S('Grinda, Stockholm archipelago', 59.410, 18.560), S('Åreskutan, Åre', 63.433, 13.080), S('Abisko', 68.350, 18.830), S('Kullaberg', 56.300, 12.460), S('Skuleberget, Höga Kusten', 63.100, 18.360), S('Fårö, Gotland', 57.920, 19.130), S('Reine, Lofoten (Norway)', 67.932, 13.089, 'NO'), S('Møns Klint (Denmark)', 54.960, 12.550, 'DK'), S('Nuuksio (Finland)', 60.300, 24.500, 'FI')];
const TRAINING_FIELD = S('Training field, Täby', 59.470, 18.100);
const BASE = S('Company base, Täby', 59.468, 18.098);

const TEAM = ['Johan Lind', 'Sara Nyström', 'Emil Berglund', 'Petra Sjöberg', 'Mikael Åberg', 'Linnea Dahl'];
const TRAINEES = ['Oscar Wik', 'Hanna Strömberg', 'Ali Karimi', 'Elin Fors', 'Mikael Åberg', 'Linnea Dahl'];
const INSTRUCTOR = 'Erik Sandberg';

// ── En flygning ──
function flight(o) {
  const { date, localStart, site, reg, minutes } = o;
  const [y, m, d] = date.split('-').map(Number);
  const utc = localToUtc(site.cc, y, m, d, localStart[0], localStart[1]);
  let nightMin = 0;
  for (let i = 0; i < minutes; i++) if (isNight(utc + (i + 0.5) * 60000, site.lat, site.lon)) nightMin++;
  const landNight = isNight(utc + minutes * 60000, site.lat, site.lon);
  rows.push({
    ms: utc, minutes, nightMin, reg, cat: o.category, mode: o.mode, mission: o.mission, op: o.op,
    cells: [
      date, `${pad2(localStart[0])}:${pad2(localStart[1])}`, FLEET[reg].model, reg, site.name,
      (site.lat + (o.jitter ? rng.float(-0.004, 0.004) : 0)).toFixed(5), (site.lon + (o.jitter ? rng.float(-0.006, 0.006) : 0)).toFixed(5),
      o.mission, o.category, o.mode, o.op, dur(minutes), dur(nightMin), o.alt,
      landNight ? 0 : 1, landNight ? 1 : 0,
      o.observer ?? '', dur(o.dual ? minutes : 0), dur(o.instructor ? minutes : 0), o.remarks ?? '',
    ],
  });
  return utc + minutes * 60000;
}

// Ett uppdrag = flera flygningar i följd (batteribyte mellan). Returnerar antal flygningar.
function job(date, def, overrides = {}) {
  const site = overrides.site ?? rng.pick(def.sites);
  const regs = def.drones.filter((r) => inService(r, date));
  if (!regs.length) return 0;
  const reg = overrides.reg ?? rng.pick(regs);
  const n = overrides.n ?? rng.int(def.flights[0], def.flights[1]);
  let h = overrides.start?.[0] ?? rng.int(def.window[0], def.window[1]);
  let mi = overrides.start?.[1] ?? rng.pick([0, 10, 15, 20, 30, 40, 45, 50]);
  const observer = overrides.observer !== undefined ? overrides.observer : (rng.chance(def.observer) ? rng.pick(TEAM) : '');
  const remarks = overrides.remarks ?? rng.pick(def.remarks);
  const trainee = rng.pick(TRAINEES);
  const instructs = overrides.instructor ?? !!def.instructor;
  for (let i = 0; i < n; i++) {
    const minutes = rng.int(def.dur[0], def.dur[1]);
    const cat = typeof def.category === 'function' ? def.category(date, reg) : def.category;
    const mode = typeof def.mode === 'function' ? def.mode(date) : def.mode;
    flight({
      date, localStart: [h, mi], site, reg, minutes, jitter: def.jitter,
      mission: def.mission, category: overrides.category ?? cat, mode: overrides.mode ?? mode, op: def.op,
      alt: rng.int(def.alt[0], def.alt[1]), observer: mode !== 'VLOS' ? (observer || rng.pick(TEAM)) : observer,
      dual: overrides.dual, instructor: instructs,
      remarks: i === 0 ? (instructs ? `New pilot: ${trainee} – ${remarks}` : remarks) : (overrides.remarksAll ? remarks : ''),
    });
    const next = minutes + rng.int(def.gap[0], def.gap[1]);
    mi += next; h += Math.floor(mi / 60); mi %= 60;
    if (h >= 24) break;
  }
  return n;
}

const SPECIFIC_FROM = '2024-04-01', BVLOS_FROM = '2025-02-01';
const JOBS = {
  turbine: { mission: 'Inspection', sites: WIND, drones: ['M350-01', 'M350-02'], flights: [4, 8], dur: [18, 30], gap: [12, 40], alt: [150, 210], window: [8, 13], months: [4, 10], category: 'Specific', mode: 'VLOS', op: 'COM', observer: 0.3, jitter: true, from: SPECIFIC_FROM,
    remarks: ['Turbine blade inspection – H20T zoom', 'Blade leading-edge erosion survey', 'Tower & nacelle inspection', 'Lightning receptor check after storm'] },
  powerline: { mission: 'Inspection', sites: POWER, drones: ['M350-01', 'M350-02'], flights: [3, 6], dur: [22, 35], gap: [10, 25], alt: [40, 70], window: [8, 13], months: [3, 11], category: 'Specific', mode: (d) => (d >= BVLOS_FROM && rng.chance(0.55) ? 'BVLOS' : 'EVLOS'), op: 'COM', observer: 1, jitter: true, from: SPECIFIC_FROM,
    remarks: ['Power line corridor inspection – 4.2 km', 'Insulator & conductor survey', 'Vegetation clearance survey', 'Corridor inspection under operational authorisation'] },
  solar: { mission: 'Inspection', sites: SOLAR, drones: ['M3T-01', 'M30T-01', 'M4T-01'], flights: [3, 5], dur: [18, 26], gap: [6, 15], alt: [35, 60], window: [10, 13], months: [4, 9], category: 'A2', mode: 'VLOS', op: 'COM', observer: 0, jitter: true,
    remarks: ['Solar park thermal survey – 4.6 MWp', 'Thermal hotspot survey', 'Panel soiling & damage check', 'Annual thermography – IEC 62446-3'] },
  heating: { mission: 'Inspection', sites: URBAN, drones: ['M30T-01', 'M3T-01', 'M4T-01'], flights: [3, 6], dur: [16, 24], gap: [6, 14], alt: [60, 90], window: [18, 21], months: [10, 3], category: 'A2', mode: 'VLOS', op: 'COM', observer: 0.4, jitter: true,
    remarks: ['District heating leak survey – thermal, night', 'District heating network – 6 km surveyed', 'Heat loss survey – residential area'] },
  facade: { mission: 'Inspection', sites: URBAN, drones: ['M3E-01', 'M30T-01', 'M4T-01'], flights: [2, 4], dur: [12, 22], gap: [6, 15], alt: [15, 60], window: [9, 14], months: [1, 12], category: 'A2', mode: 'VLOS', op: 'COM', observer: 0.35, jitter: true,
    remarks: ['Facade inspection – cracks & balconies', 'Roof inspection after storm', 'Roof survey for solar installation', 'Chimney & gutter inspection', 'Facade thermography'] },
  bridge: { mission: 'Inspection', sites: BRIDGES, drones: ['M30T-01', 'M4T-01', 'M350-01'], flights: [3, 5], dur: [14, 25], gap: [8, 20], alt: [10, 60], window: [8, 12], months: [4, 10], category: (d) => (d >= SPECIFIC_FROM ? 'Specific' : 'A2'), mode: 'VLOS', op: 'COM', observer: 0.8,
    remarks: ['Bridge underside inspection – obstacle sensing off', 'Bridge cable & bearing inspection', 'Pylon inspection'] },
  telecom: { mission: 'Inspection', sites: TELECOM, drones: ['M30T-01', 'M4T-01', 'M3E-01'], flights: [2, 3], dur: [12, 18], gap: [8, 15], alt: [60, 110], window: [9, 14], months: [3, 11], category: 'A2', mode: 'VLOS', op: 'COM', observer: 0.1,
    remarks: ['Telecom mast antenna audit', 'Mast inspection – 3D model', 'Antenna alignment check'] },
  photogrammetry: { mission: 'Mapping', sites: MAPPING, drones: ['M3E-01', 'M350-01', 'M350-02'], flights: [3, 6], dur: [22, 35], gap: [6, 15], alt: [80, 120], window: [9, 13], months: [3, 11], category: (d, reg) => (reg.startsWith('M350') ? 'A3' : 'A2'), mode: 'VLOS', op: 'COM', observer: 0.1, jitter: true,
    remarks: ['Photogrammetry 38 ha, GSD 2.1 cm – RTK', 'Stockpile volume survey', 'Monthly construction progress map', 'Orthophoto & DSM for design team', 'Earthworks volume check'] },
  lidar: { mission: 'Mapping', sites: [...MAPPING, ...POWER], drones: ['M350-01', 'M350-02'], flights: [3, 5], dur: [22, 32], gap: [8, 18], alt: [60, 100], window: [9, 13], months: [4, 10], category: (d) => (d >= SPECIFIC_FROM && rng.chance(0.4) ? 'Specific' : 'A3'), mode: (d) => (d >= SPECIFIC_FROM && rng.chance(0.3) ? 'EVLOS' : 'VLOS'), op: 'COM', observer: 0.5, jitter: true,
    remarks: ['LiDAR corridor survey – L2', 'LiDAR terrain model under canopy', 'LiDAR + RGB point cloud'] },
  photo: { mission: 'Photo / Video', sites: PHOTO, drones: ['MINI4-01', 'M3E-01'], flights: [2, 4], dur: [10, 20], gap: [5, 20], alt: [30, 110], window: [10, 17], months: [4, 10], category: (d, reg) => (reg === 'MINI4-01' ? 'A1' : 'A2'), mode: 'VLOS', op: 'COM', observer: 0.2,
    remarks: ['Real estate photos & video', 'Event coverage', 'Commercial film shoot', 'Hotel marketing video', 'Aerial stills for brochure'] },
  sar: { mission: 'SAR', sites: SAR, drones: ['M30T-01', 'M4T-01'], flights: [2, 5], dur: [24, 36], gap: [5, 12], alt: [60, 100], window: [18, 22], months: [1, 12], category: 'A2', mode: 'VLOS', op: 'PRI', observer: 0.6, jitter: true,
    remarks: ['Missing person search – thermal (volunteer)', 'Missing person found – handed over to police', 'Search for missing elderly – thermal sweep', 'Night search in forest – thermal'] },
  training: { mission: 'Training', sites: [TRAINING_FIELD], drones: ['M3E-01', 'M4T-01', 'M350-01'], flights: [4, 6], dur: [12, 20], gap: [6, 12], alt: [20, 60], window: [9, 14], months: [3, 11], category: 'A2', mode: 'VLOS', op: 'COM', observer: 0, instructor: true, from: '2025-03-01',
    remarks: ['A2 practical training', 'Emergency procedures & RTH', 'Manual flight without GNSS (ATTI)', 'Thermal camera workflow', 'Pre-flight & mission planning'] },
  testing: { mission: 'Testing', sites: [BASE], drones: Object.keys(FLEET), flights: [2, 3], dur: [6, 12], gap: [4, 10], alt: [20, 60], window: [9, 15], months: [1, 12], category: (d, reg) => (reg === 'MINI4-01' ? 'A1' : reg.startsWith('M350') ? 'A3' : 'A2'), mode: 'VLOS', op: 'COM', observer: 0,
    remarks: ['Firmware update test', 'Payload calibration flight', 'IMU & compass calibration check', 'Battery health check'] },
  recreation: { mission: 'Recreation', sites: REC, drones: ['MINI4-01'], flights: [1, 3], dur: [12, 24], gap: [10, 40], alt: [40, 120], window: [11, 18], months: [1, 12], category: 'A1', mode: 'VLOS', op: 'PRI', observer: 0,
    remarks: ['Holiday photos', 'Sunset over the archipelago', 'Mountain panorama', 'Landscape photography', ''] },
};
const inMonths = (m, [a, b]) => (a <= b ? m >= a && m <= b : m >= a || m <= b);

// ── Utbildning som elev (dual) + acceptanstester när drönare kommer in i flottan ──
job('2023-01-16', JOBS.facade, { site: TRAINING_FIELD, reg: 'M3E-01', n: 4, start: [10, 0], category: 'A2', dual: true, observer: '', remarks: `A2 practical skills – instructor ${INSTRUCTOR}` });
job('2023-01-18', JOBS.facade, { site: TRAINING_FIELD, reg: 'M3E-01', n: 3, start: [10, 30], category: 'A2', dual: true, observer: '', remarks: `A2 practical skills – check flight (${INSTRUCTOR})` });
job('2024-03-11', JOBS.lidar, { site: TRAINING_FIELD, reg: 'M350-01', n: 4, start: [9, 30], category: 'Specific', mode: 'EVLOS', dual: true, observer: 'Sara Nyström', remarks: `Specific category practical training (EVLOS) – instructor ${INSTRUCTOR}` });
job('2024-03-12', JOBS.lidar, { site: TRAINING_FIELD, reg: 'M350-01', n: 3, start: [9, 0], category: 'Specific', mode: 'EVLOS', dual: true, observer: 'Sara Nyström', remarks: 'Specific category practical skill assessment – PASS' });
for (const [reg, f] of Object.entries(FLEET)) {
  const d0 = new Date(Date.parse(f.from + 'T00:00:00Z') + 2 * DAY).toISOString().slice(0, 10);
  job(d0, JOBS.testing, { reg, n: 2, remarks: `Acceptance test – new ${f.model.replace('DJI ', '')}` });
}

// ── Kalender: uppdragsdagar per vecka (år + säsong) ──
const PER_WEEK = { 2023: 1.2, 2024: 1.7, 2025: 2.0, 2026: 1.9 };
const VACATION = [['2023-07-10', '2023-08-06'], ['2024-07-08', '2024-08-04'], ['2025-07-07', '2025-08-03'], ['2026-07-06', '2026-08-02'], ['2023-12-22', '2024-01-02'], ['2024-12-21', '2025-01-02'], ['2025-12-20', '2026-01-04']];
const onVacation = (d) => VACATION.some(([a, b]) => d >= a && d <= b);
const used = new Set(rows.map((r) => r.cells[0]));
for (let t = Date.UTC(2023, 1, 1); t <= Date.UTC(2026, 8, 25); t += DAY) {
  const date = isoDate(t), dow = new Date(t).getUTCDay(), month = new Date(t).getUTCMonth() + 1, year = new Date(t).getUTCFullYear();
  if (used.has(date)) continue;
  const holiday = onVacation(date);
  // Fritid: helger + semester (Mini 4 Pro)
  if ((dow === 0 || dow === 6 || holiday) && inService('MINI4-01', date) && rng.chance(holiday ? 0.2 : 0.07)) {
    const site = holiday && rng.chance(0.6) ? rng.pick(REC) : rng.pick(REC.slice(0, 2));
    job(date, JOBS.recreation, { site });
    continue;
  }
  if (holiday || dow === 0 || dow === 6) {
    // SAR-larm kan komma även helger/semester
    if (rng.chance(0.012)) job(date, JOBS.sar, { start: [rng.int(18, 22), rng.pick([0, 15, 30, 45])] });
    continue;
  }
  const season = month >= 4 && month <= 9 ? 1.25 : month === 3 || month === 10 ? 1.0 : 0.6;
  if (!rng.chance((PER_WEEK[year] * season) / 5)) { if (rng.chance(0.006)) job(date, JOBS.sar, {}); continue; }
  const cands = Object.entries(JOBS).filter(([k, j]) => !['recreation', 'testing'].includes(k) && inMonths(month, j.months) && (!j.from || date >= j.from) && j.drones.some((r) => inService(r, date)));
  const W = { turbine: 9, powerline: 9, solar: 8, heating: 9, facade: 12, bridge: 4, telecom: 5, photogrammetry: 13, lidar: 5, photo: 9, sar: 1.5, training: 3 };
  const key = rng.weighted(cands.map(([k]) => [k, W[k] ?? 1]));
  job(date, JOBS[key]);
  if (rng.chance(0.03)) job(date, JOBS.testing, { start: [15, 30] }); // firmware-test efter jobbet
}

// ── Sista veckorna, manuellt komponerade (de 16 nyaste raderna = AI:ns mappningsprov) ──
job('2026-10-02', JOBS.training, { reg: 'M4T-01', n: 2, start: [20, 15], dual: true, instructor: false, observer: '', remarks: `Night operations training – instructor ${INSTRUCTOR}`, remarksAll: false });
job('2026-10-06', JOBS.photo, { reg: 'MINI4-01', site: PHOTO[1], n: 1, start: [14, 30], category: 'A1', observer: '', remarks: 'Real estate photos & video' });
job('2026-10-07', JOBS.turbine, { reg: 'M350-01', site: WIND[4], n: 2, start: [9, 10], observer: 'Emil Berglund', remarks: 'Turbine blade inspection – T04–T05, H20T zoom' });
job('2026-10-08', JOBS.training, { reg: 'M4T-01', n: 3, start: [10, 0], remarks: 'A2 practical training' });
job('2026-10-09', JOBS.powerline, { reg: 'M350-02', site: POWER[4], n: 3, start: [9, 30], mode: 'BVLOS', observer: 'Petra Sjöberg', remarks: 'BVLOS corridor inspection – 12 km, operational authorisation' });
job('2026-10-10', JOBS.heating, { reg: 'M3T-01', site: URBAN[7], n: 3, start: [19, 40], observer: 'Linnea Dahl', remarks: 'District heating leak survey – thermal, night' });
job('2026-10-11', JOBS.recreation, { site: REC[1], n: 2, start: [15, 20], remarks: 'Autumn colours in the archipelago' });

// ── Skriv CSV (nyast först) + statistik ──
const HEADER = ['Date', 'Takeoff', 'Drone type', 'Registration', 'Location', 'Latitude', 'Longitude', 'Mission type', 'Category', 'Flight mode', 'Operation type', 'Flight time', 'Night', 'Max altitude (m)', 'Day Ldg', 'Night Ldg', 'Observer', 'Dual', 'Instructor', 'Remarks'];
rows.sort((a, b) => b.ms - a.ms);
mkdirSync(OUT_DIR, { recursive: true });
const file = `${OUT_DIR}/blades-demo-drone-commercial.csv`;
writeFileSync(file, [csvLine(HEADER), ...rows.map((r) => csvLine(r.cells))].join('\n') + '\n');

const h = (f) => Math.round(rows.reduce((s, r) => s + f(r), 0) / 6) / 10;
const count = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
console.log(`flygningar ${rows.length}, totalt ${h((r) => r.minutes)} h, natt ${h((r) => r.nightMin)} h → ${file}`);
console.log('kategori:', count('cat'), '| läge:', count('mode'), '| op:', count('op'));
console.log('uppdrag:', count('mission'));
console.log('drönare (h):', Object.fromEntries(Object.keys(FLEET).map((k) => [k, Math.round(rows.filter((r) => r.reg === k).reduce((s, r) => s + r.minutes, 0) / 60)])));
console.log('unika platser:', new Set(rows.map((r) => r.cells[4])).size);
const perYear = {};
for (const r of rows) { const y = r.cells[0].slice(0, 4); perYear[y] = (perYear[y] ?? 0) + r.minutes / 60; }
console.log('per år (h):', Object.fromEntries(Object.entries(perYear).sort().map(([k, v]) => [k, Math.round(v)])));
