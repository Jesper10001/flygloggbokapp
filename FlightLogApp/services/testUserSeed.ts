import { getDatabase } from '../db/database';
import { addDrone, addCertificate, insertDroneFlight } from '../db/drones';
import { setSetting } from '../db/flights';

async function wipeDroneData() {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM drone_flights');
  await db.runAsync('DELETE FROM drone_registry');
  await db.runAsync('DELETE FROM drone_certificates');
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ── Test user 1: Professional inspection pilot ───────────────────────────────
export async function seedTestUser1() {
  await wipeDroneData();
  await setSetting('drone_operator_id', 'SWE-OP-8432');

  // Drönare
  const mavic3e = await addDrone({
    drone_type: 'multirotor',
    model: 'DJI Mavic 3 Enterprise',
    registration: 'SWE-RP-2241',
    mtow_g: 920,
    category: 'A2',
    notes: 'Primary inspection drone',
  });
  const matrice30 = await addDrone({
    drone_type: 'multirotor',
    model: 'DJI Matrice 30T',
    registration: 'SWE-RP-8877',
    mtow_g: 3770,
    category: 'Specific',
    notes: 'Thermal + zoom, powerline inspections',
  });
  const mini4 = await addDrone({
    drone_type: 'multirotor',
    model: 'DJI Mini 4 Pro',
    registration: 'SWE-RP-1102',
    mtow_g: 249,
    category: 'A1',
    notes: 'Recce / marketing content',
  });


  // Certifikat
  await addCertificate({
    cert_type: 'A1/A3', label: 'Transportstyrelsen online',
    issued_date: isoDaysAgo(380), expires_date: isoDaysFromNow(1445), notes: '',
  });
  await addCertificate({
    cert_type: 'A2', label: 'TFS exam 2024',
    issued_date: isoDaysAgo(310), expires_date: isoDaysFromNow(1515), notes: '',
  });
  await addCertificate({
    cert_type: 'STS-01', label: 'Uppsala STS-01',
    issued_date: isoDaysAgo(180), expires_date: isoDaysFromNow(45), notes: 'Förnyelse bokad',
  });
  await addCertificate({
    cert_type: 'Operational Authorization', label: 'OA-2024-087',
    issued_date: isoDaysAgo(120), expires_date: isoDaysFromNow(10), notes: 'Inspection above populated areas',
  });

  // Flygningar — ~95h total över 1 år, spread över drönare
  const plan: Array<{
    droneId: number; droneType: string; reg: string;
    days: number; time: number; loc: string; mission: string; cat: string; mode: 'VLOS'|'EVLOS'|'BVLOS';
    alt: number; night?: boolean; observer?: boolean;
  }> = [
    // Mavic 3E — inspektioner
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 340, time: 0.35, loc: 'Västerås solpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 80 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 335, time: 0.45, loc: 'Västerås solpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 85 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 320, time: 0.42, loc: 'Uppsala vindkraftverk', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 120 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 300, time: 0.5, loc: 'Arlanda hangar 7', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 45 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 280, time: 0.3, loc: 'Stockholm Stadion', mission: 'Photo / Video', cat: 'A2', mode: 'VLOS', alt: 60 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 260, time: 0.4, loc: 'Solna broinspektion', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 30 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 240, time: 0.48, loc: 'Linköping vattenverk', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 90 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 220, time: 0.35, loc: 'Örebro tak', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 25 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 200, time: 0.5, loc: 'Gävle hamnkran', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 70 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 170, time: 0.4, loc: 'Karlstad kraftledning', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 110 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 140, time: 0.45, loc: 'Sundsvall takinsp.', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 35 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 110, time: 0.6, loc: 'Umeå broinspektion', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 40 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 80, time: 0.35, loc: 'Malmö marknadsfilm', mission: 'Photo / Video', cat: 'A2', mode: 'VLOS', alt: 80 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 60, time: 0.4, loc: 'Halmstad vindpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 120 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', days: 30, time: 0.55, loc: 'Trollhättan turbininsp.', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 95 },

    // Matrice 30T — Specific, EVLOS/BVLOS
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 310, time: 0.7, loc: 'E4 kraftledning Uppland', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 150, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 290, time: 0.8, loc: 'Dalälven powerline', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 140, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 270, time: 0.85, loc: 'Sandviken kraftstation', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 130, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 250, time: 0.6, loc: 'Bollnäs skogsinventering', mission: 'Mapping', cat: 'Specific', mode: 'BVLOS', alt: 120, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 220, time: 0.75, loc: 'Ljusdal vindkraftpark', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 160, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 190, time: 0.9, loc: 'Sundsvall powerline', mission: 'Inspection', cat: 'Specific', mode: 'BVLOS', alt: 150, observer: true, night: false },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 160, time: 0.8, loc: 'Östersund skogsinv.', mission: 'Mapping', cat: 'Specific', mode: 'BVLOS', alt: 140, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 125, time: 0.7, loc: 'Gällivare kraftledning', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 155, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 95, time: 0.85, loc: 'Luleå hamn thermal', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 70, time: 0.75, loc: 'Skellefteå industri', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 45, time: 0.9, loc: 'Piteå vindkraftpark', mission: 'Inspection', cat: 'Specific', mode: 'BVLOS', alt: 150, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', days: 15, time: 0.7, loc: 'Kiruna powerline', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 140, observer: true },

    // Mini 4 — recce/marknadsföring
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 300, time: 0.2, loc: 'Gamla stan Stockholm', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 60 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 250, time: 0.3, loc: 'Öresundsbron', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 80 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 200, time: 0.25, loc: 'Gotland klippor', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 90 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 150, time: 0.3, loc: 'Visby stadsbilder', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 70 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 90, time: 0.2, loc: 'Åre skidbacke', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 50 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', days: 40, time: 0.25, loc: 'Uppsala domkyrka', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 65 },
  ];

  for (const p of plan) {
    await insertDroneFlight({
      date: isoDaysAgo(p.days),
      drone_id: p.droneId,
      drone_type: p.droneType,
      registration: p.reg,
      location: p.loc,
      mission_type: p.mission,
      category: p.cat,
      flight_mode: p.mode,
      total_time: String(p.time),
      max_altitude_m: String(p.alt),
      is_night: !!p.night,
      has_observer: !!p.observer,
      observer_name: p.observer ? 'Johan Berg' : '',
      remarks: '',
    });
  }
}

