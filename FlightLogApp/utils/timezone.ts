// Lokal tid + tidszons-förkortning (CET/CEST, PST/PDT …) för en flygplats.
// Vi saknar tidszon i flygplatsdatan, så vi mappar land (ISO2) → IANA-zon, och
// region (ISO 3166-2) → IANA för multi-zon-länder (US/CA/AU). Intl formaterar
// sedan tiden DST-korrekt. Saknas zon eller Intl-stöd → reserv "HH:MM UTC±N".

import { isValidTime } from './format';

// Multi-zon: nyckel = "<LAND>-<REGION>" (ISO 3166-2), som i flygplatsdatan.
const REGION_TZ: Record<string, string> = {
  // USA
  'US-AL': 'America/Chicago', 'US-AK': 'America/Anchorage', 'US-AZ': 'America/Phoenix',
  'US-AR': 'America/Chicago', 'US-CA': 'America/Los_Angeles', 'US-CO': 'America/Denver',
  'US-CT': 'America/New_York', 'US-DE': 'America/New_York', 'US-DC': 'America/New_York',
  'US-FL': 'America/New_York', 'US-GA': 'America/New_York', 'US-HI': 'Pacific/Honolulu',
  'US-ID': 'America/Boise', 'US-IL': 'America/Chicago', 'US-IN': 'America/Indiana/Indianapolis',
  'US-IA': 'America/Chicago', 'US-KS': 'America/Chicago', 'US-KY': 'America/New_York',
  'US-LA': 'America/Chicago', 'US-ME': 'America/New_York', 'US-MD': 'America/New_York',
  'US-MA': 'America/New_York', 'US-MI': 'America/Detroit', 'US-MN': 'America/Chicago',
  'US-MS': 'America/Chicago', 'US-MO': 'America/Chicago', 'US-MT': 'America/Denver',
  'US-NE': 'America/Chicago', 'US-NV': 'America/Los_Angeles', 'US-NH': 'America/New_York',
  'US-NJ': 'America/New_York', 'US-NM': 'America/Denver', 'US-NY': 'America/New_York',
  'US-NC': 'America/New_York', 'US-ND': 'America/Chicago', 'US-OH': 'America/New_York',
  'US-OK': 'America/Chicago', 'US-OR': 'America/Los_Angeles', 'US-PA': 'America/New_York',
  'US-RI': 'America/New_York', 'US-SC': 'America/New_York', 'US-SD': 'America/Chicago',
  'US-TN': 'America/Chicago', 'US-TX': 'America/Chicago', 'US-UT': 'America/Denver',
  'US-VT': 'America/New_York', 'US-VA': 'America/New_York', 'US-WA': 'America/Los_Angeles',
  'US-WV': 'America/New_York', 'US-WI': 'America/Chicago', 'US-WY': 'America/Denver',
  // Kanada
  'CA-AB': 'America/Edmonton', 'CA-BC': 'America/Vancouver', 'CA-MB': 'America/Winnipeg',
  'CA-NB': 'America/Moncton', 'CA-NL': 'America/St_Johns', 'CA-NT': 'America/Yellowknife',
  'CA-NS': 'America/Halifax', 'CA-NU': 'America/Iqaluit', 'CA-ON': 'America/Toronto',
  'CA-PE': 'America/Halifax', 'CA-QC': 'America/Toronto', 'CA-SK': 'America/Regina',
  'CA-YT': 'America/Whitehorse',
  // Australien
  'AU-ACT': 'Australia/Sydney', 'AU-NSW': 'Australia/Sydney', 'AU-NT': 'Australia/Darwin',
  'AU-QLD': 'Australia/Brisbane', 'AU-SA': 'Australia/Adelaide', 'AU-TAS': 'Australia/Hobart',
  'AU-VIC': 'Australia/Melbourne', 'AU-WA': 'Australia/Perth',
};

