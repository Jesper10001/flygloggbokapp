// Demo-loggbok: fixed wing-pilot (EASA). PPL 2018 → timbygge + Europaturer → natt → IR/ME + CPL 2021 →
// MCC/JOC → klubbflyg → ATR 72-600 TR 2024 → styrman (FO) baserad på Bromma. Siktar mot "ATPL 4/6" i
// Insights (Total + PIC kvar). Nattid beräknas ur solhöjd längs rutten; alla ICAO-koder finns i appens DB.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ap, makeRng, distNm, nightMinutes, isNight, localToUtc, isoDate, hhmm, dur, DAY, daylight, csvLine } from './common.mjs';

const OUT_DIR = process.argv[2] ?? './out';
const rng = makeRng(20261013);
const rows = []; // { ms, cells } — sorteras nyast först vid skrivning

const TYPES = {
  C172: { eng: 'se', kts: 102, regs: ['SE-KBT', 'SE-KFR'] },
  PA28: { eng: 'se', kts: 105, regs: ['SE-GVH'] },
  DA42: { eng: 'me', kts: 135, regs: ['SE-MLE', 'SE-MLF'] },
  PA18: { eng: 'se', kts: 80, regs: ['SE-CUB'] },
  AT76: { eng: 'me', kts: 255, regs: ['SE-MVA', 'SE-MVB', 'SE-MVC', 'SE-MVD', 'SE-MVE', 'SE-MVF', 'SE-MVG'] },
};
const ATO_C172 = 'SE-KUR'; // CPL-skolans C172 i Linköping

// Blocktid (min) ur distans: fast tillägg (taxi/stigning) + distans/fart, ±5 % brus.
function blockFor(type, from, to, extraMin = 0) {
  const t = TYPES[type];
  const overhead = type === 'AT76' ? 19 : 14;
  const base = overhead + (distNm(ap(from), ap(to)) / t.kts) * 60 + extraMin;
  return Math.max(12, Math.round(base * rng.float(0.95, 1.06)));
}

// En flygning. role: 'pic' | 'dual' | 'cop'. tos/ldgs = antal starter/landningar (spridda över passet).
function flight(o) {
  const { from, to, depMs, type, reg, role } = o;
  const blockMin = o.blockMin ?? blockFor(type, from, to);
  const A = ap(from), B = ap(to), arrMs = depMs + blockMin * 60000;
  const nightMin = Math.min(blockMin, nightMinutes(A, B, depMs, blockMin));
  const tos = o.tos ?? 1, ldgs = o.ldgs ?? 1;
  let dTo = 0, nTo = 0, dLd = 0, nLd = 0;
  for (let i = 0; i < tos; i++) {
    const t = tos === 1 ? depMs + 6 * 60000 : depMs + (blockMin * 60000 * i) / tos + 4 * 60000;
    if (isNight(t, A.lat, A.lon)) nTo++; else dTo++;
  }
  for (let i = 0; i < ldgs; i++) {
    const t = ldgs === 1 ? arrMs - 5 * 60000 : depMs + (blockMin * 60000 * (i + 1)) / ldgs - 3 * 60000;
    if (isNight(t, B.lat, B.lon)) nLd++; else dLd++;
  }
  const eng = TYPES[type].eng;
  const ifrMin = o.ifr === 'all' ? blockMin : Math.min(blockMin, o.ifr ?? 0);
  rows.push({
    ms: depMs,
    from, to, blockMin, nightMin, type, role, mp: !!o.mp, trip: o.trip,
    cells: [
      isoDate(depMs), type, reg, from, hhmm(depMs), to, hhmm(arrMs),
      dur(blockMin),
      dur(eng === 'se' ? blockMin : 0), dur(eng === 'me' ? blockMin : 0),
      dur(o.mp ? blockMin : 0),
      dur(role === 'pic' ? blockMin : 0), dur(role === 'cop' ? blockMin : 0), dur(role === 'dual' ? blockMin : 0),
      dur(nightMin), dur(ifrMin), o.rules ?? (ifrMin > 0 ? 'IFR' : 'VFR'),
      dTo, nTo, dLd, nLd,
      o.d3 ?? 0, o.d2 ?? 0, o.holds ?? 0, '0',
      o.second ?? '', o.remarks ?? '',
    ],
  });
  return arrMs;
}

// Simulatorpass (FFS): ingen rutt/blocktid; tiden i Total + Sim.
function sim(dateMs, type, min, second, remarks) {
  rows.push({
    ms: dateMs + 8 * 3600000, sim: true, blockMin: min, type,
    cells: [isoDate(dateMs), type, '', '', '', '', '', dur(min), '0', '0', '0', '0', '0', '0', '0', '0', '', 0, 0, 0, 0, 0, 0, 0, dur(min), second, remarks],
  });
}

const D = (y, m, d) => Date.UTC(y, m - 1, d);
const ymd = (ms) => { const x = new Date(ms); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; };
const se = (ms, h, mi) => { const [y, m, d] = ymd(ms); return localToUtc('SE', y, m, d, h, mi); };