// ── Test user 2: Military drone pilot ────────────────────────────────────────
export async function seedTestUser2() {
  await wipeDroneData();
  await setSetting('drone_operator_id', 'SWE-MIL-0042');


  // Drönare — militär typ-mix
  const puma = await addDrone({
    drone_type: 'fixedwing',
    model: 'AeroVironment Puma 3 AE',
    registration: 'FMV-UAS-103',
    mtow_g: 6300,
    category: 'Specific',
    notes: 'ISR, hand-launched fixed-wing',
  });
  const blackHornet = await addDrone({
    drone_type: 'helicopter',
    model: 'FLIR Black Hornet 3',
    registration: 'FMV-NANO-22',
    mtow_g: 33,
    category: 'Specific',
    notes: 'Nano UAS pocket recce',
  });
  const switchblade = await addDrone({
    drone_type: 'fixedwing',
    model: 'Switchblade 300 (training variant)',
    registration: 'FMV-SB-07',
    mtow_g: 2500,
    category: 'Specific',
    notes: 'Inert training rounds',
  });
  const quad = await addDrone({
    drone_type: 'multirotor',
    model: 'Skydio X10D',
    registration: 'FMV-SX-14',
    mtow_g: 2200,
    category: 'Specific',
    notes: 'Autonomous recce',
  });


  // Certifikat
  await addCertificate({
    cert_type: 'A1/A3', label: 'SWEAF Rotary wing',
    issued_date: isoDaysAgo(375), expires_date: isoDaysFromNow(1450), notes: '',
  });
  await addCertificate({
    cert_type: 'STS-02', label: 'SWEAF STS-02 Lvl2',
    issued_date: isoDaysAgo(330), expires_date: isoDaysFromNow(1495), notes: '',
  });
  await addCertificate({
    cert_type: 'Operational Authorization', label: 'OA-MIL-2024-031',
    issued_date: isoDaysAgo(220), expires_date: isoDaysFromNow(25), notes: 'BVLOS over military training areas',
  });
  await addCertificate({
    cert_type: 'Other', label: 'Night Operations qualification',
    issued_date: isoDaysAgo(200), expires_date: isoDaysFromNow(5), notes: 'Required for night BVLOS',
  });

  // Flygningar — ~170h över 1 år, mix VLOS/EVLOS/BVLOS
  const plan: Array<{
    droneId: number; droneType: string; reg: string;
    days: number; time: number; loc: string; mission: string; cat: string; mode: 'VLOS'|'EVLOS'|'BVLOS';
    alt: number; night?: boolean; observer?: boolean;
  }> = [
    // Puma AE — lång ISR
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 350, time: 1.5, loc: 'Revingehed övningsfält', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 330, time: 1.8, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 310, time: 2.0, loc: 'Norra Kvarken', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 280, time: 1.6, loc: 'Visby FMV-område', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 350, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 240, time: 1.7, loc: 'Boden norra zon', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 450, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 200, time: 1.9, loc: 'Luleå ÖÖS', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 165, time: 2.0, loc: 'Gotska Sandön', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 130, time: 1.5, loc: 'Uppsalagarnison', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 350, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 90, time: 1.8, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 50, time: 1.6, loc: 'Östgötaslätten', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 380, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', days: 15, time: 1.9, loc: 'Nordkalotten', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true },

    // Black Hornet — nano recce, många korta
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 340, time: 0.25, loc: 'MOUT-anläggning Kvarn', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 15, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 330, time: 0.3, loc: 'Kvarn', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 290, time: 0.25, loc: 'FMV Enköping', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 18, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 260, time: 0.28, loc: 'Enköping', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 210, time: 0.3, loc: 'Ledningsövning Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 25, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 180, time: 0.25, loc: 'Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 22, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 140, time: 0.28, loc: 'Mältet övningsplats', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 18, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 100, time: 0.3, loc: 'Kungsängen', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 60, time: 0.25, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 15, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', days: 20, time: 0.3, loc: 'Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 25, observer: true, night: true },

    // Switchblade — få men längre
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', days: 300, time: 0.5, loc: 'Vidsel Test Range', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 250, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', days: 250, time: 0.55, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 280, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', days: 180, time: 0.6, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', days: 110, time: 0.55, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 280, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', days: 40, time: 0.6, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },

    // Skydio X10D — autonom recce
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 320, time: 0.55, loc: 'Skärgården övning', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 290, time: 0.5, loc: 'Arholma', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 110, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 260, time: 0.6, loc: 'Berga', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 230, time: 0.55, loc: 'Karlskrona', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 190, time: 0.65, loc: 'Ronneby garnison', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 130, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 150, time: 0.55, loc: 'Halmstad Lv6', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 110, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 120, time: 0.6, loc: 'Skövde P4', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 80, time: 0.55, loc: 'Eksjö Ing2', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 105, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 40, time: 0.5, loc: 'Kvarn', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', days: 10, time: 0.6, loc: 'Enköping', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
  ];

  for (const p of plan) {
    await insertDroneFlight({
      date: isoDaysAgo(p.days),
      drone_id: p.droneId,
      drone_type: p.droneType,
      registration: p.reg,
      location: p.loc,
      mission_type: p.mission,
      category: p.cat,
      flight_mode: p.mode,
      total_time: String(p.time),
      max_altitude_m: String(p.alt),
      is_night: !!p.night,
      has_observer: !!p.observer,
      observer_name: p.observer ? 'Lt. Karlsson' : '',
      remarks: '',
    });
  }
}

