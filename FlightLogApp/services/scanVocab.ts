// ScanVocab — kända värden härledda tyst från användarens egen data. Används av
// scanValidate för att snappa OCR-läsningar till rätt flotta/flygplats/typ
// (löser t.ex. KILO22 vs KILO27 där bläcket är genuint tvetydigt). Ersätter
// scan-profilens manuella listor — ingen användarinput krävs.

import { getDatabase } from '../db/database';

export interface ScanVocab {
  fleet: string[];          // kända registreringar
  aircraftTypes: string[];  // kända flygplanstyper
  frequentIcaos: string[];  // vanligaste flygplatser (mest använda först)
}

export async function buildScanVocab(): Promise<ScanVocab> {
  const db = await getDatabase();

  const regs = await db.getAllAsync<{ v: string }>(
    `SELECT DISTINCT registration v FROM aircraft_registry WHERE registration <> ''
     UNION SELECT DISTINCT registration v FROM flights WHERE registration <> ''`,
  );
  const types = await db.getAllAsync<{ v: string }>(
    `SELECT DISTINCT aircraft_type v FROM aircraft_registry WHERE aircraft_type <> ''
     UNION SELECT DISTINCT aircraft_type v FROM flights WHERE aircraft_type <> ''`,
  );
  const icaos = await db.getAllAsync<{ v: string }>(
    `SELECT v FROM (
        SELECT dep_place v FROM flights WHERE dep_place <> ''
        UNION ALL SELECT arr_place v FROM flights WHERE arr_place <> ''
     ) GROUP BY v ORDER BY COUNT(*) DESC LIMIT 80`,
  );

  return {
    fleet: regs.map((r) => r.v).filter(Boolean),
    aircraftTypes: types.map((r) => r.v).filter(Boolean),
    frequentIcaos: icaos.map((r) => r.v).filter(Boolean),
  };
}