// VFR-avgång mitt på dagen (dagsljus vid avgångsplatsen) — null om fönstret är för kort.
function vfrDep(dayMs, from, needMin, prefer = 'any') {
  const A = ap(from);
  const dl = daylight(dayMs, A.lat, A.lon);
  if (!dl) return null;
  const earliest = dl.first + 100 * 60000, latest = dl.last - (needMin + 40) * 60000;
  if (latest <= earliest) return null;
  const f = prefer === 'morning' ? rng.float(0, 0.35) : prefer === 'afternoon' ? rng.float(0.5, 0.95) : rng.float(0.1, 0.9);
  return Math.round((earliest + (latest - earliest) * f) / 300000) * 300000; // jämna 5 min
}

// ── A. PPL(A) 2018 på ESOW (Västerås) ─────────────────────────────────────────
const LARS = 'Lars Ekström', MARIA = 'Maria Holm', GORAN = 'Göran Lund';
const pplLessons = [
  ['2018-03-10', 'dual', 60, 1, 'Ex 1–5 Familiarisation', LARS],
  ['2018-03-17', 'dual', 66, 1, 'Ex 6–7 Effects of controls, straight & level', LARS],
  ['2018-03-24', 'dual', 62, 1, 'Ex 8–9 Climbing, descending & turns', LARS],
  ['2018-04-03', 'dual', 70, 2, 'Ex 10 Slow flight & stalls', LARS],
  ['2018-04-07', 'dual', 60, 1, 'Ex 11 Spin avoidance', LARS],
  ['2018-04-14', 'dual', 55, 7, 'Ex 12–13 Circuits', LARS],
  ['2018-04-18', 'dual', 58, 8, 'Circuits – flapless & glide approaches', LARS],
  ['2018-04-21', 'dual', 52, 7, 'Circuits – EFATO', MARIA],
  ['2018-04-28', 'dual', 50, 6, 'Circuits – crosswind', LARS],
  ['2018-05-02', 'dual', 48, 6, 'Circuits', MARIA],
  ['2018-05-05', 'dual', 35, 4, 'Pre-solo check', LARS],
  ['2018-05-05', 'solo', 18, 1, 'First solo!', ''],
  ['2018-05-09', 'solo', 42, 5, 'Solo circuits', ''],
  ['2018-05-12', 'dual', 40, 4, 'Dual check', MARIA],
  ['2018-05-12', 'solo', 45, 5, 'Solo circuits', ''],
  ['2018-05-19', 'dual', 64, 2, 'Ex 16 Forced landing without power', LARS],
  ['2018-05-23', 'solo', 50, 2, 'Solo – upper air work', ''],
  ['2018-05-26', 'dual', 66, 2, 'Ex 17 Precautionary landing', LARS],
  ['2018-06-06', 'dual', 60, 1, 'Ex 19 Basic instrument flight', MARIA],
  ['2018-06-23', 'solo', 70, 2, 'Solo – steep turns & stalls', ''],
  ['2018-07-07', 'dual', 70, 3, 'Revision – PFL & steep turns', LARS],
  ['2018-07-14', 'solo', 55, 4, 'Solo circuits', ''],
  ['2018-08-04', 'dual', 80, 3, 'Mock skill test', LARS],
  ['2018-08-11', 'solo', 60, 3, 'Solo – revision', ''],
];
for (const [date, kind, min, ldgs, rem, who] of pplLessons) {
  const day = Date.parse(date + 'T00:00:00Z');
  const dep = (kind === 'solo' && rem !== 'First solo!' ? vfrDep(day, 'ESOW', min, 'afternoon') : vfrDep(day, 'ESOW', min + 60, 'morning')) ?? se(day, 10, 0);
  const off = rem === 'First solo!' ? se(day, 12, 15) : dep;
  flight({ from: 'ESOW', to: 'ESOW', depMs: off, blockMin: min, type: 'C172', reg: rng.pick(TYPES.C172.regs), role: kind === 'solo' ? 'pic' : 'dual', tos: ldgs, ldgs, remarks: rem, second: who });
}
// Navigationspass (dual) + kvalificerande solo-XC + skill test
function legs(dayMs, route, opts) {
  let t = vfrDep(dayMs, route[0], 60 * route.length, opts.prefer ?? 'morning') ?? se(dayMs, 9, 0);
  const out = [];
  for (let i = 0; i < route.length - 1; i++) {
    const rem = typeof opts.remarks === 'function' ? opts.remarks(i, route.length - 1) : (i === 0 ? opts.remarks ?? '' : '');
    const arr = flight({ from: route[i], to: route[i + 1], depMs: t, type: opts.type, reg: opts.reg, role: opts.role, second: opts.second ?? '', remarks: rem, mp: opts.mp, ifr: opts.ifr, rules: opts.rules, d3: opts.d3?.(i), d2: opts.d2?.(i), holds: opts.holds?.(i) });
    out.push(arr);
    t = arr + (opts.groundMin ?? rng.int(35, 75)) * 60000;
  }
  return t;
}
legs(D(2018, 6, 2), ['ESOW', 'ESOE', 'ESKN', 'ESOW'], { type: 'C172', reg: 'SE-KBT', role: 'dual', second: LARS, remarks: 'Ex 18 Navigation' });
legs(D(2018, 6, 9), ['ESOW', 'ESSD', 'ESKM', 'ESOW'], { type: 'C172', reg: 'SE-KFR', role: 'dual', second: MARIA, remarks: 'Ex 18 Navigation – diversion' });
legs(D(2018, 6, 16), ['ESOW', 'ESOE', 'ESKN', 'ESOW'], { type: 'C172', reg: 'SE-KBT', role: 'pic', remarks: (i, n) => `Qualifying solo XC ${i + 1}/${n}` });
legs(D(2018, 6, 30), ['ESOW', 'ESSL', 'ESOW'], { type: 'C172', reg: 'SE-KFR', role: 'pic', remarks: 'Solo XC' });
legs(D(2018, 7, 21), ['ESOW', 'ESSD', 'ESOW'], { type: 'C172', reg: 'SE-KBT', role: 'pic', remarks: 'Solo XC' });
legs(D(2018, 8, 20), ['ESOW', 'ESKN', 'ESOW'], { type: 'C172', reg: 'SE-KBT', role: 'dual', second: GORAN, remarks: (i) => (i === 0 ? 'PPL skill test 1/2' : 'PPL skill test 2/2 – PASS') });