export async function clearTestUser() {
  await wipeDroneData();
  await setSetting('drone_operator_id', '');
}

// ── Manned testdata ──────────────────────────────────────────────────────────

async function wipeMannedData() {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM flights');
  await db.runAsync('DELETE FROM audit_log');
  await db.runAsync('DELETE FROM aircraft_registry');
  await db.runAsync('DELETE FROM icao_airports WHERE "temporary"=1');
  await db.runAsync('DELETE FROM drone_certificates');
}

async function addTempPlace(icao: string, name: string, lat: number, lon: number) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom, temporary)
     VALUES (?, ?, '', '', ?, ?, 0, 1)`,
    [icao, name, lat, lon]
  );
}

async function addAircraftReg(
  type: string, reg: string, cruiseKts: number, endH: number,
  crewType: string, category: string, engineType: string,
) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO aircraft_registry (aircraft_type, registration, cruise_speed_kts, endurance_h, crew_type, category, engine_type)
     VALUES (?,?,?,?,?,?,?)`,
    [type, reg, cruiseKts, endH, crewType, category, engineType]
  );
}

interface MannedFlight {
  date: string; type: string; reg: string;
  dep: string; depT: string; arr: string; arrT: string;
  total: number; pic: number; co: number; dual: number; ifr: number; night: number; nvg: number;
  ldDay: number; ldNight: number;
  rules: 'VFR' | 'IFR'; crew: 'sp' | 'mp'; se: number; me: number; remarks?: string;
}

// Deterministisk RNG (LCG) → identisk testdata varje gång man laddar profilen.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pad2 = (n: number) => String(n).padStart(2, '0');
function times(startH: number, durH: number, rng: () => number): { depT: string; arrT: string } {
  const depMin = (Math.round(startH * 60) + Math.floor(rng() * 55)) % (24 * 60);
  const arrMin = (depMin + Math.round(durH * 60)) % (24 * 60);
  const fmt = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  return { depT: fmt(depMin), arrT: fmt(arrMin) };
}

