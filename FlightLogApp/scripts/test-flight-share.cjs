// Test av delningen av en flygning med sin second pilot (services/flightShare.ts): paketet tål resan genom
// länk och fil, rollerna vänds rätt, besättningsraden i remarks tas bort, flygplanet matchas mot mottagarens
// Fleet, och skräp eller påhittade värden i en inkommande länk stoppas.
// Kör: node scripts/test-flight-share.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '..', 'services/flightShare.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const S = mod.exports;

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };

const alex = { name: 'Alex Lindqvist', initials: 'AL' };
const flight = {
  id: 77, date: '2026-10-29', aircraft_type: 'AW139', registration: 'SE-JRA', dep_place: 'ESSA', dep_utc: '12:30', arr_place: 'ESGG', arr_utc: '13:50',
  dep_place_raw: 'ESSA', arr_place_raw: 'ESGG', total_time: 1.3333, ifr: 1.3333, vfr: 0, night: 0.5, nvg: 0, flight_rules: 'IFR', flight_type: 'normal',
  stop_place: '', multi_pilot: 1.3333, single_pilot: 0, pic: 1.3333, co_pilot: 0, dual: 0, picus: 0, spic: 0, instructor: 0, ferry_pic: 0, observer: 0, relief_crew: 0,
  second_pilot: 'Sam Berg', second_pilot_role: 'COP', extra_pilots: '', landings_day: 1, landings_night: 0, takeoffs_day: 1, takeoffs_night: 0,
  tng_count: 0, app_2d: 0, app_3d: 1, holds: 0, max_fl: 90, pilot_flying: 1.3333,
  remarks: 'Flight SK123 Göteborg\nESGG ILS 21\nSIC: Sam Berg', photo_uri: 'file:///private/x.jpg', book_id: 3,
};

console.log('Paketet: länk och fil ger samma flygning tillbaka');
const p = S.buildSharePayload(flight, alex);
ok(p.f.total_time === 1.3333 && p.f.landings_day === 1 && p.f.app_3d === 1, 'tider, landningar och inflygningar följer med');
ok(!('photo_uri' in p.f) && !('book_id' in p.f) && !('id' in p.f) && !('pilot_flying' in p.f), 'foto, bok, id och pilot flying skickas inte');
const link = S.toShareLink(p);
ok(link.startsWith('blades://shared-flight?d=') && link.length < 1200, `länken är kort nog (${link.length} tecken)`);
const viaLink = S.decodeSharedFlight(link);
ok(viaLink.ok && JSON.stringify(viaLink.payload) === JSON.stringify(p), 'länken läses tillbaka exakt');
const viaFile = S.decodeSharedFlight(S.toShareFileText(p));
ok(viaFile.ok && JSON.stringify(viaFile.payload) === JSON.stringify(p), 'filen läses tillbaka exakt');
ok(viaLink.payload.f.remarks.includes('Göteborg'), 'å, ä och ö klarar resan');
ok(S.shareFileName(p) === 'Blades flight ESSA-ESGG 2026-10-29.bladesflight', 'filnamnet');
ok(S.shareTitle(p).startsWith('Blades flight ESSA → ESGG, 29 Oct 2026'), 'delningsraden: ' + S.shareTitle(p));
ok(S.shareTitle({ ...p, from: { name: '', initials: '' }, f: { ...p.f, date: 'x' } }) === 'Blades flight ESSA → ESGG, x', 'delningsraden utan namn och med udda datum');

console.log('Omvända roller');
let r = S.reverseRoles(p);
ok(r.role === 'co_pilot' && !r.fi && r.secondPilotRole === 'PIC', 'PIC med SIC bredvid → mottagaren SIC, avsändaren PIC');
ok(r.remarks === 'Flight SK123 Göteborg\nESGG ILS 21', 'besättningsraden borta ur remarks, resten kvar');
r = S.reverseRoles(S.buildSharePayload({ ...flight, pic: 0, co_pilot: 1.3333, second_pilot_role: 'PIC' }, alex));
ok(r.role === 'pic' && r.secondPilotRole === 'COP', 'SIC med PIC bredvid → mottagaren PIC, avsändaren SIC');
r = S.reverseRoles(S.buildSharePayload({ ...flight, pic: 0, dual: 1.3333, second_pilot_role: 'FI' }, alex));
ok(r.role === 'pic' && r.fi && r.secondPilotRole === '', 'elev med FI bredvid → mottagaren PIC + FI');
r = S.reverseRoles(S.buildSharePayload({ ...flight, instructor: 1.3333, second_pilot_role: '' }, alex));
ok(r.role === 'dual' && r.secondPilotRole === 'FI', 'instruktör utan angiven roll bredvid → mottagaren Dual, avsändaren FI');
r = S.reverseRoles(S.buildSharePayload({ ...flight, second_pilot_role: 'PICUS' }, alex));
ok(r.role === 'picus' && r.secondPilotRole === 'PIC', 'PIC med PICUS bredvid → mottagaren PICUS');
r = S.reverseRoles(S.buildSharePayload({ ...flight, second_pilot_role: '' }, alex));
ok(r.role === 'co_pilot', 'PIC utan angiven roll bredvid → mottagaren SIC');

