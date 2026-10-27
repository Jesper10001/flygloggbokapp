// Foton från Wikipedia/Wikimedia Commons till Fleet-korten — ALLTID med kredit (upphovsperson + licens + länk).
// Bara fria licenser som tillåter kommersiell användning släpps igenom: public domain, CC0, CC BY och CC BY-SA.
// En bild utan godkänd licens (t.ex. GFDL-only eller okänd) används inte alls. Gratis API, ingen AI.
import type { PhotoCredit } from '../utils/photoCredit';

// Wikimedias API-regler: meningsfull User-Agent MED kontaktuppgift — annars räknas anropen som oidentifierade
// (10 anrop/min per IP i stället för 200) och bildhämtningen efter en import slår i 429.
const AGENT = 'Blades/1.0 (https://blades-app.com; support@blades-app.com)';
export const WIKI_HEADERS = { 'User-Agent': AGENT, 'Api-User-Agent': AGENT };
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const META = 'Artist|Credit|LicenseShortName';
const IMG_MIME = /jpe?g|png|webp/i;

export interface WikiPhoto { url: string; credit: PhotoCredit }

const stripHtml = (s: string) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

// Commons LicenseShortName-värden som godkänns. Allt annat → bilden används inte.
const FREE_LICENSE = /^(public domain|pd\b|pd-|cc0|cc[- ]zero|no restrictions|copyrighted free use|attribution\b|cc[- ]by(-sa)?[- ]\d(\.\d)?)/i;
const PD_LICENSE = /^(public domain|pd\b|pd-|cc0|cc[- ]zero|no restrictions)/i;

export function isFreeLicense(name: string): boolean {
  return FREE_LICENSE.test(name.trim());
}

/** Kredit ur ett imageinfo-objekt (extmetadata), eller null om licensen inte är godkänd. */
export function creditFromImageInfo(ii: any): PhotoCredit | null {
  const meta = ii?.extmetadata ?? {};
  const license = stripHtml(String(meta.LicenseShortName?.value ?? ''));
  if (!license || !isFreeLicense(license)) return null;
  let author = stripHtml(String(meta.Artist?.value ?? '')) || stripHtml(String(meta.Credit?.value ?? ''));
  if (author.length > 60) author = author.slice(0, 57).trimEnd() + '…';
  const lic = PD_LICENSE.test(license) ? 'Public domain' : license;
  const text = author ? `Photo: ${author} · ${lic} · Wikimedia Commons` : `Photo: Wikimedia Commons · ${lic}`;
  const d = typeof ii?.descriptionurl === 'string' ? ii.descriptionurl : '';
  return { text, url: d.startsWith('//') ? 'https:' + d : d };
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: WIKI_HEADERS });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** imageinfo (url + 900 px-tumnagel + licensdata) för en fil. Wikipedias API svarar även för Commons-filer. */
async function fileImageInfo(fileName: string, api = WIKI_API): Promise<any | null> {
  const data = await getJson(`${api}?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiextmetadatafilter=${encodeURIComponent(META)}&iiurlwidth=900&titles=${encodeURIComponent('File:' + fileName)}`);
  const pages = data?.query?.pages;
  if (!pages) return null;
  // Commons-fil sedd från Wikipedia: sidan är "missing" lokalt men imageinfo finns (imagerepository: shared).
  const p: any = Object.values(pages)[0];
  return p?.imageinfo?.[0] ?? null;
}

function photoFromImageInfo(ii: any): WikiPhoto | null {
  if (!ii) return null;
  if (ii.mime && !IMG_MIME.test(ii.mime)) return null;
  const url = ii.thumburl || ii.url;
  const credit = creditFromImageInfo(ii);
  return typeof url === 'string' && url && credit ? { url, credit } : null;
}