// ── B. Timbygge som PPL-pilot (PIC) — lokalt, utflykter, helger ──────────────
const SHORT = ['ESOE', 'ESKN', 'ESSL', 'ESSP', 'ESSD', 'ESSK', 'ESSE', 'ESOK'];
const MEDIUM = ['ESSV', 'EFMA', 'ESGJ', 'ESMQ', 'ESNN', 'ESOH', 'ESKM', 'ESSF'];
const LONG = ['ESGP', 'ESMX', 'ESTL', 'ESNZ', 'ESMK', 'ESGT'];
const LOCAL_REM = ['Sunset flight', 'Lake Mälaren sightseeing', 'Introducing a friend to flying', 'Local – steep turns & PFL practice', 'Photo flight over Västerås', 'Circuits – keeping current', 'Sightseeing with family', ''];
const TRIP_REM = ['Lunch trip', 'Weekend trip with friends', 'Fly-in', 'Coffee run', 'Day trip', '', '', ''];
let tripSeq = 0;
function gaDay(dayMs, base, intensity) {
  const trip = ++tripSeq;
  const kind = rng.weighted([['local', 0.36], ['short', 0.27], ['medium', 0.24], ['long', 0.13 * intensity]]);
  const type = rng.chance(0.7) ? 'C172' : 'PA28';
  const reg = rng.pick(TYPES[type].regs);
  if (kind === 'local') {
    const min = rng.int(50, 95);
    const dep = vfrDep(dayMs, base, min);
    if (!dep) return;
    const n = rng.chance(0.25) ? rng.int(3, 6) : rng.int(1, 2);
    flight({ from: base, to: base, depMs: dep, blockMin: min, type, reg, role: 'pic', tos: n, ldgs: n, remarks: rng.pick(LOCAL_REM), trip });
    return;
  }
  const dest = rng.pick(kind === 'short' ? SHORT : kind === 'medium' ? MEDIUM : LONG);
  const need = blockFor(type, base, dest) * 2 + 120;
  const dep = vfrDep(dayMs, base, need, 'morning');
  if (!dep) return;
  const rem = rng.pick(TRIP_REM);
  const arr = flight({ from: base, to: dest, depMs: dep, type, reg, role: 'pic', remarks: rem, trip });
  const back = arr + rng.int(70, 180) * 60000;
  flight({ from: dest, to: base, depMs: back, type, reg, role: 'pic', trip });
}
function gaSeason(fromMs, toMs, probBySeason, base = 'ESOW', skip = []) {
  for (let w = fromMs; w < toMs; w += 7 * DAY) {
    const m = new Date(w).getUTCMonth() + 1;
    const p = m >= 5 && m <= 8 ? probBySeason[0] : (m === 4 || m === 9 || m === 10) ? probBySeason[1] : probBySeason[2];
    if (!rng.chance(p)) continue;
    const day = w + rng.int(0, 6) * DAY;
    if (skip.some(([a, b]) => day >= a && day <= b)) continue;
    gaDay(day, base, m >= 5 && m <= 8 ? 1 : 0.4);
  }
}
const EURO = [D(2019, 7, 5), D(2019, 7, 22)], NORTH = [D(2020, 8, 7), D(2020, 8, 16)], NR = [D(2019, 1, 10), D(2019, 2, 10)];
gaSeason(D(2018, 8, 25), D(2020, 12, 31), [0.5, 0.32, 0.1], 'ESOW', [EURO, NORTH, NR]);

// Nattbehörighet (jan–feb 2019)
const nightDep = (dayMs, h, mi) => se(dayMs, h, mi);
flight({ from: 'ESOW', to: 'ESOW', depMs: nightDep(D(2019, 1, 12), 17, 40), blockMin: 70, type: 'C172', reg: 'SE-KBT', role: 'dual', tos: 6, ldgs: 6, second: MARIA, remarks: 'Night rating – dual circuits' });
{ const a = flight({ from: 'ESOW', to: 'ESOE', depMs: nightDep(D(2019, 1, 19), 18, 5), type: 'C172', reg: 'SE-KBT', role: 'dual', second: MARIA, remarks: 'Night rating – dual navigation' });
  flight({ from: 'ESOE', to: 'ESOW', depMs: a + 30 * 60000, type: 'C172', reg: 'SE-KBT', role: 'dual', second: MARIA }); }