// En karriärfas: en flygplanstyp under en tidsperiod med rutt-pool, roll och natt-andel.
interface Phase {
  type: string; reg: string; count: number;
  fromDays: number; toDays: number;      // dagar sedan (from = äldst, to = nyast)
  durMin: number; durMax: number;
  routes: [string, string][];
  rules: 'VFR' | 'IFR';
  role: 'pic' | 'co' | 'progress';       // progress = co-pilot först, PIC senare i fasen
  crew: 'sp' | 'mp'; engine: 'se' | 'me'; category: 'airplane' | 'helicopter';
  nightFrac: number; dualFrac?: number; remark?: string;
}

function genPhase(p: Phase, rng: () => number): MannedFlight[] {
  const out: MannedFlight[] = [];
  const denom = Math.max(1, p.count - 1);
  for (let i = 0; i < p.count; i++) {
    const f = i / denom;
    const daysAgo = Math.max(1, Math.round(p.fromDays + (p.toDays - p.fromDays) * f + (rng() - 0.5) * 6));
    const [a, b] = p.routes[Math.floor(rng() * p.routes.length)] ?? p.routes[0];
    const fwd = rng() < 0.5;
    const dep = fwd ? a : b, arr = fwd ? b : a;
    const dur = +(p.durMin + rng() * (p.durMax - p.durMin)).toFixed(1);
    const { depT, arrT } = times(6 + Math.floor(rng() * 14), dur, rng);
    const isNight = rng() < p.nightFrac;
    // Långflyg: bara en del av tiden i mörker; korta nattflyg = hela blocket natt.
    const night = isNight ? +Math.min(dur, p.category === 'airplane' && dur > 6 ? dur * 0.45 : dur * 0.9).toFixed(1) : 0;
    const isDual = (p.dualFrac ?? 0) > 0 && f < (p.dualFrac ?? 0);
    let pic = 0, co = 0, dual = 0;
    if (isDual) dual = dur;
    else if (p.role === 'co') co = dur;
    else if (p.role === 'progress') { if (f < 0.55) co = dur; else pic = dur; }
    else pic = dur;
    out.push({
      date: isoDaysAgo(daysAgo), type: p.type, reg: p.reg, dep, depT, arr, arrT,
      total: dur, pic, co, dual, ifr: p.rules === 'IFR' ? dur : 0, night, nvg: 0,
      ldDay: isNight ? 0 : 1, ldNight: isNight ? 1 : 0,
      rules: p.rules, crew: p.crew, se: p.engine === 'se' ? dur : 0, me: p.engine === 'me' ? dur : 0,
      remarks: p.remark,
    });
  }
  return out;
}

async function insertPlan(flights: MannedFlight[]) {
  const db = await getDatabase();
  const sql = `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, flight_rules, flight_type,
      multi_pilot, single_pilot, instructor, nvg, stop_place, se_time, me_time
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  await db.withTransactionAsync(async () => {
    for (const f of flights) {
      await db.runAsync(sql, [
        f.date, f.type, f.reg,
        f.dep, f.depT, f.arr, f.arrT,
        f.total, f.ifr, f.night, f.pic, f.co, f.dual,
        f.ldDay, f.ldNight, f.remarks ?? '',
        'verified', 'manual', f.rules, 'normal',
        f.crew === 'mp' ? f.total : 0, f.crew === 'sp' ? f.total : 0, 0, f.nvg, '',
        f.se, f.me,
      ]);
    }
  });
}

// Sätter aktiv profil (roll + namn + regelverk) och markerar onboarding som klar.
async function setPilotProfile(sub: 'fixed' | 'rotary', first: string, last: string) {
  await setSetting('profile_main_role', 'pilot-manned');
  await setSetting('profile_sub_role', sub);
  await setSetting('profile_first_name', first);
  await setSetting('profile_last_name', last);
  await setSetting('profile_initials', `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase());
  await setSetting('regulation_standard', 'easa');
  await setSetting('has_onboarded', '1');
}