console.log('Formuläret till Log flight');
r = S.reverseRoles(p);
const form = S.toFormValues(p, r, 'Alex Lindqvist', { type: 'A139', registration: 'SE-JRA' });
ok(form.landings_day === '1' && form.takeoffs_day === '1' && form.app_3d === '1', 'landningar, starter och inflygningar som avsändarens');
ok(form.pilot_flying === '' && form.pic === '0' && form.co_pilot === '0', 'pilot flying tom (appen fyller i), rolltider nollade');
ok(form.second_pilot === 'Alex Lindqvist' && form.second_pilot_role === 'PIC', 'avsändaren som second pilot med sin roll');
ok(form.aircraft_type === 'A139' && form.flight_rules === 'IFR' && form.night === '0.5', 'valt flygplan, regler och natt');
const split = S.toFormValues(S.buildSharePayload({ ...flight, ifr: 0.5, vfr: 0, flight_rules: 'VFR' }, alex), r, 'x', { type: 'A', registration: 'B' });
ok(split.flight_rules === 'Y' && split.vfr === '0.83', `delad flygning får Y och resten som VFR (${split.flight_rules}, ${split.vfr})`);

console.log('Flygplanet mot mottagarens Fleet');
const fleet = [{ registration: 'SE-JRA', aircraft_type: 'A139', n: 212 }, { registration: 'SE-JRB', aircraft_type: 'A139', n: 40 }, { registration: 'SE-HEM', aircraft_type: 'H145', n: 3 }];
let m = S.matchAircraft({ type: 'A139', registration: 'se-jra' }, fleet);
ok(m.kind === 'exact', 'samma typ och registrering → ingen fråga');
m = S.matchAircraft({ type: 'AW139', registration: 'SE-JRA' }, fleet);
ok(m.kind === 'ask' && m.options[0].type === 'A139' && m.options[0].source === 'yours' && m.options[0].flights === 212 && m.options[1].type === 'AW139' && m.options[1].source === 'sent', 'annan typ på samma registrering → din först, avsändarens sedan');
m = S.matchAircraft({ type: 'A139', registration: 'SEJRA' }, fleet);
ok(m.kind === 'ask' && m.options[0].registration === 'SE-JRA', 'registrering utan bindestreck känns igen');
m = S.matchAircraft({ type: 'A-139', registration: 'SE-JRZ' }, fleet);
ok(m.kind === 'ask' && m.options[0].type === 'A139' && m.options[0].registration === 'SE-JRZ' && m.options.length === 2, 'ny registrering, typ skriven annorlunda → din typ föreslås');
m = S.matchAircraft({ type: 'A139', registration: 'SE-JRZ' }, fleet);
ok(m.kind === 'ask' && m.options.length === 1 && m.options[0].source === 'sent', 'ny registrering på en typ du har → en fråga med ett alternativ');
ok(S.matchAircraft({ type: 'B738', registration: 'SE-RPA' }, []).kind === 'exact', 'tom Fleet → ingen fråga');

console.log('Namnet på second pilot');
ok(S.pickSecondPilotName(alex, ['HES', 'al']) === 'al', 'mottagaren skriver redan initialerna → de används');
ok(S.pickSecondPilotName(alex, ['HES']) === 'Alex Lindqvist', 'okänd → hela namnet');

console.log('Skräp och påhittade värden');
ok(S.decodeSharedFlight('').reason === 'empty', 'tom text');
ok(S.decodeSharedFlight('blades://shared-flight?d=%%%').ok === false, 'trasig länk');
ok(S.decodeSharedFlight('{"app":"other","kind":"flight","v":1}').reason === 'not-a-flight', 'annan app');
ok(S.decodeSharedFlight(JSON.stringify({ ...p, v: 2 })).reason === 'newer', 'nyare version');
ok(S.decodeSharedFlight(JSON.stringify({ ...p, f: { ...p.f, flight_type: 'sim' } })).reason === 'incomplete', 'simulatorpass tas inte emot');
ok(S.decodeSharedFlight(JSON.stringify({ ...p, f: { ...p.f, date: '2026-13-45' } })).reason === 'incomplete', 'omöjligt datum');
ok(S.decodeSharedFlight('x'.repeat(30000)).reason === 'unreadable', 'för stor');
const evil = S.decodeSharedFlight(JSON.stringify({ ...p, from: { name: 'A'.repeat(500) + '\u0000', initials: 7 },
  f: { ...p.f, total_time: 1, night: 500, landings_day: -3, takeoffs_day: 1e9, dep_utc: '99:99', aircraft_type: 'X'.repeat(300), remarks: 'a\u0007b\nc', second_pilot_role: 'ADMIN', extra_pilots: '[{"role":"PIC","name":"Z"},{"role":"x","name":""}]', injected: 'DROP TABLE' } }));
ok(evil.ok, 'paketet läses, men städat');
const e = evil.payload;
ok(e.from.name.length === 60 && e.from.initials === '', 'namn kapat, fel typ blir tom');
ok(e.f.night === 1 && e.f.landings_day === 0 && e.f.takeoffs_day === 99 && e.f.dep_utc === '', 'tider och antal hålls inom rimliga gränser');
ok(e.f.aircraft_type.length === 24 && e.f.remarks === 'ab\nc' && e.f.second_pilot_role === '' && !('injected' in e.f), 'text kapad, styrtecken borta, okända fält borta');
ok(e.f.extra_pilots === '[{"role":"PIC","name":"Z"}]', 'fler piloter städade');
ok(S.canShareFlight(flight) && !S.canShareFlight({ flight_type: 'sim', total_time: 2 }) && !S.canShareFlight({ flight_type: 'summary', total_time: 9 }), 'sim och summarader delas inte');

console.log(fails === 0 ? '\n---- inga fel' : `\n---- ${fails} FEL`);
process.exit(fails ? 1 : 0);
