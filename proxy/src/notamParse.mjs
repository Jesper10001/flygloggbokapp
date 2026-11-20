// Parser för LFV:s Pre-Flight Information Bulletin (PIB), text utdragen ur PDF:en med unpdf.
// Formatet (2026-11-20): "ESAA - SWEDEN FIR AERODROMES", sedan en sektion per flygplats "ESSA - STOCKHOLM/ARLANDA",
// varje NOTAM börjar med "+" eller "*" och slutar med "<from>FROM: <to> [EST]TO:" (pdf-texten lägger etiketten
// EFTER värdet), ev. "SCHEDULE: …" efteråt. SNOWTAM ligger sist i sektionen. Sidhuvuden "Page of2 21 B3123/26 …"
// listar NOTAM-id:n i annan ordning och tas bort. Ren JS så att samma fil körs i Worker och i Node-testet.

const DT = String.raw`\d{2} [A-Z]{3} \d{4} \d{2}:\d{2}`;
const TERM = new RegExp(String.raw`\s*(${DT})FROM:\s*(${DT}|PERM|UFN)?\s*(EST)?\s*TO:\s*`);
const SNOW = new RegExp(String.raw`\s*SNOWTAM (${DT})FROM:\s*`);

export function cleanPib(raw) {
  return raw
    .replace(/Page of\s*\d+\s+\d+(\s+[A-Z]\d{4}\/\d{2})*/g, ' ')
    .replace(/\s+/g, ' ');
}

/** { [ICAO]: { name, notams: [{text, from, to, est, sched?}], snowtam?: {issued, text} } } */
export function parsePib(raw) {
  const t = cleanPib(raw);
  const start = t.indexOf('ESAA - SWEDEN FIR AERODROMES');
  if (start < 0) return {};
  let body = t.slice(start + 'ESAA - SWEDEN FIR AERODROMES'.length);
  const end = body.search(/\bEN-ROUTE\b/);
  if (end > 0) body = body.slice(0, end);
  const out = {};
  const secRe = /(?:^|\s)(ES[A-Z]{2}) - ([A-Z0-9\/ .()-]+?)(?= [+*] | SNOWTAM | No information received)/g;
  const heads = [...body.matchAll(secRe)];
  heads.forEach((h, i) => {
    const icao = h[1];
    const from = h.index + h[0].length;
    const to = i + 1 < heads.length ? heads[i + 1].index : body.length;
    let sec = body.slice(from, to).trim();
    const rec = { name: h[2].trim(), notams: [] };
    if (/^No information received/.test(sec)) { out[icao] = out[icao] ?? rec; return; }
    const sm = sec.match(SNOW);
    if (sm) {
      rec.snowtam = { issued: sm[1], text: sec.slice(sm.index + sm[0].length).trim() };
      sec = sec.slice(0, sm.index);
    }
    for (const part of sec.split(/(?:^|\s)[+*] /)) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(TERM);
      if (!m) { if (rec.notams.length) rec.notams[rec.notams.length - 1].text += ' ' + p; else rec.notams.push({ text: p }); continue; }
      const n = { text: p.slice(0, m.index).trim(), from: m[1], to: m[2] ?? null, est: !!m[3] };
      const rest = p.slice(m.index + m[0].length).trim();
      if (rest) n.sched = rest.replace(/^SCHEDULE:\s*/, '');
      rec.notams.push(n);
    }
    // Samma flygplats kan dyka upp två gånger runt en sidbrytning: slå ihop
    if (out[icao]) { out[icao].notams.push(...rec.notams); if (rec.snowtam) out[icao].snowtam = rec.snowtam; }
    else out[icao] = rec;
  });
  return out;
}

/** "Date: 20 NOV 2026 Time: UTC18:00" → ISO */
export function pibIssued(raw) {
  const m = raw.match(/Date: (\d{2}) ([A-Z]{3}) (\d{4}) Time: UTC(\d{2}):(\d{2})/);
  if (!m) return null;
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2]);
  if (mon < 0) return null;
  return new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5])).toISOString();
}