// ── Test pilot 1: Swedish airline pilot (SAS long-haul) — 2010→nu, ~1500 flights, ~11 000h,
// 8 flygplanstyper: US-flygskola (C172/PA28) → ME/IR → King Air air-taxi → ATR-regional →
// A320 narrowbody → A330/A350 long-haul interkontinentalt. ─────────────────────────────────
export async function seedMannedPilot1() {
  await wipeMannedData();

  // 8 flygplanstyper (typ, reg, marschfart kts, uthållighet h, crew, kategori, motor).
  await addAircraftReg('C172', 'N5217G', 120, 4.5, 'sp', 'airplane', 'se');
  await addAircraftReg('PA28', 'N283PA', 125, 4.5, 'sp', 'airplane', 'se');
  await addAircraftReg('DA42', 'N42DT', 165, 6.0, 'sp', 'airplane', 'me');
  await addAircraftReg('BE20', 'SE-KAB', 270, 5.5, 'sp', 'airplane', 'me');
  await addAircraftReg('AT72', 'SE-MKG', 275, 4.5, 'mp', 'airplane', 'me');
  await addAircraftReg('A320', 'SE-ROX', 447, 5.5, 'mp', 'airplane', 'me');
  await addAircraftReg('A333', 'SE-REF', 470, 13.0, 'mp', 'airplane', 'me');
  await addAircraftReg('A359', 'SE-RSA', 488, 15.0, 'mp', 'airplane', 'me');

  const rng = makeRng(20100901);
  const D = 365; // dagar/år-hjälp; 2010 ≈ 5800 dagar sedan, nu ≈ 0.
  const phases: Phase[] = [
    // 1) Flygskola Florida 2010–2011 (PPL + timbygge), C172.
    { type: 'C172', reg: 'N5217G', count: 90, fromDays: 16*D, toDays: 14.7*D, durMin: 0.8, durMax: 1.8, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.12, dualFrac: 0.35,
      routes: [['KLAL','KORL'],['KLAL','KBOW'],['KORL','KTPA'],['KLAL','KVRB'],['KLAL','KGIF'],['KORL','KLEE'],['KLAL','KFPR']], remark: 'Flight school — Florida' },
    // 2) CPL/IR-timbygge 2011, PA28 (VFR + lite IFR).
    { type: 'PA28', reg: 'N283PA', count: 70, fromDays: 14.7*D, toDays: 13.6*D, durMin: 1.0, durMax: 2.6, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.18,
      routes: [['KLAL','KJAX'],['KLAL','KMCO'],['KTPA','KRSW'],['KORL','KJAX'],['KLAL','KTLH'],['KMCO','KTPA']], remark: 'Hour building / CPL' },
    // 3) ME/IR twin 2011–2012, DA42.
    { type: 'DA42', reg: 'N42DT', count: 50, fromDays: 13.6*D, toDays: 12.8*D, durMin: 1.2, durMax: 2.4, rules: 'IFR', role: 'pic', crew: 'sp', engine: 'me', category: 'airplane', nightFrac: 0.25, dualFrac: 0.25,
      routes: [['KLAL','KMCO'],['KORL','KJAX'],['KTPA','KTLH'],['KMCO','KRSW']], remark: 'ME / IR training' },
    // 4) First job — King Air air taxi, Sverige/EU 2012–2013.
    { type: 'BE20', reg: 'SE-KAB', count: 90, fromDays: 12.8*D, toDays: 11.2*D, durMin: 0.8, durMax: 2.6, rules: 'IFR', role: 'pic', crew: 'sp', engine: 'me', category: 'airplane', nightFrac: 0.3,
      routes: [['ESSA','ESGG'],['ESSA','ESMS'],['ESGG','ESMS'],['ESSA','ESNU'],['ESSA','ENGM'],['ESGG','EKCH'],['ESSA','EFHK'],['ESSA','ESNN']], remark: 'Air taxi' },
    // 5) Regional turboprop, ATR 72 — first airline job 2013–2015 (FO→CPT).
    { type: 'AT72', reg: 'SE-MKG', count: 120, fromDays: 11.2*D, toDays: 9.0*D, durMin: 0.7, durMax: 2.4, rules: 'IFR', role: 'progress', crew: 'mp', engine: 'me', category: 'airplane', nightFrac: 0.35,
      routes: [['ESSA','ESNN'],['ESSA','ESNU'],['ESGG','ESSA'],['ESSA','ESPA'],['ESSA','ENVA'],['ESSA','EFHK'],['ESSA','EKCH'],['ESGG','ESMS'],['ESSA','ESNS']], remark: 'Regional turboprop' },
    // 6) A320 narrowbody, EU 2015–2019 (First Officer).
    { type: 'A320', reg: 'SE-ROX', count: 230, fromDays: 9.0*D, toDays: 6.2*D, durMin: 1.3, durMax: 3.6, rules: 'IFR', role: 'co', crew: 'mp', engine: 'me', category: 'airplane', nightFrac: 0.3,
      routes: [['ESSA','EDDF'],['ESSA','EGLL'],['ESSA','LFPG'],['ESSA','LEMD'],['ESSA','LEBL'],['ESSA','LIRF'],['ESSA','LOWW'],['ESSA','LSZH'],['ESSA','EHAM'],['EKCH','LPPT'],['EKCH','LGAV'],['ESSA','EDDM']], remark: 'Short/medium haul' },
    // 7) A330 long-haul 2019–2023 (FO → Captain).
    { type: 'A333', reg: 'SE-REF', count: 400, fromDays: 6.2*D, toDays: 2.8*D, durMin: 8.5, durMax: 11.5, rules: 'IFR', role: 'progress', crew: 'mp', engine: 'me', category: 'airplane', nightFrac: 0.6,
      routes: [['EKCH','KEWR'],['EKCH','KORD'],['ESSA','KIAD'],['EKCH','KLAX'],['EKCH','KSFO'],['EKCH','RJAA'],['EKCH','ZBAA'],['EKCH','VHHH'],['EKCH','OMDB'],['EKCH','WSSS'],['ESSA','KEWR']], remark: 'Long haul' },
    // 8) A350 long-haul 2023→nu (Captain).
    { type: 'A359', reg: 'SE-RSA', count: 450, fromDays: 2.8*D, toDays: 2, durMin: 9.0, durMax: 12.0, rules: 'IFR', role: 'pic', crew: 'mp', engine: 'me', category: 'airplane', nightFrac: 0.6,
      routes: [['EKCH','KLAX'],['EKCH','KSFO'],['ESSA','KJFK'],['EKCH','KORD'],['EKCH','RJAA'],['EKCH','ZSPD'],['EKCH','VHHH'],['EKCH','WSSS'],['EKCH','VTBS'],['ESSA','KEWR'],['EKCH','SBGR'],['EKCH','FAOR']], remark: 'Long haul' },
  ];

  const all: MannedFlight[] = [];
  for (const p of phases) all.push(...genPhase(p, rng));
  await insertPlan(all);

  await addCertificate({ cert_type: 'ATPL', label: 'ATPL(A)', issued_date: '2019-03-15', expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'A350', issued_date: isoDaysAgo(700), expires_date: isoDaysFromNow(200), notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'A330', issued_date: isoDaysAgo(2100), expires_date: isoDaysFromNow(120), notes: '' });
  await addCertificate({ cert_type: 'Medical Class 1', label: '', issued_date: isoDaysAgo(120), expires_date: isoDaysFromNow(245), notes: 'AME: Dr Lindberg, Stockholm' });
  await addCertificate({ cert_type: 'Proficiency Check (PC)', label: 'A350', issued_date: isoDaysAgo(80), expires_date: isoDaysFromNow(285), notes: 'TRE: Capt Svensson' });
  await addCertificate({ cert_type: 'Line Check', label: '', issued_date: isoDaysAgo(150), expires_date: isoDaysFromNow(215), notes: '' });
  await addCertificate({ cert_type: 'English Language Proficiency', label: 'Level 6', issued_date: '2018-11-01', expires_date: '', notes: 'Expert — no expiry' });

  await setPilotProfile('fixed', 'Erik', 'Lindqvist');
}

