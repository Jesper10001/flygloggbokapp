// Test av LFV PIB-parsern (src/notamParse.mjs) med ett utdrag i samma form som unpdf ger. Kör: node scripts/test-notam.mjs
import assert from 'assert';
import { parsePib, pibIssued } from '../src/notamParse.mjs';
const raw = `Page of1 21 B3654/26 B3662/26 EAD AERONAUTICAL INFORMATION SERVICES Pre-Flight Information Bulletin: Date: 20 NOV 2026 Time: UTC18:00 Legend: + NOTAM not older than 250 days * Different from original ESAA - SWEDEN FIR AERODROMES ESCF - LINKOEPING/MALMEN + MIL PAPI RWY 26 U/S. 03 NOV 2026 07:52FROM: 03 FEB 2027 10:00 ESTTO: SNOWTAM 20 NOV 2026 11:25FROM: ESCF 11201123 01 5/5/5 WET ALL TWYS POOR. ESSA - STOCKHOLM/ARLANDA + WIP 400M BEFORE THR RWY 19L. 16 NOV 2026 06:00FROM: 26 FEB 2027 17:00TO: + STRETCHER SERVICE NOT AVBL 29 OCT 2026 17:12FROM: 27 JAN 2027 05:00 ESTTO: SCHEDULE: DAILY 2200-0500 * RWY EXIT X3 Page of2 21 B3123/26 C1065/26 CLSD 05 NOV 2026 09:37FROM: PERMTO: ESSC - ESKILSTUNA/EKEBY No information received or matching the query EN-ROUTE + DME HMR U/S 20 NOV 2026 10:18FROM: 19 FEB 2027 10:00 ESTTO:`;
const r = parsePib(raw);
assert.deepStrictEqual(Object.keys(r), ['ESCF', 'ESSA', 'ESSC']);
assert.deepStrictEqual(r.ESCF.notams, [{ text: 'MIL PAPI RWY 26 U/S.', from: '03 NOV 2026 07:52', to: '03 FEB 2027 10:00', est: true }]);
assert.strictEqual(r.ESCF.snowtam.issued, '20 NOV 2026 11:25');
assert.strictEqual(r.ESSA.notams.length, 3);
assert.strictEqual(r.ESSA.notams[1].sched, 'DAILY 2200-0500');
assert.strictEqual(r.ESSA.notams[2].text, 'RWY EXIT X3 CLSD');        // sidhuvudet mitt i texten bort
assert.strictEqual(r.ESSA.notams[2].to, 'PERM');
assert.deepStrictEqual(r.ESSC.notams, []);
assert.ok(!JSON.stringify(r).includes('DME HMR'));                   // EN-ROUTE hör inte till flygplatserna
assert.strictEqual(pibIssued(raw), '2026-11-20T18:00:00.000Z');
console.log('NOTAM-parsern: alla kontroller gick igenom');