// Land (ISO2) → IANA för länder med en (dominant) tidszon.
const SINGLE_TZ: Record<string, string> = {
  // Europa
  AD: 'Europe/Andorra', AL: 'Europe/Tirane', AT: 'Europe/Vienna', AX: 'Europe/Mariehamn',
  BA: 'Europe/Sarajevo', BE: 'Europe/Brussels', BG: 'Europe/Sofia', BY: 'Europe/Minsk',
  CH: 'Europe/Zurich', CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen', EE: 'Europe/Tallinn', ES: 'Europe/Madrid', FI: 'Europe/Helsinki',
  FO: 'Atlantic/Faroe', FR: 'Europe/Paris', GB: 'Europe/London', GG: 'Europe/Guernsey',
  GI: 'Europe/Gibraltar', GR: 'Europe/Athens', HR: 'Europe/Zagreb', HU: 'Europe/Budapest',
  IE: 'Europe/Dublin', IM: 'Europe/Isle_of_Man', IS: 'Atlantic/Reykjavik', IT: 'Europe/Rome',
  JE: 'Europe/Jersey', LI: 'Europe/Vaduz', LT: 'Europe/Vilnius', LU: 'Europe/Luxembourg',
  LV: 'Europe/Riga', MC: 'Europe/Monaco', MD: 'Europe/Chisinau', ME: 'Europe/Podgorica',
  MK: 'Europe/Skopje', MT: 'Europe/Malta', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo',
  PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', RO: 'Europe/Bucharest', RS: 'Europe/Belgrade',
  SE: 'Europe/Stockholm', SI: 'Europe/Ljubljana', SK: 'Europe/Bratislava', SM: 'Europe/San_Marino',
  TR: 'Europe/Istanbul', UA: 'Europe/Kyiv', VA: 'Europe/Vatican', XK: 'Europe/Belgrade',
  // Övriga vanliga (en zon)
  AE: 'Asia/Dubai', AF: 'Asia/Kabul', AM: 'Asia/Yerevan', AZ: 'Asia/Baku', BD: 'Asia/Dhaka',
  BH: 'Asia/Bahrain', BN: 'Asia/Brunei', BT: 'Asia/Thimphu', EG: 'Africa/Cairo',
  ET: 'Africa/Addis_Ababa', GE: 'Asia/Tbilisi', GH: 'Africa/Accra', HK: 'Asia/Hong_Kong',
  IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata', IQ: 'Asia/Baghdad', IR: 'Asia/Tehran',
  JO: 'Asia/Amman', JP: 'Asia/Tokyo', KE: 'Africa/Nairobi', KH: 'Asia/Phnom_Penh',
  KR: 'Asia/Seoul', KW: 'Asia/Kuwait', LB: 'Asia/Beirut', LK: 'Asia/Colombo', MA: 'Africa/Casablanca',
  MO: 'Asia/Macau', MM: 'Asia/Yangon', MV: 'Indian/Maldives', MY: 'Asia/Kuala_Lumpur',
  NG: 'Africa/Lagos', NP: 'Asia/Kathmandu', NZ: 'Pacific/Auckland', OM: 'Asia/Muscat',
  PH: 'Asia/Manila', PK: 'Asia/Karachi', QA: 'Asia/Qatar', SA: 'Asia/Riyadh', SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok', TN: 'Africa/Tunis', TW: 'Asia/Taipei', TZ: 'Africa/Dar_es_Salaam',
  UG: 'Africa/Kampala', UZ: 'Asia/Tashkent', VN: 'Asia/Ho_Chi_Minh', ZA: 'Africa/Johannesburg',
  ZW: 'Africa/Harare', SY: 'Asia/Damascus', YE: 'Asia/Aden', LY: 'Africa/Tripoli',
  DZ: 'Africa/Algiers', AO: 'Africa/Luanda', SN: 'Africa/Dakar', CI: 'Africa/Abidjan',
};

function ianaFor(country?: string, region?: string): string | null {
  const r = (region || '').toUpperCase();
  if (REGION_TZ[r]) return REGION_TZ[r];
  const c = (country || '').toUpperCase();
  return SINGLE_TZ[c] ?? null;
}

