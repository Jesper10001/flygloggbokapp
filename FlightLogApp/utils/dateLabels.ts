// Localized month / weekday labels for sv + en (used by milestone views).
export type DateLang = 'en' | 'sv';

const MONTHS_SHORT: Record<DateLang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sv: ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'],
};
const MONTHS_LONG: Record<DateLang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sv: ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'],
};
// index 0 = Sunday (matches JS Date.getDay())
const DOW_SHORT: Record<DateLang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  sv: ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'],
};

const lang = (l: string): DateLang => (l === 'sv' ? 'sv' : 'en');

export const monthShort = (l: string, monthIdx0: number) => MONTHS_SHORT[lang(l)][monthIdx0] ?? '';
export const monthLong = (l: string, monthIdx0: number) => MONTHS_LONG[lang(l)][monthIdx0] ?? '';
export const dowShort = (l: string, jsDay: number) => DOW_SHORT[lang(l)][jsDay] ?? '';