/** Ledbilden i en Wikipedia-artikel (direkt titel). pilicense=free → aldrig fair use-bilder. */
export async function wikiPagePhoto(title: string): Promise<WikiPhoto | null> {
  const t = title.trim();
  if (!t) return null;
  const data = await getJson(`${WIKI_API}?action=query&format=json&prop=pageimages&piprop=name&pilicense=free&redirects=1&titles=${encodeURIComponent(t)}`);
  const pages = data?.query?.pages;
  if (!pages) return null;
  for (const p of Object.values(pages) as any[]) {
    if (typeof p?.pageimage !== 'string' || !p.pageimage) continue;
    const photo = photoFromImageInfo(await fileImageInfo(p.pageimage));
    if (photo) return photo;
  }
  return null;
}

/** Wikipedia-SÖK (ungefärlig titel) → ledbilden i bästa träffen som har en fri bild. */
export async function wikiSearchPhoto(query: string): Promise<WikiPhoto | null> {
  const q = query.trim();
  if (!q) return null;
  const data = await getJson(`${WIKI_API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=pageimages&piprop=name&pilicense=free&redirects=1`);
  const pages = data?.query?.pages;
  if (!pages) return null;
  const arr = (Object.values(pages) as any[]).sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  for (const p of arr) {
    if (typeof p?.pageimage !== 'string' || !p.pageimage) continue;
    const photo = photoFromImageInfo(await fileImageInfo(p.pageimage));
    if (photo) return photo;
  }
  return null;
}

/** Wikimedia Commons fil-sök (bredast — t.ex. drönarmodeller utan egen artikel). Första riktiga foto med fri licens. */
export async function commonsSearchPhoto(query: string): Promise<WikiPhoto | null> {
  const q = query.trim();
  if (!q) return null;
  const data = await getJson(`${COMMONS_API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiextmetadatafilter=${encodeURIComponent(META)}&iiurlwidth=900`);
  const pages = data?.query?.pages;
  if (!pages) return null;
  const arr = (Object.values(pages) as any[]).sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  for (const p of arr) {
    const photo = photoFromImageInfo(p?.imageinfo?.[0]);
    if (photo) return photo;
  }
  return null;
}

/** Värdar för Wikimedia-bilder: upload (original + äldre tumnaglar) och thumb (tumnaglar sedan 2026). */
export const WIKI_IMAGE_URL_PREFIXES = ['https://upload.wikimedia.org/', 'https://thumb.wikimedia.org/'];

/** Filnamn + rätt API ur en Wikimedia-bild-URL (original eller tumnagel). null = inte en Wikimedia-bild. */
export function wikiFileFromUrl(u: string): { name: string; api: string } | null {
  const m = u.match(/^https?:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i);
  if (!m) return null;
  let name = m[2];
  try { name = decodeURIComponent(name); } catch { /* behåll som den är */ }
  return { name, api: m[1] === 'commons' ? COMMONS_API : `https://${m[1]}.wikipedia.org/w/api.php` };
}

export type CreditLookup =
  | { status: 'ok'; credit: PhotoCredit }
  | { status: 'unfree' }      // ingen godkänd licens eller filen finns inte längre → använd inte bilden
  | { status: 'error' };      // nätfel → försök igen senare

/** Kredit för en redan sparad Wikimedia-bild (ifyllnad för bilder som sparades innan krediten fanns). */
export async function creditForWikiUrl(u: string): Promise<CreditLookup> {
  const f = wikiFileFromUrl(u);
  if (!f) return { status: 'error' }; // okänt URL-format → rör inte bilden (hellre ingen åtgärd än en felaktig radering)
  const data = await getJson(`${f.api}?action=query&format=json&redirects=1&prop=imageinfo&iiprop=url%7Cextmetadata&iiextmetadatafilter=${encodeURIComponent(META)}&titles=${encodeURIComponent('File:' + f.name)}`);
  const pages = data?.query?.pages;
  if (!pages) return { status: 'error' };
  const p: any = Object.values(pages)[0];
  const ii = p?.imageinfo?.[0];
  if (!ii) return { status: 'unfree' };
  const credit = creditFromImageInfo(ii);
  return credit ? { status: 'ok', credit } : { status: 'unfree' };
}
