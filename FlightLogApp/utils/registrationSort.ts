// Ordningen på registreringar i listor: bokstavsdelen först, sedan numret (KILO9 före KILO10).
// Ett O intill en siffra räknas som en nolla i jämförelsen. KIL026 (nolla) och KILO26 (bokstaven O) ser
// likadana ut i listan men sorterades förut i var sin grupp ("KIL" + 026 före "KILO" + 21), så att listan såg
// osorterad ut. Nu hamnar de bredvid varandra, nollan först. Värdena själva ändras aldrig.
const sortKey = (reg: string) =>
  reg.trim().toUpperCase().replace(/O(?=\d)/g, '0').replace(/(\d)O/g, (_m, d: string) => `${d}0`);

export function compareRegistrations(a: string, b: string): number {
  return sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true, sensitivity: 'base' })
    || (a < b ? -1 : a > b ? 1 : 0);
}
