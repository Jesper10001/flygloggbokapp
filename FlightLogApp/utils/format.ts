// Formatera decimaltal till "1h 30min" eller "1.5h"
export function formatHours(hours: number): string {
  if (!hours || isNaN(hours)) return '0.0';
  return hours.toFixed(1);
}

// Formatera datum till "2024-03-15"
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('sv-SE');
  } catch {
    return dateStr;
  }
}

// Konvertera flygtid — accepterar decimal (1.5) eller HH:MM (1:30)
export function parseFlightTime(value: string): number {
  const v = (value ?? '').trim();
  if (!v) return 0;
  if (v.includes(':')) {
    const [h, m] = v.split(':').map(Number);
    if (isNaN(h)) return 0;
    return Math.round((h + (m || 0) / 60) * 100) / 100;
  }
  return parseFloat(v) || 0;
}

// Validera tidformat HH:MM
export function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t) && (() => {
    const [h, m] = t.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  })();
}

// Beräkna flygtid från avg/arr-tid
export function calcFlightTime(dep: string, arr: string): number {
  if (!isValidTime(dep) || !isValidTime(arr)) return 0;
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  let depMins = dh * 60 + dm;
  let arrMins = ah * 60 + am;
  if (arrMins < depMins) arrMins += 24 * 60; // midnatt-övergång
  return Math.round((arrMins - depMins) / 6) / 10; // decimaltimmar, 1 decimal
}

// Validera ICAO-kod
export function isValidIcao(icao: string): boolean {
  return /^[A-Z]{4}$/.test(icao.toUpperCase());
}

// Formatera registreringsnummer
export function formatRegistration(reg: string): string {
  return reg.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}