flight({ from: 'ESOW', to: 'ESOW', depMs: nightDep(D(2019, 1, 26), 17, 30), blockMin: 40, type: 'C172', reg: 'SE-KFR', role: 'dual', tos: 4, ldgs: 4, second: MARIA, remarks: 'Night rating – dual check' });
flight({ from: 'ESOW', to: 'ESOW', depMs: nightDep(D(2019, 1, 26), 18, 25), blockMin: 65, type: 'C172', reg: 'SE-KFR', role: 'pic', tos: 5, ldgs: 5, remarks: 'Night rating – solo, 5 full-stop landings' });
flight({ from: 'ESOW', to: 'ESOW', depMs: nightDep(D(2019, 2, 9), 18, 0), blockMin: 50, type: 'C172', reg: 'SE-KBT', role: 'pic', tos: 2, ldgs: 2, remarks: 'Night solo – rating complete' });

// Europaturen juli 2019 (C172 SE-KBT) — 16 länder på en sommar
const EURO_ROUTE = ['ESOW', 'ESTL', 'EKRK', 'EDHL', 'EHLE', 'EBAW', 'LFAT', 'EGKB', 'LFAT', 'LFPN', 'LFST', 'LSZB', 'LOWS', 'LKPR', 'EPWR', 'EPGD', 'EYPA', 'EVRA', 'EETN', 'EFTU', 'EFMA', 'ESOW'];
function tour(startDay, route, opts) {
  let day = startDay, t = null, leg = 0;
  const n = route.length - 1;
  for (let i = 0; i < n; i++) {
    const need = blockFor(opts.type, route[i], route[i + 1]) + 30;
    if (t === null || t + need * 60000 > (daylight(day, ap(route[i]).lat, ap(route[i]).lon)?.last ?? 0) - 40 * 60000 || (opts.legsPerDay && leg >= opts.legsPerDay)) {
      if (t !== null) day += (rng.chance(opts.restDay ?? 0.3) ? 2 : 1) * DAY; // ibland en vilodag
      t = vfrDep(day, route[i], need, 'morning');
      leg = 0;
      if (!t) { i--; day += DAY; continue; }
    }
    const arr = flight({ from: route[i], to: route[i + 1], depMs: t, type: opts.type, reg: opts.reg, role: 'pic', remarks: `${opts.name} leg ${i + 1}/${n}` });
    t = arr + rng.int(60, 120) * 60000;
    leg++;
  }
}
tour(D(2019, 7, 6), EURO_ROUTE, { type: 'C172', reg: 'SE-KBT', name: 'Euro tour', legsPerDay: 3, restDay: 0.25 });
tour(D(2020, 8, 8), ['ESOW', 'ESNN', 'ESNU', 'ESPA', 'ESNQ', 'ESNJ', 'ESNZ', 'ESKM', 'ESOW'], { type: 'PA28', reg: 'SE-GVH', name: 'Lapland tour', legsPerDay: 2, restDay: 0.3 });

// ── C. MEP + IR(A) 2021 på ATO i Linköping (DA42) ─────────────────────────────
const HENRIK = 'Henrik Sjödin', ANNA = 'Anna Westberg', BENGT = 'Bengt Forsell';
const mepDays = [[D(2021, 2, 15), 70, 'MEP class rating – asymmetric flight'], [D(2021, 2, 17), 80, 'MEP – EFATO & single-engine approach'], [D(2021, 2, 22), 75, 'MEP class rating skill test – PASS']];
for (const [day, min, rem] of mepDays) {
  const dep = vfrDep(day, 'ESSL', min + 30) ?? se(day, 11, 0);
  flight({ from: 'ESSL', to: 'ESSL', depMs: dep, blockMin: min, type: 'DA42', reg: 'SE-MLE', role: 'dual', tos: 4, ldgs: 4, second: rem.includes('skill') ? BENGT : HENRIK, remarks: rem });
}
const irPlan = [
  ['local', 'IR – holding patterns & VOR approaches'], ['local', 'IR – ILS & go-around'], ['xc', ['ESSL', 'ESKN', 'ESSL'], 'IR – IFR cross-country'],
  ['local', 'IR – RNP approaches'], ['local', 'IR – NDB & partial panel'], ['xc', ['ESSL', 'ESGG', 'ESSL'], 'IR – IFR cross-country, Göteborg'],
  ['local', 'IR – engine failure in IMC'], ['xc', ['ESSL', 'ESOE', 'ESSL'], 'IR – IFR cross-country'], ['local', 'IR – holds & DME arcs'],
  ['xc', ['ESSL', 'ESMS', 'ESSL'], 'IR – IFR cross-country, Malmö'], ['local', 'IR – single-engine ILS'], ['xc', ['ESSL', 'ESGJ', 'ESSL'], 'IR – IFR cross-country'],
  ['local', 'IR – circling & missed approach'], ['xc', ['ESSL', 'ESMQ', 'ESSL'], 'IR – IFR cross-country, Kalmar'], ['local', 'IR mock skill test'],
];
let irDay = D(2021, 3, 2);
for (const p of irPlan) {
  irDay += rng.int(5, 9) * DAY;
  const who = rng.chance(0.6) ? HENRIK : ANNA;
  const evening = rng.chance(0.3);
  if (p[0] === 'local') {
    const min = rng.int(95, 125);
    const dep = evening ? se(irDay, 17, 30) : (vfrDep(irDay, 'ESSL', min) ?? se(irDay, 10, 0));
    flight({ from: 'ESSL', to: 'ESSL', depMs: dep, blockMin: min, type: 'DA42', reg: rng.pick(TYPES.DA42.regs), role: 'dual', ifr: min - 12, rules: 'IFR', tos: 1, ldgs: 1, d3: rng.int(1, 2), d2: rng.int(1, 2), holds: rng.int(1, 2), second: who, remarks: p[1] });
  } else {
    const start = evening ? se(irDay, 16, 0) : (vfrDep(irDay, 'ESSL', 240) ?? se(irDay, 9, 0));
    legs(start, p[1], { type: 'DA42', reg: rng.pick(TYPES.DA42.regs), role: 'dual', second: who, remarks: p[2], ifr: 600, rules: 'IFR', d3: () => 1, d2: () => rng.int(0, 1), holds: () => (rng.chance(0.4) ? 1 : 0), groundMin: rng.int(40, 70) });
  }
}
flight({ from: 'ESSL', to: 'ESSL', depMs: se(D(2021, 7, 2), 10, 15), blockMin: 112, type: 'DA42', reg: 'SE-MLE', role: 'dual', ifr: 100, rules: 'IFR', d3: 2, d2: 1, holds: 1, second: BENGT, remarks: 'IR(A) ME skill test – PASS' });