// IANA-zon → [standard, sommartid] förkortning. Saknas → visa UTC±N istället.
const ABBR: Record<string, [string, string]> = {
  // CET / CEST
  'Europe/Andorra': ['CET', 'CEST'], 'Europe/Tirane': ['CET', 'CEST'], 'Europe/Vienna': ['CET', 'CEST'],
  'Europe/Sarajevo': ['CET', 'CEST'], 'Europe/Brussels': ['CET', 'CEST'], 'Europe/Zurich': ['CET', 'CEST'],
  'Europe/Prague': ['CET', 'CEST'], 'Europe/Berlin': ['CET', 'CEST'], 'Europe/Copenhagen': ['CET', 'CEST'],
  'Europe/Madrid': ['CET', 'CEST'], 'Europe/Paris': ['CET', 'CEST'], 'Europe/Gibraltar': ['CET', 'CEST'],
  'Europe/Zagreb': ['CET', 'CEST'], 'Europe/Budapest': ['CET', 'CEST'], 'Europe/Rome': ['CET', 'CEST'],
  'Europe/Vaduz': ['CET', 'CEST'], 'Europe/Luxembourg': ['CET', 'CEST'], 'Europe/Monaco': ['CET', 'CEST'],
  'Europe/Podgorica': ['CET', 'CEST'], 'Europe/Skopje': ['CET', 'CEST'], 'Europe/Malta': ['CET', 'CEST'],
  'Europe/Amsterdam': ['CET', 'CEST'], 'Europe/Oslo': ['CET', 'CEST'], 'Europe/Warsaw': ['CET', 'CEST'],
  'Europe/Belgrade': ['CET', 'CEST'], 'Europe/Stockholm': ['CET', 'CEST'], 'Europe/Ljubljana': ['CET', 'CEST'],
  'Europe/Bratislava': ['CET', 'CEST'], 'Europe/San_Marino': ['CET', 'CEST'], 'Europe/Vatican': ['CET', 'CEST'],
  // EET / EEST
  'Europe/Sofia': ['EET', 'EEST'], 'Asia/Nicosia': ['EET', 'EEST'], 'Europe/Tallinn': ['EET', 'EEST'],
  'Europe/Helsinki': ['EET', 'EEST'], 'Europe/Mariehamn': ['EET', 'EEST'], 'Europe/Athens': ['EET', 'EEST'],
  'Europe/Riga': ['EET', 'EEST'], 'Europe/Chisinau': ['EET', 'EEST'], 'Europe/Bucharest': ['EET', 'EEST'],
  'Europe/Vilnius': ['EET', 'EEST'], 'Europe/Kyiv': ['EET', 'EEST'],
  // GMT/BST · WET/WEST
  'Europe/London': ['GMT', 'BST'], 'Europe/Guernsey': ['GMT', 'BST'], 'Europe/Isle_of_Man': ['GMT', 'BST'],
  'Europe/Jersey': ['GMT', 'BST'], 'Europe/Dublin': ['GMT', 'IST'],
  'Europe/Lisbon': ['WET', 'WEST'], 'Atlantic/Faroe': ['WET', 'WEST'], 'Atlantic/Reykjavik': ['GMT', 'GMT'],
  // Nordamerika
  'America/New_York': ['EST', 'EDT'], 'America/Detroit': ['EST', 'EDT'], 'America/Indiana/Indianapolis': ['EST', 'EDT'],
  'America/Toronto': ['EST', 'EDT'], 'America/Iqaluit': ['EST', 'EDT'], 'America/Chicago': ['CST', 'CDT'],
  'America/Winnipeg': ['CST', 'CDT'], 'America/Regina': ['CST', 'CST'], 'America/Denver': ['MST', 'MDT'],
  'America/Boise': ['MST', 'MDT'], 'America/Edmonton': ['MST', 'MDT'], 'America/Yellowknife': ['MST', 'MDT'],
  'America/Phoenix': ['MST', 'MST'], 'America/Whitehorse': ['MST', 'MST'], 'America/Los_Angeles': ['PST', 'PDT'],
  'America/Vancouver': ['PST', 'PDT'], 'America/Anchorage': ['AKST', 'AKDT'], 'Pacific/Honolulu': ['HST', 'HST'],
  'America/Halifax': ['AST', 'ADT'], 'America/Moncton': ['AST', 'ADT'], 'America/St_Johns': ['NST', 'NDT'],
  // Australien
  'Australia/Sydney': ['AEST', 'AEDT'], 'Australia/Melbourne': ['AEST', 'AEDT'], 'Australia/Hobart': ['AEST', 'AEDT'],
  'Australia/Brisbane': ['AEST', 'AEST'], 'Australia/Darwin': ['ACST', 'ACST'], 'Australia/Adelaide': ['ACST', 'ACDT'],
  'Australia/Perth': ['AWST', 'AWST'],
  // Asien (utan DST)
  'Asia/Tokyo': ['JST', 'JST'], 'Asia/Seoul': ['KST', 'KST'], 'Asia/Kolkata': ['IST', 'IST'],
  'Asia/Hong_Kong': ['HKT', 'HKT'], 'Asia/Bangkok': ['ICT', 'ICT'],
};

