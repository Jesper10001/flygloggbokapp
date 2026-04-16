import { useTimeFormatStore, type TimeFormat } from '../store/timeFormatStore';

/** Konverterar decimal till HH:MM — används alltid på dashboard */
export function decimalToHHMM(decimal: number): string {
  if (!decimal || isNaN(decimal)) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Konverterar HH:MM-sträng till decimal */
export function hhmmToDecimal(str: string): number {
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return Math.round((h + m / 60) * 10) / 10;
}

/** Decimaltimmar → MM:SS (för drönartid där flygpass är korta) */
export function decimalToMMSS(decimal: number): string {
  if (!decimal || isNaN(decimal)) return '00:00';
  const totalSec = Math.round(decimal * 3600);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** MM:SS-sträng → decimaltimmar */
export function mmssToDecimal(str: string): number {
  const [mm, ss] = str.split(':').map(Number);
  if (isNaN(mm) || isNaN(ss)) return 0;
  return (mm * 60 + ss) / 3600;
}

/** Parsar en tids-sträng (decimal ELLER HH:MM) till decimal */
export function parseTimeInput(str: string, format: TimeFormat): number | null {
  if (!str || str.trim() === '') return 0;
  if (format === 'hhmm') {
    if (!/^\d+:[0-5]\d$/.test(str.trim())) return null;
    return hhmmToDecimal(str.trim());
  }
  // decimal
  const n = parseFloat(str.replace(',', '.'));
  if (isNaN(n)) return null;
  return Math.round(n * 10) / 10; // max 1 decimal
}

/** Validerar inmatning — returnerar true om giltig */
export function validateTimeInput(str: string, format: TimeFormat): boolean {
  if (!str || str === '0') return true;
  if (format === 'hhmm') return /^\d+:[0-5]\d$/.test(str.trim());
  return /^\d+(\.\d)?$/.test(str.trim());
}

/** Formaterar en decimal för visning enligt inställning */
export function formatTimeValue(decimal: number, format: TimeFormat): string {
  if (!decimal || isNaN(decimal)) return format === 'hhmm' ? '0:00' : '0';
  if (format === 'hhmm') return decimalToHHMM(decimal);
  return String(Math.round(decimal * 10) / 10);
}

/** Hook — returnerar hjälpfunktioner bundna till användarens inställning */
export function useTimeFormat() {
  const { timeFormat, setTimeFormat } = useTimeFormatStore();

  return {
    timeFormat,
    setTimeFormat,
    /** Formaterar för visning i formulär/listor */
    formatTime: (decimal: number) => formatTimeValue(decimal, timeFormat),
    /** Formaterar ALLTID som HH:MM — används på dashboard */
    formatDashboard: decimalToHHMM,
    /** Parsar input-sträng → decimal (null = ogiltigt format) */
    parseTime: (str: string) => parseTimeInput(str, timeFormat),
    /** Validerar att strängen matchar valt format */
    validateTime: (str: string) => validateTimeInput(str, timeFormat),
    /** Rätt keyboardType per format */
    keyboardType: timeFormat === 'decimal' ? 'decimal-pad' : ('numbers-and-punctuation' as const),
    /** Placeholder per format */
    placeholder: timeFormat === 'decimal' ? '0.0' : '0:00',
  };
}