// ── D. CPL(A) aug–sep 2021 (C172 + DA42 komplex) ─────────────────────────────
const cplPlan = [
  ['C172', 'local', 75, 'CPL – steep turns & stalls'], ['C172', ['ESSL', 'ESSF', 'ESSL'], 0, 'CPL – navigation & diversion'],
  ['C172', 'local', 70, 'CPL – PFL & precautionary landing'], ['DA42', 'local', 80, 'CPL – complex aircraft'],
  ['C172', ['ESSL', 'ESGJ', 'ESSL'], 0, 'CPL – navigation at low level'], ['DA42', 'local', 95, 'CPL – complex, EFATO'],
  ['C172', 'local', 65, 'CPL – short-field & soft-field'], ['C172', ['ESSL', 'ESKN', 'ESSL'], 0, 'CPL mock skill test'],
];
let cplDay = D(2021, 8, 9);
for (const [type, kind, min, rem] of cplPlan) {
  cplDay += rng.int(3, 5) * DAY;
  const reg = type === 'C172' ? ATO_C172 : 'SE-MLF';
  const who = rng.chance(0.5) ? HENRIK : ANNA;
  if (kind === 'local') flight({ from: 'ESSL', to: 'ESSL', depMs: vfrDep(cplDay, 'ESSL', min) ?? se(cplDay, 11, 0), blockMin: min, type, reg, role: 'dual', tos: 3, ldgs: 3, second: who, remarks: rem });
  else legs(cplDay, kind, { type, reg, role: 'dual', second: who, remarks: rem });
}
legs(D(2021, 9, 14), ['ESSL', 'ESKN', 'ESSL'], { type: 'C172', reg: ATO_C172, role: 'dual', second: BENGT, remarks: (i) => (i === 0 ? 'CPL(A) skill test 1/2' : 'CPL(A) skill test 2/2 – PASS') });

// ── E. MCC/JOC nov 2021 (A320 FFS) ────────────────────────────────────────────
for (let i = 0; i < 5; i++) sim(D(2021, 11, 8 + i), 'A320', 240, 'Mikael Brandt', i === 4 ? 'MCC/JOC 5/5 – course complete' : `MCC/JOC ${i + 1}/5`);

// ── F. Klubbflyg 2022 → feb 2024 (+ Finland 2022 och Norge 2023) ─────────────
const FIN = [D(2022, 7, 8), D(2022, 7, 17)], NOR = [D(2023, 6, 16), D(2023, 6, 25)];
gaSeason(D(2022, 1, 3), D(2024, 2, 25), [0.32, 0.2, 0.06], 'ESOW', [FIN, NOR]);
tour(D(2022, 7, 9), ['ESOW', 'EFMA', 'EFTU', 'EFTP', 'EFJY', 'EFKU', 'EFOU', 'ESPA', 'ESNU', 'ESNN', 'ESOW'], { type: 'C172', reg: 'SE-KFR', name: 'Finland tour', legsPerDay: 2, restDay: 0.25 });
tour(D(2023, 6, 17), ['ESOW', 'ENTO', 'ENCN', 'ENZV', 'ENBR', 'ENAL', 'ENVA', 'ESNZ', 'ESOW'], { type: 'PA28', reg: 'SE-GVH', name: 'Norway coast tour', legsPerDay: 2, restDay: 0.35 });