const INTL_TZ_OK: boolean = (() => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Stockholm' }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
})();

// Zonens UTC-offset (minuter) vid en tidpunkt — wall-clock-diff (robust, ingen
// 'longOffset' krävs). Funkar så länge Intl kan formatera datum i en tidszon.
function offsetMinutes(iana: string, date: Date): number | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value ?? '0', 10);
    const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

function fmtOffset(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return m ? `UTC${sign}${h}:${String(m).padStart(2, '0')}` : `UTC${sign}${h}`;
}

function localHM(iana: string, date: Date): string | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    const hh = p.find((x) => x.type === 'hour')?.value;
    const mm = p.find((x) => x.type === 'minute')?.value;
    if (hh != null && mm != null) return `${hh === '24' ? '00' : hh}:${mm}`;
  } catch { /* faller igenom */ }
  return null;
}

// Förkortning för en zon vid en tidpunkt (DST avgörs av offset vs standardtid).
function resolveAbbr(iana: string, instant: Date): string | null {
  const pair = ABBR[iana];
  const cur = offsetMinutes(iana, instant);
  if (!pair) return cur != null ? fmtOffset(cur) : null;
  const [std, dst] = pair;
  if (std === dst) return std;
  const jan = offsetMinutes(iana, new Date(Date.UTC(instant.getUTCFullYear(), 0, 15)));
  const jul = offsetMinutes(iana, new Date(Date.UTC(instant.getUTCFullYear(), 6, 15)));
  if (cur != null && jan != null && jul != null) {
    const stdOff = Math.min(jan, jul); // DST = större offset
    return cur > stdOff ? dst : std;
  }
  return std;
}

function mkUtc(dateStr: string, hhmm: string): Date | null {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  if (!y || !mo || !da) return null;
  return new Date(Date.UTC(y, mo - 1, da, h, m, 0));
}

// Förkortning/offset-namn för en plats (utan tid): "CEST", "PST", "UTC+4" …
export function tzAbbr(instant: Date, country?: string, region?: string, lon?: number | null): string | null {
  const iana = ianaFor(country, region);
  if (iana && INTL_TZ_OK) { const a = resolveAbbr(iana, instant); if (a) return a; }
  if (lon == null || !isFinite(lon)) return null;
  const offH = Math.round(lon / 15);
  return `UTC${offH >= 0 ? '+' : ''}${offH}`;
}

// UTC-tidpunkt → lokal "HH:MM".
export function utcToLocalHHMM(instant: Date, country?: string, region?: string, lon?: number | null): string | null {
  const iana = ianaFor(country, region);
  if (iana && INTL_TZ_OK) { const hm = localHM(iana, instant); if (hm) return hm; }
  if (lon == null || !isFinite(lon)) return null;
  const offH = Math.round(lon / 15);
  const d = new Date(instant.getTime() + offH * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Lokal "HH:MM" (på datum dateStr) → UTC "HH:MM".
export function localToUtcHHMM(dateStr: string, localHHMM: string, country?: string, region?: string, lon?: number | null): string | null {
  if (!dateStr || !isValidTime(localHHMM)) return null;
  const approx = mkUtc(dateStr, localHHMM); // lokal tid tolkad som UTC → för offset
  if (!approx) return null;
  const iana = ianaFor(country, region);
  let offMin: number | null = null;
  if (iana && INTL_TZ_OK) offMin = offsetMinutes(iana, approx);
  if (offMin == null) {
    if (lon == null || !isFinite(lon)) return null;
    offMin = Math.round(lon / 15) * 60;
  }
  const utc = new Date(approx.getTime() - offMin * 60000);
  return `${String(utc.getUTCHours()).padStart(2, '0')}:${String(utc.getUTCMinutes()).padStart(2, '0')}`;
}

// "HH:MM CET" — lokal tid + förkortning (UTC-läge: visas under fältet).
export function localLabel(instant: Date, country?: string, region?: string, lon?: number | null): string | null {
  const iana = ianaFor(country, region);
  if (iana && INTL_TZ_OK) {
    const hm = localHM(iana, instant);
    if (hm) { const a = resolveAbbr(iana, instant); return a ? `${hm} ${a}` : hm; }
  }
  if (lon == null || !isFinite(lon)) return null;
  const offH = Math.round(lon / 15);
  const d = new Date(instant.getTime() + offH * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC${offH >= 0 ? '+' : ''}${offH}`;
}
