// Fotokredit för Fleet-bilder från Wikipedia/Wikimedia Commons. CC BY/BY-SA kräver upphovsperson, licens och
// källa → visas på Fleet-kortet (tryck = filens sida med licenslänk). Lagras som JSON i kolumnen image_credit
// (aircraft_registry/drone_registry); tom sträng = egen bild ur biblioteket (ingen kredit behövs).
export interface PhotoCredit { text: string; url: string }

export function serializeCredit(c: PhotoCredit | null | undefined): string {
  return c && c.text ? JSON.stringify({ text: c.text, url: c.url || '' }) : '';
}

export function parseCredit(s: string | null | undefined): PhotoCredit | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o.text === 'string' && o.text ? { text: o.text, url: typeof o.url === 'string' ? o.url : '' } : null;
  } catch {
    return null;
  }
}