// ── G. ATR 72-600: TR (FFS) → base training → LIFUS → linjeflyg från ESSB ─────
const KARIN = 'Karin Öhman', PETER = 'Peter Lindqvist', JOHAN = 'Johan Bergkvist';
let trDay = D(2024, 3, 4);
for (let i = 1; i <= 10; i++) { sim(trDay, 'AT76', 240, i % 2 ? KARIN : PETER, `ATR 72 TR – FFS ${i}/10`); trDay += rng.int(2, 4) * DAY; }
sim(D(2024, 4, 26), 'AT76', 240, JOHAN, 'ATR 72 LST – PASS');
flight({ from: 'ESOK', to: 'ESOK', depMs: se(D(2024, 5, 21), 10, 40), blockMin: 65, type: 'AT76', reg: 'SE-MVC', role: 'dual', mp: true, rules: 'VFR', tos: 6, ldgs: 6, second: PETER, remarks: 'Base training – 6 landings' });

const DEST_W = [['ESGG', 16], ['ESMS', 15], ['ESSV', 10], ['ESNU', 9], ['ESNZ', 6], ['ESMQ', 6], ['ESMX', 5], ['ESTA', 5], ['ESMT', 3], ['ESNN', 4], ['ESNS', 4], ['ESPA', 6], ['ESNQ', 3], ['ESDF', 3], ['ESNO', 2], ['EFMA', 1], ['EKCH', 1]];
const NIGHTSTOP = ['ESPA', 'ESNU', 'ESMS', 'ESGG', 'ESSV', 'ESNS', 'ESNQ'];
const CAPTAINS = ['Anders Berg', 'Magnus Hed', 'Cecilia Nordin', 'Daniel Ström', 'Erik Wahlberg', 'Helena Lind', 'Jonas Eklund', 'Kristoffer Ahl', 'Linda Svedberg', 'Mats Ryd', 'Niklas Borg', 'Ola Hammar', 'Patrik Engström', 'Robert Kjellin', 'Sara Ljung', 'Tobias Granath', 'Ulrika Moberg', 'Viktor Sand', 'Åsa Lindblom', 'Emma Grahn', 'Martin Fors', 'Camilla Teng', 'David Hult', 'Lisa Norén', 'Stefan Ek', 'Fredrik Almgren', 'Sofia Rehn', KARIN, PETER];
const TRAINERS = [KARIN, 'Fredrik Almgren', 'Sofia Rehn', PETER];
const LINE_REM = ['De-icing before departure', 'Gusty crosswind, 26 kt', 'Snow on runway – braking action medium', 'Northern lights en route', 'Go-around – wind shear', 'Turbulence in descent', 'Low visibility procedures', 'Bird strike check – no damage'];