// ── Test pilot 2: Swedish HEMS pilot — 2015→nu, ~1000 flights, ~3000h, 6 helikoptertyper:
// utbildning Göteborg (R22/R44) → tour-flights Florida (B206) → long-line norra Sverige (H125)
// → utility/HEMS-övergång (H135) → HEMS Göteborg (H145). ─────────────────────────────────
export async function seedMannedPilot2() {
  await wipeMannedData();

  await addAircraftReg('R22', 'SE-JHR', 96, 2.0, 'sp', 'helicopter', 'se');
  await addAircraftReg('R44', 'SE-JRB', 109, 3.0, 'sp', 'helicopter', 'se');
  await addAircraftReg('B206', 'N206TF', 108, 2.8, 'sp', 'helicopter', 'se');
  await addAircraftReg('H125', 'SE-JLL', 133, 3.2, 'sp', 'helicopter', 'se');
  await addAircraftReg('H135', 'SE-JHM', 137, 3.3, 'sp', 'helicopter', 'me');
  await addAircraftReg('H145', 'SE-HEM', 135, 3.5, 'sp', 'helicopter', 'me');

  // Temporära platser: long-line-sajter i fjällen + sjukhushelikopterplattor.
  await addTempPlace('LLN1', 'Long-line site Padjelanta', 67.30, 17.60);
  await addTempPlace('LLN2', 'Long-line site Sarek', 67.28, 17.75);
  await addTempPlace('LLN3', 'Long-line site Kebnekaise', 67.90, 18.55);
  await addTempPlace('SUGB', 'Sahlgrenska Helipad', 57.6803, 11.9600);
  await addTempPlace('NALG', 'NÄL Helipad', 58.2500, 12.3200);

  const rng = makeRng(20150401);
  const D = 365;
  const phases: Phase[] = [
    // 1) Utbildning Göteborg 2015 (PPL(H)), R22.
    { type: 'R22', reg: 'SE-JHR', count: 80, fromDays: 11*D, toDays: 10.2*D, durMin: 0.6, durMax: 1.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'helicopter', nightFrac: 0.05, dualFrac: 0.45,
      routes: [['ESGG','ESGR'],['ESGG','ESGJ'],['ESGR','ESGT'],['ESGG','ESGT']], remark: 'PPL(H) training — Gothenburg' },
    // 2) CPL(H)-timbygge 2015–2016, R44.
    { type: 'R44', reg: 'SE-JRB', count: 110, fromDays: 10.2*D, toDays: 9.2*D, durMin: 1.0, durMax: 2.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'helicopter', nightFrac: 0.1,
      routes: [['ESGG','ESGR'],['ESGG','ESGJ'],['ESGR','ESGT'],['ESGG','ESGT'],['ESGJ','ESGR']], remark: 'Hour building / CPL(H)' },
    // 3) Tour flights Florida 2016–2017, Bell 206.
    { type: 'B206', reg: 'N206TF', count: 160, fromDays: 9.2*D, toDays: 7.6*D, durMin: 1.0, durMax: 2.6, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'helicopter', nightFrac: 0.1,
      routes: [['KORL','KISM'],['KISM','KTMB'],['KFLL','KTMB'],['KORL','KMLB'],['KISM','KFPR'],['KORL','KISM']], remark: 'Scenic tour flights — Florida' },
    // 4) Long-line / sling load norra Sverige 2017–2020, H125 (huvud-timmarna).
    { type: 'H125', reg: 'SE-JLL', count: 260, fromDays: 7.6*D, toDays: 4.6*D, durMin: 3.5, durMax: 6.5, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'helicopter', nightFrac: 0.08,
      routes: [['ESNG','LLN1'],['ESPA','LLN2'],['ESNX','LLN3'],['ESUT','LLN1'],['ESNG','ESNX'],['ESPA','ESNG'],['ESNX','LLN2']], remark: 'Long-line / sling load — Lapland' },
    // 5) Utility / HEMS-övergång västra Sverige 2020–2022, H135.
    { type: 'H135', reg: 'SE-JHM', count: 180, fromDays: 4.6*D, toDays: 2.6*D, durMin: 2.0, durMax: 4.2, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'me', category: 'helicopter', nightFrac: 0.2,
      routes: [['ESGG','ESGR'],['ESGG','ESGJ'],['ESGR','ESGT'],['ESGG','ESGT'],['ESGJ','ESGG']], remark: 'Utility / HEMS transition' },
    // 6) HEMS Göteborg 2022→nu, H145 (uppdrag + inter-hospital transfers, IFR + natt).
    { type: 'H145', reg: 'SE-HEM', count: 210, fromDays: 2.6*D, toDays: 2, durMin: 1.2, durMax: 3.6, rules: 'IFR', role: 'pic', crew: 'sp', engine: 'me', category: 'helicopter', nightFrac: 0.4,
      routes: [['ESGG','SUGB'],['SUGB','NALG'],['ESGG','NALG'],['SUGB','ESGR'],['ESGG','ESGJ'],['SUGB','ESGT']], remark: 'HEMS — Gothenburg' },
  ];

  const all: MannedFlight[] = [];
  for (const p of phases) all.push(...genPhase(p, rng));
  await insertPlan(all);

  await addCertificate({ cert_type: 'CPL', label: 'CPL(H)', issued_date: '2016-08-20', expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'IR', label: 'IR(H)', issued_date: '2021-04-12', expires_date: isoDaysFromNow(140), notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'H145', issued_date: isoDaysAgo(900), expires_date: isoDaysFromNow(160), notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'H135', issued_date: isoDaysAgo(1500), expires_date: isoDaysFromNow(70), notes: 'Renewal due soon' });
  await addCertificate({ cert_type: 'Type Rating', label: 'H125', issued_date: isoDaysAgo(2600), expires_date: isoDaysFromNow(300), notes: '' });
  await addCertificate({ cert_type: 'HEMS Crew', label: 'HEMS commander', issued_date: isoDaysAgo(700), expires_date: isoDaysFromNow(230), notes: '' });
  await addCertificate({ cert_type: 'NVIS', label: 'Night Vision Imaging', issued_date: isoDaysAgo(600), expires_date: isoDaysFromNow(120), notes: '' });
  await addCertificate({ cert_type: 'Medical Class 1', label: '', issued_date: isoDaysAgo(90), expires_date: isoDaysFromNow(275), notes: '' });
  await addCertificate({ cert_type: 'Proficiency Check (PC)', label: 'H145', issued_date: isoDaysAgo(60), expires_date: isoDaysFromNow(305), notes: 'TRE: Capt Johansson' });
  await addCertificate({ cert_type: 'English Language Proficiency', label: 'Level 5', issued_date: '2023-01-10', expires_date: isoDaysFromNow(600), notes: '' });

  await setPilotProfile('rotary', 'Anna', 'Berg');
}

