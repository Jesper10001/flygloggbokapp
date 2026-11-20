// Modellfamilj för en flygplanstyp i OSINT-lagret (Specific → Types): varianter slås ihop till en familj, t.ex.
// "Su-30SM2" → "Su-30", "C-130J Hercules" → "C-130", "Bell 412EP" → "Bell 412", "Mirage 2000-5" → "Mirage 2000".
// Används av build-osint-layer.mjs (lagret får typ → familj) och fetch-type-descriptions.mjs.
const MAKERS = /^(Pakistan Aeronautical Complex|Leonardo-Finmeccanica|de Havilland Canada|Airbus Helicopters|McDonnell Douglas|British Aerospace|Hawker Beechcraft|Northrop Grumman|General Atomics|Korea Aerospace|Lockheed Martin|Britten-Norman|AgustaWestland|Aérospatiale|Sud Aviation|Aerospatiale|de Havilland|Bell Boeing|Agusta-Bell|BAE Systems|Mitsubishi|Beechcraft|Eurocopter|Bombardier|Gulfstream|Bayraktar|ShinMaywa|Aermacchi|EADS CASA|Hindustan|Nanchang|Dassault|Shenyang|Yakovlev|Westland|Leonardo|Sikorsky|Kawasaki|Northrop|Ilyushin|Lockheed|Diamond|Antonov|Textron|Learjet|Grumman|Embraer|Pilatus|Chengdu|Tupolev|Mikoyan|Panavia|Shaanxi|CAVIM-|Hongdu|Airbus|Boeing|Shorts|Fokker|Sukhoi|Harbin|Baykar|Alenia|Agusta|Cirrus|Socata|Beech|Kamov|Atlas|Elbit|Piper|Daher|Short|Enaer|Denel|Kazan|ENAER|Xi'an|Xian|CASA|Aero|Utva|Grob|Fuji|Bell|AIDC|Saab|BAE|PAC|Mil|TAI|Let|IAI|PZL|KAI|HAL)\s+/;
const KEEP_MAKER = /^(Bell|Cessna|Boeing|Airbus|Falcon|Dassault Falcon|Learjet|Beechcraft|Gulfstream|Hawk|Mirage|Tornado|Alpha Jet|King Air|Super King Air|Grob|Diamond|Cirrus|Hermes|Heron|Searcher|Harbin|Xian|Wing Loong)\b/;

const GENERIC = /^(helicopters?|transport aircraft|attack aircraft|trainers?|liaison aircraft|drones?|uavs?|uas|[a-z])$/i;

/** Familjen, eller null för en allmän etikett ("trainers", "helicopters") som inte ska listas under Types. */
// Samma modell under olika namn → en familj
const ALIAS = [
  [/^(?:Agusta-Bell |Bell )?AB[ .-]?(\d{3})(?!\d)/i, 'Bell $1'], [/^(?:Hughes 500|500MD|MD[ -]?500)(?!\d)/i, 'MD 500'], [/^MD[ -]?530(?!\d)/i, 'MD 530'],
  [/^EH[ -]?101(?!\d)/i, 'AW101'], [/^(?:Airbus )?H125(?!\d)/, 'AS350'], [/^(?:Airbus )?H135(?!\d)/, 'EC135'], [/^(?:Airbus )?H145(?!\d)/, 'EC145'], [/^(?:Airbus )?H225(?!\d)/, 'EC225'],
  [/^Dornier (?:Do )?228(?!\d)/, 'Do 228'], [/^IL-/, 'Il-'], [/^Iak-/, 'Yak-'], [/^Zl[ií]n (?:Z-)?(\d{3})\w*/, 'Zlín Z-$1'], [/^(Kfir|Hawk|King Air|Typhoon|Lasta|Rafale|Alpha Jet|Super Lynx|Chinook|Merlin|Wildcat|Jupiter)\b.*$/, '$1'],
];

export function familyOf(type) {
  let t = String(type).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.split('/')[0].trim();
  for (const [rx, to] of ALIAS) if (rx.test(t)) { t = t.replace(rx, to); break; }
  t = t.replace(/^Beechcraft (?=(Super )?King Air|Premier)/, '').replace(/^Cessna (?=Citation)/, '');                       // "J-7/F-7" → "J-7", "MiG-19/J-6" → "MiG-19"
  t = t.replace(/^(Bell|Boeing|Airbus|Grob|Lockheed Martin|Lockheed|Sikorsky|Northrop|Dassault|Embraer|Martin) (?=[A-Z]{1,4}[- ]?\d)/, '');
  const keep = t.match(KEEP_MAKER);
  // Tillverkaren bort bara när en beteckning med bokstäver följer ("Sukhoi Su-35" → "Su-35"), inte före ett rent
  // nummer ("Saab 340", "Embraer 145", "Beechcraft 1900" behåller namnet)
  if (!keep) { const r = t.replace(MAKERS, ''); if (/^[A-Za-z]/.test(r)) t = r; }
  t = t.replace(/\bMk\.?\s*\d+\w*/gi, '').trim();    // "Hawk Mk 102" → "Hawk"
  // Beteckning: bokstäver + (bindestreck|mellanslag|inget) + siffror → familjen = prefix + nummer
  const m = t.match(/^((?:[A-Z][A-Za-z.]{0,11}\s)?[A-Z][A-Za-z]{0,4})([- ]?)(\d{1,4})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const n = t.match(/^([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)[ -]([A-Z]?\d{1,4})/); // "Mirage F1", "Mirage 2000"
  if (n) return `${n[1]} ${n[2]}`;
  // Utan nummer: varianttillägg bort ("Rafale DM" → "Rafale", "Kfir C.E" → "Kfir", "Tiger ARH" → "Tiger")
  let w = t.split(/,/)[0].trim().split(' ');
  while (w.length > 1 && /^([A-Z]{1,3}|[A-Z]\.[A-Z.]*|[IV]{1,3}|-)$/.test(w[w.length - 1])) w.pop();
  const f = w.join(' ').replace(/\s*-\s*$/, '');
  return !f || GENERIC.test(f) ? null : f;
}

/** Grupperingsnyckel: stavningsvarianter (G120, G-120, G 120) blir samma familj. */
export const familyKey = (f) => f.toUpperCase().replace(/[\s.-]/g, '');