let pfToggle = rng.chance(0.5);
// En tjänstgöringsdag: lista av sektorer [från, till]; första avgång lokal tid (SE). Returnerar slutplats.
function dutyDay(dayMs, sectors, firstLocal, captain, opts = {}) {
  let t = se(dayMs, firstLocal[0], firstLocal[1]);
  const reg = opts.reg ?? rng.pick(TYPES.AT76.regs);
  sectors.forEach(([a, b], i) => {
    const pf = (pfToggle = !pfToggle);
    const holds = opts.holdOn === i ? 1 : (rng.chance(0.03) ? 1 : 0);
    const appr = pf ? (opts.npaOn === i || rng.chance(0.2) ? { d2: 1 } : { d3: 1 }) : {};
    const rem = opts.remarks?.(i) ?? (rng.chance(0.035) ? rng.pick(LINE_REM) : holds ? 'Holding – traffic' : '');
    const arr = flight({ from: a, to: b, depMs: t, type: 'AT76', reg, role: 'cop', mp: true, ifr: 'all', rules: 'IFR', tos: pf ? 1 : 0, ldgs: pf ? 1 : 0, holds, ...appr, second: captain, remarks: rem, blockMin: opts.blocks?.[i] });
    t = arr + rng.int(27, 40) * 60000;
  });
  return sectors[sectors.length - 1][1];
}
function planSectors(loc, wave) {
  const X = () => rng.weighted(DEST_W);
  if (loc !== 'ESSB') return wave === 'early' && rng.chance(0.5) ? [[loc, 'ESSB'], ...(() => { const x = X(); return [['ESSB', x], [x, 'ESSB']]; })()] : [[loc, 'ESSB']];
  if (wave === 'early') {
    const x = X();
    if (rng.chance(0.62)) { const y = X(); return [['ESSB', x], [x, 'ESSB'], ['ESSB', y], [y, 'ESSB']]; }
    return [['ESSB', x], [x, 'ESSB']];
  }
  const x = X();
  if (rng.chance(0.4)) { const y = rng.pick(NIGHTSTOP); return [['ESSB', x], [x, 'ESSB'], ['ESSB', y]]; }
  return [['ESSB', x], [x, 'ESSB']];
}
// LIFUS juni–aug 2024: 40 sektorer med instruktörskaptener + linecheck
{
  let day = D(2024, 6, 3), n = 0, loc = 'ESSB';
  while (n < 40) {
    if (rng.chance(0.62)) {
      const wave = rng.chance(0.5) ? 'early' : 'late';
      let secs = planSectors(loc, wave);
      if (n + secs.length > 40) secs = secs.slice(0, 40 - n);
      if (secs[secs.length - 1][1] !== 'ESSB' && n + secs.length === 40) secs = secs.slice(0, -1);
      const start = n;
      loc = dutyDay(day, secs, wave === 'early' ? [6, rng.int(0, 75)] : [rng.int(15, 17), rng.int(0, 55)], rng.pick(TRAINERS), { remarks: (i) => `LIFUS ${start + i + 1}/40` });
      n += secs.length;
    }
    day += DAY;
  }
  dutyDay(D(2024, 8, 28), [['ESSB', 'ESGG'], ['ESGG', 'ESSB']], [7, 5], JOHAN, { remarks: (i) => (i === 1 ? 'Line check – PASS' : 'Line check') });
}
// Linjeflyg sep 2024 → 3 okt 2026: block om 4–5 dagar (standby-dagar utan flyg), 3–5 lediga, semester.
{
  const VAC = [[D(2024, 12, 21), D(2024, 12, 28)], [D(2025, 2, 24), D(2025, 3, 2)], [D(2025, 6, 13), D(2025, 6, 16)], [D(2025, 7, 7), D(2025, 7, 27)], [D(2025, 12, 22), D(2025, 12, 29)], [D(2026, 7, 6), D(2026, 7, 26)]];
  const RECURRENT = [[D(2025, 3, 18), KARIN, 'OPC – PASS'], [D(2025, 9, 16), JOHAN, 'OPC/LPC – PASS'], [D(2026, 3, 24), KARIN, 'OPC – PASS']];
  let day = D(2024, 9, 2), loc = 'ESSB';
  const end = D(2026, 10, 3);
  while (day <= end) {
    const block = rng.int(4, 5), captain = rng.pick(CAPTAINS);
    for (let i = 0; i < block && day <= end; i++, day += DAY) {
      if (VAC.some(([a, b]) => day >= a && day <= b)) continue;
      const rec = RECURRENT.find(([d]) => d === day);
      if (rec) { sim(day, 'AT76', 240, rec[1], rec[2]); continue; }
      if (loc === 'ESSB' && !rng.chance(0.72)) continue; // standby utan utkallning
      const wave = loc !== 'ESSB' ? 'early' : rng.chance(0.55) ? 'early' : 'late';
      const secs = planSectors(loc, wave);
      loc = dutyDay(day, secs, wave === 'early' ? [6, rng.int(0, 75)] : [rng.int(15, 17), rng.int(0, 55)], captain);
    }
    if (loc !== 'ESSB') { dutyDay(day, [[loc, 'ESSB']], [7, rng.int(0, 40)], captain); loc = 'ESSB'; day += DAY; }
    day += rng.int(3, 5) * DAY;
  }
}
// Klubbflyg under ATR-åren (glesare) + Bornholmshelg 2025
const BORN = [D(2025, 6, 13), D(2025, 6, 16)];
gaSeason(D(2024, 3, 1), D(2026, 9, 27), [0.14, 0.07, 0.0], 'ESOW', [BORN]);
tour(D(2025, 6, 14), ['ESOW', 'ESMQ', 'EKRN', 'EKRK', 'EKOD', 'ESTL', 'ESOW'], { type: 'C172', reg: 'SE-KBT', name: 'Denmark weekend', legsPerDay: 3, restDay: 0 });

// ── H. Sista veckan, manuellt komponerad (de 15 nyaste raderna = AI:ns mappningsprov) ──
dutyDay(D(2026, 10, 4), [['ESSB', 'ESGG'], ['ESGG', 'ESSB']], [15, 20], 'Anders Berg');
pfToggle = false;
flight({ from: 'ESSE', to: 'ESSE', depMs: se(D(2026, 10, 5), 10, 30), blockMin: 50, type: 'PA18', reg: 'SE-CUB', role: 'dual', tos: 6, ldgs: 6, second: 'Olle Strand', remarks: 'Tailwheel conversion 1/3' });
flight({ from: 'ESSE', to: 'ESSE', depMs: se(D(2026, 10, 5), 13, 0), blockMin: 55, type: 'PA18', reg: 'SE-CUB', role: 'dual', tos: 7, ldgs: 7, second: 'Olle Strand', remarks: 'Tailwheel conversion 2/3 – wheel landings' });
sim(D(2026, 10, 6), 'AT76', 240, JOHAN, 'OPC/LPC – PASS');
pfToggle = false; // PF på första sektorn: nattstart från Bromma 06:00 lokal + RNP-inflygning i Malmö
dutyDay(D(2026, 10, 8), [['ESSB', 'ESMS'], ['ESMS', 'ESSB']], [6, 0], 'Cecilia Nordin', { npaOn: 0 });
pfToggle = false; // PF på sektor 1 och 3 → nattlandning i Visby
dutyDay(D(2026, 10, 9), [['ESSB', 'ESNU'], ['ESNU', 'ESSB'], ['ESSB', 'ESSV']], [15, 10], 'Cecilia Nordin', { remarks: (i) => (i === 2 ? 'Nightstop Visby' : '') });
pfToggle = true;
dutyDay(D(2026, 10, 10), [['ESSV', 'ESSB'], ['ESSB', 'ESGG'], ['ESGG', 'ESSB']], [6, 50], 'Cecilia Nordin', { holdOn: 1, remarks: (i) => (i === 1 ? 'Holding 8 min – fog at ESGG' : '') });
flight({ from: 'ESSE', to: 'ESSE', depMs: se(D(2026, 10, 11), 10, 0), blockMin: 45, type: 'PA18', reg: 'SE-CUB', role: 'dual', tos: 5, ldgs: 5, second: 'Olle Strand', remarks: 'Tailwheel conversion 3/3 – signed off' });
flight({ from: 'ESOW', to: 'ESOW', depMs: se(D(2026, 10, 11), 17, 50), blockMin: 70, type: 'C172', reg: 'SE-KBT', role: 'pic', tos: 1, ldgs: 1, remarks: 'Sunset flight over Lake Mälaren' });