// ── Test pilot 3: Swedish CPL student — ~halvvägs mot CPL(A)-kraven. Har PPL(A) + nattbehörighet,
// mitt i timbygget (~110 h totalt, ~85 h PIC). Fixed-wing, TVÅ flygplan: skolans C172 (PPL +
// natt) och en PA28 för timbygge/XC. Gällande Class 1-medical, ELP L4, ATPL-teori pågår. ──────
export async function seedMannedPilot3() {
  await wipeMannedData();

  // Två flygplanstyper (typ, reg, marschfart kts, uthållighet h, crew, kategori, motor).
  await addAircraftReg('C172', 'SE-KMA', 120, 4.5, 'sp', 'airplane', 'se');
  await addAircraftReg('PA28', 'SE-GBP', 125, 5.0, 'sp', 'airplane', 'se');

  const rng = makeRng(20230301);
  const D = 365;
  const phases: Phase[] = [
    // 1) PPL(A)-utbildning Göteborg (dual → solo), C172. Startar ~21 mån sedan.
    { type: 'C172', reg: 'SE-KMA', count: 40, fromDays: 640, toDays: 430, durMin: 0.6, durMax: 1.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.03, dualFrac: 0.55,
      routes: [['ESGG','ESGR'],['ESGG','ESGJ'],['ESGR','ESGT'],['ESGG','ESGT'],['ESGJ','ESGR']], remark: 'PPL(A) training — Gothenburg' },
    // 2) Timbygge PA28 (VFR-navigering, PIC) mot CPL.
    { type: 'PA28', reg: 'SE-GBP', count: 22, fromDays: 430, toDays: 130, durMin: 1.0, durMax: 2.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.08,
      routes: [['ESGG','ESMS'],['ESGG','ESGJ'],['ESGG','ESSA'],['ESGJ','ESMS'],['ESGR','ESGG'],['ESGG','ESNN']], remark: 'Hour building / CPL' },
    // 3) Nattbehörighet C172 (mestadels natt), lokalt.
    { type: 'C172', reg: 'SE-KMA', count: 7, fromDays: 210, toDays: 165, durMin: 0.8, durMax: 1.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.95,
      routes: [['ESGG','ESGR'],['ESGG','ESGT'],['ESGR','ESGG']], remark: 'Night rating' },
    // 4) Längre XC-timbygge PA28 (inkl. 300 NM-kvalificeringsflygning), senaste månaderna.
    { type: 'PA28', reg: 'SE-GBP', count: 9, fromDays: 130, toDays: 3, durMin: 2.0, durMax: 3.4, rules: 'VFR', role: 'pic', crew: 'sp', engine: 'se', category: 'airplane', nightFrac: 0.05,
      routes: [['ESGG','ESSA'],['ESGG','EKCH'],['ESGG','ESMS'],['ESSA','ESGG']], remark: 'Cross-country hour building (300 NM qualifier)' },
  ];

  const all: MannedFlight[] = [];
  for (const p of phases) all.push(...genPhase(p, rng));
  await insertPlan(all);

  await addCertificate({ cert_type: 'PPL', label: 'PPL(A)', issued_date: isoDaysAgo(430), expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'Night Rating', label: '', issued_date: isoDaysAgo(170), expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'Medical Class 1', label: '', issued_date: isoDaysAgo(150), expires_date: isoDaysFromNow(215), notes: 'AME: Dr Holm, Göteborg' });
  await addCertificate({ cert_type: 'ATPL Theory', label: '7 of 13 exams passed', issued_date: isoDaysAgo(120), expires_date: '', notes: 'CPL/ATPL theory in progress' });
  await addCertificate({ cert_type: 'English Language Proficiency', label: 'Level 4', issued_date: isoDaysAgo(400), expires_date: isoDaysFromNow(1000), notes: '' });

  await setPilotProfile('fixed', 'Sofia', 'Ek');
}

export async function clearMannedTestUser() {
  await wipeMannedData();
}