// ── Inga klubbflygningar på dagar med ATR-pass (slumpade turer tas bort) ──
{
  const atrDays = new Set(rows.filter((r) => r.type === 'AT76' && !r.sim).map((r) => isoDate(r.ms)));
  const clashTrips = new Set(rows.filter((r) => r.trip && atrDays.has(isoDate(r.ms))).map((r) => r.trip));
  for (let i = rows.length - 1; i >= 0; i--) if (clashTrips.has(rows[i].trip)) rows.splice(i, 1);
}

// ── Kalibrering: PIC ≈ 205 h (ATPL-kravet 250 ska visas som pågående) — ta bort hela klubbturer ──
{
  const TARGET_PIC_MIN = 205 * 60;
  const picMin = () => rows.reduce((s, r) => s + (r.role === 'pic' && !r.sim ? r.blockMin : 0), 0);
  const trips = [...new Set(rows.filter((r) => r.trip).map((r) => r.trip))];
  while (picMin() > TARGET_PIC_MIN && trips.length) {
    const t = trips.splice(Math.floor(rng.r() * trips.length), 1)[0];
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].trip === t) rows.splice(i, 1);
  }
}

// ── Skriv CSV (nyast först) + statistik ──────────────────────────────────────
const HEADER = ['Date', 'Aircraft Type', 'Registration', 'From', 'Off Blocks', 'To', 'On Blocks', 'Total', 'SE', 'ME', 'Multi Pilot', 'PIC', 'Co-Pilot', 'Dual', 'Night', 'IFR', 'Flight Rules', 'Day Takeoffs', 'Night Takeoffs', 'Day Landings', 'Night Landings', '3D', '2D', 'Holds', 'Sim', 'Second Pilot', 'Remarks'];
rows.sort((a, b) => b.ms - a.ms);
mkdirSync(OUT_DIR, { recursive: true });
const file = `${OUT_DIR}/blades-demo-pilot-fixed-wing.csv`;
writeFileSync(file, [csvLine(HEADER), ...rows.map((r) => csvLine(r.cells))].join('\n') + '\n');

// Statistik som appen räknar (sim exkluderat), för att kalibrera mot ATPL-kraven.
const real = rows.filter((r) => !r.sim);
const h = (f) => Math.round(real.reduce((s, r) => s + f(r), 0) / 6) / 10;
const tot = h((r) => r.blockMin), pic = h((r) => (r.role === 'pic' ? r.blockMin : 0)), cop = h((r) => (r.role === 'cop' ? r.blockMin : 0));
const dual = h((r) => (r.role === 'dual' ? r.blockMin : 0)), mp = h((r) => (r.mp ? r.blockMin : 0)), night = h((r) => r.nightMin);
const ifr = Math.round(real.reduce((s, r) => s + (parseFloat(r.cells[15].split(':')[0]) * 60 + (parseFloat(r.cells[15].split(':')[1]) || 0) || 0), 0) / 6) / 10;
const xc = h((r) => (r.from !== r.to && r.blockMin >= 30 ? r.blockMin : 0));
const aps = new Set(real.flatMap((r) => [r.from, r.to]));
const ccs = new Set([...aps].map((c) => ap(c).cc));
const longest = real.reduce((m, r) => Math.max(m, distNm(ap(r.from), ap(r.to))), 0);
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + r.blockMin / 60;
console.log(`rader ${rows.length} (flyg ${real.length}, sim ${rows.length - real.length}) → ${file}`);
console.log(`Total ${tot} | PIC ${pic} | Co-pilot ${cop} | Dual ${dual} | MP ${mp} | Night ${night} | IFR ${ifr} | XC ${xc}`);
console.log(`ATPL: total ${tot}/1500, MP ${mp}/500, PIC ${pic}/250, XC ${xc}/200, IFR ${ifr}/75, night ${night}/100`);
console.log(`flygplatser ${aps.size}, länder ${ccs.size} (${[...ccs].join(' ')}), längsta ${Math.round(longest)} NM`);
console.log('per typ (h):', Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])));
const perYear = {};
for (const r of real) { const y = isoDate(r.ms).slice(0, 4); perYear[y] = (perYear[y] ?? 0) + r.blockMin / 60; }
console.log('per år (h):', Object.fromEntries(Object.entries(perYear).sort().map(([k, v]) => [k, Math.round(v)])));
