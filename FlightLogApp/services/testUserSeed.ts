import { getDatabase } from '../db/database';
import { addDrone, addBattery, updateBattery, addCertificate, insertDroneFlight } from '../db/drones';
import { setSetting } from '../db/flights';

async function wipeDroneData() {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM drone_flights');
  await db.runAsync('DELETE FROM drone_batteries');
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
  }, 0);
  const matrice30 = await addDrone({
    drone_type: 'multirotor',
    model: 'DJI Matrice 30T',
    registration: 'SWE-RP-8877',
    mtow_g: 3770,
    category: 'Specific',
    notes: 'Thermal + zoom, powerline inspections',
  }, 0);
  const mini4 = await addDrone({
    drone_type: 'multirotor',
    model: 'DJI Mini 4 Pro',
    registration: 'SWE-RP-1102',
    mtow_g: 249,
    category: 'A1',
    notes: 'Recce / marketing content',
  }, 0);

  // Batterier (manuellt — realistiska serier + cykelantal)
  const db = await getDatabase();
  const addBat = async (droneId: number, label: string, serial: string, cycles: number) => {
    const r = await db.runAsync(
      `INSERT INTO drone_batteries (drone_id, label, serial, cycle_count) VALUES (?,?,?,?)`,
      [droneId, label, serial, cycles]
    );
    return r.lastInsertRowId as number;
  };
  const m3e_b1 = await addBat(mavic3e, 'Battery #1', 'TB30-001', 142);
  const m3e_b2 = await addBat(mavic3e, 'Battery #2', 'TB30-002', 138);
  const m3e_b3 = await addBat(mavic3e, 'Battery #3', 'TB30-003', 89);
  const m30_b1 = await addBat(matrice30, 'Battery #1', 'TB30-M-1', 97);
  const m30_b2 = await addBat(matrice30, 'Battery #2', 'TB30-M-2', 92);
  const m30_b3 = await addBat(matrice30, 'Battery #3', 'TB30-M-3', 65);
  const m30_b4 = await addBat(matrice30, 'Battery #4', 'TB30-M-4', 58);
  const mini_b1 = await addBat(mini4, 'Battery #1', 'MINI4-A', 45);
  const mini_b2 = await addBat(mini4, 'Battery #2', 'MINI4-B', 42);

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
    droneId: number; droneType: string; reg: string; bat: number; batCycles: number;
    days: number; time: number; loc: string; mission: string; cat: string; mode: 'VLOS'|'EVLOS'|'BVLOS';
    alt: number; night?: boolean; observer?: boolean;
  }> = [
    // Mavic 3E — inspektioner
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 12, days: 340, time: 0.35, loc: 'Västerås solpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 80 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b2, batCycles: 14, days: 335, time: 0.45, loc: 'Västerås solpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 85 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 22, days: 320, time: 0.42, loc: 'Uppsala vindkraftverk', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 120 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b3, batCycles: 8, days: 300, time: 0.5, loc: 'Arlanda hangar 7', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 45 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b2, batCycles: 28, days: 280, time: 0.3, loc: 'Stockholm Stadion', mission: 'Photo / Video', cat: 'A2', mode: 'VLOS', alt: 60 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 40, days: 260, time: 0.4, loc: 'Solna broinspektion', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 30 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b3, batCycles: 20, days: 240, time: 0.48, loc: 'Linköping vattenverk', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 90 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b2, batCycles: 60, days: 220, time: 0.35, loc: 'Örebro tak', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 25 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 80, days: 200, time: 0.5, loc: 'Gävle hamnkran', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 70 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b3, batCycles: 50, days: 170, time: 0.4, loc: 'Karlstad kraftledning', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 110 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b2, batCycles: 100, days: 140, time: 0.45, loc: 'Sundsvall takinsp.', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 35 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 120, days: 110, time: 0.6, loc: 'Umeå broinspektion', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 40 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b3, batCycles: 75, days: 80, time: 0.35, loc: 'Malmö marknadsfilm', mission: 'Photo / Video', cat: 'A2', mode: 'VLOS', alt: 80 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b2, batCycles: 125, days: 60, time: 0.4, loc: 'Halmstad vindpark', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 120 },
    { droneId: mavic3e, droneType: 'multirotor', reg: 'SWE-RP-2241', bat: m3e_b1, batCycles: 140, days: 30, time: 0.55, loc: 'Trollhättan turbininsp.', mission: 'Inspection', cat: 'A2', mode: 'VLOS', alt: 95 },

    // Matrice 30T — Specific, EVLOS/BVLOS
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b1, batCycles: 5, days: 310, time: 0.7, loc: 'E4 kraftledning Uppland', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 150, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b2, batCycles: 7, days: 290, time: 0.8, loc: 'Dalälven powerline', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 140, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b3, batCycles: 10, days: 270, time: 0.85, loc: 'Sandviken kraftstation', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 130, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b4, batCycles: 12, days: 250, time: 0.6, loc: 'Bollnäs skogsinventering', mission: 'Mapping', cat: 'Specific', mode: 'BVLOS', alt: 120, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b1, batCycles: 35, days: 220, time: 0.75, loc: 'Ljusdal vindkraftpark', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 160, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b2, batCycles: 40, days: 190, time: 0.9, loc: 'Sundsvall powerline', mission: 'Inspection', cat: 'Specific', mode: 'BVLOS', alt: 150, observer: true, night: false },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b3, batCycles: 45, days: 160, time: 0.8, loc: 'Östersund skogsinv.', mission: 'Mapping', cat: 'Specific', mode: 'BVLOS', alt: 140, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b1, batCycles: 70, days: 125, time: 0.7, loc: 'Gällivare kraftledning', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 155, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b4, batCycles: 35, days: 95, time: 0.85, loc: 'Luleå hamn thermal', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b2, batCycles: 75, days: 70, time: 0.75, loc: 'Skellefteå industri', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b3, batCycles: 55, days: 45, time: 0.9, loc: 'Piteå vindkraftpark', mission: 'Inspection', cat: 'Specific', mode: 'BVLOS', alt: 150, observer: true },
    { droneId: matrice30, droneType: 'multirotor', reg: 'SWE-RP-8877', bat: m30_b1, batCycles: 95, days: 15, time: 0.7, loc: 'Kiruna powerline', mission: 'Inspection', cat: 'Specific', mode: 'EVLOS', alt: 140, observer: true },

    // Mini 4 — recce/marknadsföring
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b1, batCycles: 5, days: 300, time: 0.2, loc: 'Gamla stan Stockholm', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 60 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b2, batCycles: 8, days: 250, time: 0.3, loc: 'Öresundsbron', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 80 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b1, batCycles: 20, days: 200, time: 0.25, loc: 'Gotland klippor', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 90 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b2, batCycles: 25, days: 150, time: 0.3, loc: 'Visby stadsbilder', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 70 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b1, batCycles: 40, days: 90, time: 0.2, loc: 'Åre skidbacke', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 50 },
    { droneId: mini4, droneType: 'multirotor', reg: 'SWE-RP-1102', bat: mini_b2, batCycles: 40, days: 40, time: 0.25, loc: 'Uppsala domkyrka', mission: 'Photo / Video', cat: 'A1', mode: 'VLOS', alt: 65 },
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
      battery_id: p.bat,
      battery_start_cycles: String(p.batCycles),
      remarks: '',
    });
  }
}

// ── Test user 2: Military drone pilot ────────────────────────────────────────
export async function seedTestUser2() {
  await wipeDroneData();
  await setSetting('drone_operator_id', 'SWE-MIL-0042');

  const db = await getDatabase();
  const addBat = async (droneId: number, label: string, serial: string, cycles: number) => {
    const r = await db.runAsync(
      `INSERT INTO drone_batteries (drone_id, label, serial, cycle_count) VALUES (?,?,?,?)`,
      [droneId, label, serial, cycles]
    );
    return r.lastInsertRowId as number;
  };

  // Drönare — militär typ-mix
  const puma = await addDrone({
    drone_type: 'fixedwing',
    model: 'AeroVironment Puma 3 AE',
    registration: 'FMV-UAS-103',
    mtow_g: 6300,
    category: 'Specific',
    notes: 'ISR, hand-launched fixed-wing',
  }, 0);
  const blackHornet = await addDrone({
    drone_type: 'helicopter',
    model: 'FLIR Black Hornet 3',
    registration: 'FMV-NANO-22',
    mtow_g: 33,
    category: 'Specific',
    notes: 'Nano UAS pocket recce',
  }, 0);
  const switchblade = await addDrone({
    drone_type: 'fixedwing',
    model: 'Switchblade 300 (training variant)',
    registration: 'FMV-SB-07',
    mtow_g: 2500,
    category: 'Specific',
    notes: 'Inert training rounds',
  }, 0);
  const quad = await addDrone({
    drone_type: 'multirotor',
    model: 'Skydio X10D',
    registration: 'FMV-SX-14',
    mtow_g: 2200,
    category: 'Specific',
    notes: 'Autonomous recce',
  }, 0);

  // Batterier
  const puma_b1 = await addBat(puma, 'Battery #1', 'PUMA-L1', 62);
  const puma_b2 = await addBat(puma, 'Battery #2', 'PUMA-L2', 58);
  const puma_b3 = await addBat(puma, 'Battery #3', 'PUMA-L3', 51);
  const bh_b1 = await addBat(blackHornet, 'Base #1', 'BH3-A1', 180);
  const bh_b2 = await addBat(blackHornet, 'Base #2', 'BH3-A2', 165);
  const sb_b1 = await addBat(switchblade, 'Battery #1', 'SB300-01', 18);
  const sb_b2 = await addBat(switchblade, 'Battery #2', 'SB300-02', 15);
  const sx_b1 = await addBat(quad, 'Battery #1', 'SX10-A', 112);
  const sx_b2 = await addBat(quad, 'Battery #2', 'SX10-B', 108);
  const sx_b3 = await addBat(quad, 'Battery #3', 'SX10-C', 95);
  const sx_b4 = await addBat(quad, 'Battery #4', 'SX10-D', 88);

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
    droneId: number; droneType: string; reg: string; bat: number; batCycles: number;
    days: number; time: number; loc: string; mission: string; cat: string; mode: 'VLOS'|'EVLOS'|'BVLOS';
    alt: number; night?: boolean; observer?: boolean;
  }> = [
    // Puma AE — lång ISR
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b1, batCycles: 4, days: 350, time: 1.5, loc: 'Revingehed övningsfält', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b2, batCycles: 6, days: 330, time: 1.8, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b3, batCycles: 3, days: 310, time: 2.0, loc: 'Norra Kvarken', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b1, batCycles: 18, days: 280, time: 1.6, loc: 'Visby FMV-område', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 350, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b2, batCycles: 22, days: 240, time: 1.7, loc: 'Boden norra zon', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 450, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b3, batCycles: 18, days: 200, time: 1.9, loc: 'Luleå ÖÖS', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b1, batCycles: 38, days: 165, time: 2.0, loc: 'Gotska Sandön', mission: 'SAR', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b2, batCycles: 42, days: 130, time: 1.5, loc: 'Uppsalagarnison', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 350, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b3, batCycles: 35, days: 90, time: 1.8, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 400, observer: true, night: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b1, batCycles: 55, days: 50, time: 1.6, loc: 'Östgötaslätten', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 380, observer: true },
    { droneId: puma, droneType: 'fixedwing', reg: 'FMV-UAS-103', bat: puma_b2, batCycles: 55, days: 15, time: 1.9, loc: 'Nordkalotten', mission: 'Training', cat: 'Specific', mode: 'BVLOS', alt: 500, observer: true },

    // Black Hornet — nano recce, många korta
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b1, batCycles: 6, days: 340, time: 0.25, loc: 'MOUT-anläggning Kvarn', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 15, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b2, batCycles: 8, days: 330, time: 0.3, loc: 'Kvarn', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b1, batCycles: 40, days: 290, time: 0.25, loc: 'FMV Enköping', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 18, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b2, batCycles: 42, days: 260, time: 0.28, loc: 'Enköping', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b1, batCycles: 85, days: 210, time: 0.3, loc: 'Ledningsövning Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 25, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b2, batCycles: 88, days: 180, time: 0.25, loc: 'Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 22, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b1, batCycles: 130, days: 140, time: 0.28, loc: 'Mältet övningsplats', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 18, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b2, batCycles: 130, days: 100, time: 0.3, loc: 'Kungsängen', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 20, observer: true, night: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b1, batCycles: 170, days: 60, time: 0.25, loc: 'Revingehed', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 15, observer: true },
    { droneId: blackHornet, droneType: 'helicopter', reg: 'FMV-NANO-22', bat: bh_b2, batCycles: 160, days: 20, time: 0.3, loc: 'Boden', mission: 'Training', cat: 'Specific', mode: 'VLOS', alt: 25, observer: true, night: true },

    // Switchblade — få men längre
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', bat: sb_b1, batCycles: 2, days: 300, time: 0.5, loc: 'Vidsel Test Range', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 250, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', bat: sb_b2, batCycles: 2, days: 250, time: 0.55, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 280, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', bat: sb_b1, batCycles: 8, days: 180, time: 0.6, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', bat: sb_b2, batCycles: 8, days: 110, time: 0.55, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 280, observer: true },
    { droneId: switchblade, droneType: 'fixedwing', reg: 'FMV-SB-07', bat: sb_b1, batCycles: 15, days: 40, time: 0.6, loc: 'Vidsel', mission: 'Testing', cat: 'Specific', mode: 'BVLOS', alt: 300, observer: true },

    // Skydio X10D — autonom recce
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b1, batCycles: 10, days: 320, time: 0.55, loc: 'Skärgården övning', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b2, batCycles: 12, days: 290, time: 0.5, loc: 'Arholma', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 110, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b3, batCycles: 8, days: 260, time: 0.6, loc: 'Berga', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b4, batCycles: 10, days: 230, time: 0.55, loc: 'Karlskrona', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b1, batCycles: 45, days: 190, time: 0.65, loc: 'Ronneby garnison', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 130, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b2, batCycles: 48, days: 150, time: 0.55, loc: 'Halmstad Lv6', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 110, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b3, batCycles: 50, days: 120, time: 0.6, loc: 'Skövde P4', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b4, batCycles: 52, days: 80, time: 0.55, loc: 'Eksjö Ing2', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 105, observer: true, night: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b1, batCycles: 105, days: 40, time: 0.5, loc: 'Kvarn', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 100, observer: true },
    { droneId: quad, droneType: 'multirotor', reg: 'FMV-SX-14', bat: sx_b2, batCycles: 105, days: 10, time: 0.6, loc: 'Enköping', mission: 'Training', cat: 'Specific', mode: 'EVLOS', alt: 120, observer: true, night: true },
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
      battery_id: p.bat,
      battery_start_cycles: String(p.batCycles),
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
  total: number; pic: number; co: number; ifr: number; night: number; nvg?: number;
  ldDay: number; ldNight: number;
  rules?: 'VFR' | 'IFR'; flightType?: 'normal' | 'hot_refuel' | 'touch_and_go';
  stopPlace?: string; remarks?: string;
}

async function insertMannedFlight(f: MannedFlight) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, flight_rules, flight_type,
      multi_pilot, single_pilot, instructor, nvg, stop_place, se_time, me_time
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      f.date, f.type, f.reg,
      f.dep, f.depT, f.arr, f.arrT,
      f.total, f.ifr, f.night, f.pic, f.co, 0,
      f.ldDay, f.ldNight, f.remarks ?? '',
      'verified', 'manual', f.rules ?? 'VFR', f.flightType ?? 'normal',
      f.co > 0 ? f.total : 0, f.co > 0 ? 0 : f.total, 0, f.nvg ?? 0, f.stopPlace ?? '',
      0, 0,
    ]
  );
}

/** Summary-rad: historisk total-tid som inte delas upp per flygning */
async function insertSummary(type: string, total: number, pic: number, co: number, ifr: number, night: number, date: string, remarks: string) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, flight_rules, flight_type,
      multi_pilot, single_pilot, instructor, nvg, stop_place, se_time, me_time
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      date, type, '',
      '', '', '', '',
      total, ifr, night, pic, co, 0,
      0, 0, remarks,
      'verified', 'import', 'IFR', 'summary',
      co, pic, 0, 0, '', 0, 0,
    ]
  );
}

// ── Test user 3: Commercial airline pilot (A320, 10 år, ~5520h) ─────────────
export async function seedMannedPilot1() {
  await wipeMannedData();

  await addAircraftReg('A320', 'SE-DOZ', 447, 5.5, 'mp', 'airplane', 'me');
  await addAircraftReg('A320', 'SE-DOY', 447, 5.5, 'mp', 'airplane', 'me');
  await addAircraftReg('A320', 'SE-RJE', 447, 5.5, 'mp', 'airplane', 'me');

  // Summary — 10 års historik minus senaste 14 flygningar
  await insertSummary(
    'A320', 5417.3, 2890.5, 2526.8, 5380.0, 420.0,
    isoDaysAgo(3600), 'Historical total — 10 years A320 EU commercial ops'
  );

  // Senaste 14 flygningar för dashboard/listor — ~105h så total blir ~5522h
  const plan: MannedFlight[] = [
    { date: isoDaysAgo(340), type: 'A320', reg: 'SE-DOZ', dep: 'ESSA', depT: '07:20', arr: 'EKCH', arrT: '08:50', total: 1.5, pic: 0, co: 1.5, ifr: 1.5, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(312), type: 'A320', reg: 'SE-DOY', dep: 'ESSA', depT: '14:05', arr: 'EDDF', arrT: '16:40', total: 2.6, pic: 0, co: 2.6, ifr: 2.6, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(288), type: 'A320', reg: 'SE-RJE', dep: 'EDDF', depT: '17:30', arr: 'ESSA', arrT: '20:15', total: 2.7, pic: 0, co: 2.7, ifr: 2.7, night: 1.2, ldDay: 0, ldNight: 1, rules: 'IFR' },
    { date: isoDaysAgo(260), type: 'A320', reg: 'SE-DOZ', dep: 'ESSA', depT: '06:50', arr: 'LFPG', arrT: '09:30', total: 2.7, pic: 2.7, co: 0, ifr: 2.7, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(230), type: 'A320', reg: 'SE-DOY', dep: 'ESSA', depT: '11:10', arr: 'LOWW', arrT: '14:20', total: 3.2, pic: 3.2, co: 0, ifr: 3.2, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(210), type: 'A320', reg: 'SE-RJE', dep: 'LOWW', depT: '15:05', arr: 'ESSA', arrT: '18:10', total: 3.1, pic: 3.1, co: 0, ifr: 3.1, night: 0.5, ldDay: 0, ldNight: 1, rules: 'IFR' },
    { date: isoDaysAgo(180), type: 'A320', reg: 'SE-DOZ', dep: 'ESSA', depT: '08:00', arr: 'EGLL', arrT: '10:45', total: 2.8, pic: 0, co: 2.8, ifr: 2.8, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(150), type: 'A320', reg: 'SE-DOY', dep: 'EGLL', depT: '12:20', arr: 'ESSA', arrT: '15:30', total: 3.2, pic: 3.2, co: 0, ifr: 3.2, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(120), type: 'A320', reg: 'SE-RJE', dep: 'ESSA', depT: '16:40', arr: 'LEBL', arrT: '20:30', total: 3.8, pic: 3.8, co: 0, ifr: 3.8, night: 1.8, ldDay: 0, ldNight: 1, rules: 'IFR' },
    { date: isoDaysAgo(90), type: 'A320', reg: 'SE-DOZ', dep: 'LEBL', depT: '21:10', arr: 'ESSA', arrT: '00:55', total: 3.7, pic: 0, co: 3.7, ifr: 3.7, night: 3.7, ldDay: 0, ldNight: 1, rules: 'IFR' },
    { date: isoDaysAgo(60), type: 'A320', reg: 'SE-DOY', dep: 'ESSA', depT: '07:45', arr: 'LSZH', arrT: '10:30', total: 2.7, pic: 2.7, co: 0, ifr: 2.7, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(45), type: 'A320', reg: 'SE-RJE', dep: 'LSZH', depT: '11:30', arr: 'EDDM', arrT: '12:30', total: 1.0, pic: 1.0, co: 0, ifr: 1.0, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(30), type: 'A320', reg: 'SE-DOZ', dep: 'EDDM', depT: '13:15', arr: 'ESSA', arrT: '15:40', total: 2.4, pic: 0, co: 2.4, ifr: 2.4, night: 0, ldDay: 1, ldNight: 0, rules: 'IFR' },
    { date: isoDaysAgo(10), type: 'A320', reg: 'SE-DOY', dep: 'ESSA', depT: '05:55', arr: 'LIRF', arrT: '09:40', total: 3.7, pic: 0, co: 3.7, ifr: 3.7, night: 0.5, ldDay: 1, ldNight: 0, rules: 'IFR' },
  ];
  for (const f of plan) await insertMannedFlight(f);

  // Certificates for airline pilot
  await addCertificate({ cert_type: 'ATPL', label: 'Frozen ATPL', issued_date: '2018-03-15', expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'A320 Family', issued_date: '2020-06-10', expires_date: isoDaysFromNow(180), notes: '' });
  await addCertificate({ cert_type: 'Medical Class 1', label: '', issued_date: isoDaysAgo(200), expires_date: isoDaysFromNow(165), notes: 'AME: Dr Lindberg, Stockholm' });
  await addCertificate({ cert_type: 'Proficiency Check (PC)', label: 'A320', issued_date: isoDaysAgo(90), expires_date: isoDaysFromNow(275), notes: 'TRE: Capt Svensson' });
  await addCertificate({ cert_type: 'Line Check', label: '', issued_date: isoDaysAgo(150), expires_date: isoDaysFromNow(215), notes: '' });
  await addCertificate({ cert_type: 'CRM', label: 'Annual refresher', issued_date: isoDaysAgo(60), expires_date: isoDaysFromNow(305), notes: '' });
  await addCertificate({ cert_type: 'Dangerous Goods', label: 'CAT.OP', issued_date: isoDaysAgo(400), expires_date: isoDaysFromNow(-35), notes: 'EXPIRED' });
  await addCertificate({ cert_type: 'English Language Proficiency', label: 'Level 6', issued_date: '2022-11-01', expires_date: '', notes: 'Expert — no expiry' });
}

// ── Test user 4: Helicopter bushpilot (Bell 407 + H125, 10 år, ~3210h) ──────
export async function seedMannedPilot2() {
  await wipeMannedData();

  await addAircraftReg('B407', 'SE-JMB', 133, 2.8, 'sp', 'helicopter', 'se');
  await addAircraftReg('H125', 'SE-JPO', 140, 3.0, 'sp', 'helicopter', 'se');

  // Temporära landningsplatser — typisk bushpilot-mix av läger, bushfields och fjällstugor
  await addTempPlace('SJON', 'Sjöbotten', 65.9234, 17.4521);
  await addTempPlace('BKFJ', 'Bushfield North', 66.2105, 19.8324);
  await addTempPlace('LAPN', 'Lappmark camp', 67.1234, 18.6543);
  await addTempPlace('FJLN', 'Fjällsjön', 64.5678, 14.9876);
  await addTempPlace('SKGA', 'Skoghagen', 63.1243, 16.2345);
  await addTempPlace('VATN', 'Vattensjön', 65.4567, 15.7890);

  await insertSummary(
    'B407', 3143.6, 3143.6, 0, 0, 190.0,
    isoDaysAgo(3600), 'Historical total — 10 years bush / utility flying'
  );

  // Senaste 14 flygningar — ~72h så total blir ~3216h. 50% temp landningsplatser.
  const plan: MannedFlight[] = [
    { date: isoDaysAgo(345), type: 'B407', reg: 'SE-JMB', dep: 'ESSA', depT: '08:30', arr: 'ESNX', arrT: '10:10', total: 1.7, pic: 1.7, co: 0, ifr: 0, night: 0, ldDay: 2, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(320), type: 'B407', reg: 'SE-JMB', dep: 'SJON', depT: '09:15', arr: 'BKFJ', arrT: '10:55', total: 1.7, pic: 1.7, co: 0, ifr: 0, night: 0, ldDay: 3, ldNight: 0, rules: 'VFR', remarks: 'Rep-transport mellan läger' },
    { date: isoDaysAgo(295), type: 'B407', reg: 'SE-JMB', dep: 'ESNG', depT: '11:00', arr: 'LAPN', arrT: '13:20', total: 2.3, pic: 2.3, co: 0, ifr: 0, night: 0, ldDay: 3, ldNight: 0, rules: 'VFR', flightType: 'hot_refuel', stopPlace: 'FJLN', remarks: 'Hot refuel Fjällsjön' },
    { date: isoDaysAgo(270), type: 'H125', reg: 'SE-JPO', dep: 'LAPN', depT: '07:30', arr: 'VATN', arrT: '09:40', total: 2.2, pic: 2.2, co: 0, ifr: 0, night: 0, ldDay: 4, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(240), type: 'H125', reg: 'SE-JPO', dep: 'ESSA', depT: '06:40', arr: 'ESNY', arrT: '09:20', total: 2.7, pic: 2.7, co: 0, ifr: 0, night: 0, ldDay: 2, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(215), type: 'H125', reg: 'SE-JPO', dep: 'SKGA', depT: '10:00', arr: 'SJON', arrT: '12:15', total: 2.2, pic: 2.2, co: 0, ifr: 0, night: 0, ldDay: 5, ldNight: 0, rules: 'VFR', flightType: 'touch_and_go', stopPlace: 'VATN', remarks: 'Materialtransport' },
    { date: isoDaysAgo(185), type: 'B407', reg: 'SE-JMB', dep: 'ESNG', depT: '13:30', arr: 'ESSA', arrT: '16:00', total: 2.5, pic: 2.5, co: 0, ifr: 0, night: 0, ldDay: 2, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(155), type: 'B407', reg: 'SE-JMB', dep: 'ESSA', depT: '20:30', arr: 'BKFJ', arrT: '22:40', total: 2.1, pic: 2.1, co: 0, ifr: 0, night: 2.1, nvg: 1.8, ldDay: 0, ldNight: 3, rules: 'VFR', remarks: 'NVG training bushfield' },
    { date: isoDaysAgo(130), type: 'H125', reg: 'SE-JPO', dep: 'BKFJ', depT: '07:15', arr: 'LAPN', arrT: '10:05', total: 2.8, pic: 2.8, co: 0, ifr: 0, night: 0, ldDay: 3, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(100), type: 'H125', reg: 'SE-JPO', dep: 'ESNY', depT: '11:20', arr: 'VATN', arrT: '13:45', total: 2.4, pic: 2.4, co: 0, ifr: 0, night: 0, ldDay: 4, ldNight: 0, rules: 'VFR', flightType: 'hot_refuel', stopPlace: 'BKFJ', remarks: 'Hot refuel bushfield' },
    { date: isoDaysAgo(75), type: 'B407', reg: 'SE-JMB', dep: 'FJLN', depT: '14:30', arr: 'SKGA', arrT: '16:50', total: 2.3, pic: 2.3, co: 0, ifr: 0, night: 0, ldDay: 2, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(50), type: 'B407', reg: 'SE-JMB', dep: 'SJON', depT: '22:10', arr: 'ESMS', arrT: '00:40', total: 2.5, pic: 2.5, co: 0, ifr: 0, night: 2.5, nvg: 2.2, ldDay: 0, ldNight: 2, rules: 'VFR', remarks: 'NVG night transit hem' },
    { date: isoDaysAgo(25), type: 'H125', reg: 'SE-JPO', dep: 'ESMS', depT: '07:45', arr: 'ESSA', arrT: '10:20', total: 2.6, pic: 2.6, co: 0, ifr: 0, night: 0, ldDay: 3, ldNight: 0, rules: 'VFR' },
    { date: isoDaysAgo(3), type: 'H125', reg: 'SE-JPO', dep: 'ESSA', depT: '09:00', arr: 'LAPN', arrT: '11:30', total: 2.5, pic: 2.5, co: 0, ifr: 0, night: 0, ldDay: 4, ldNight: 0, rules: 'VFR', flightType: 'touch_and_go', stopPlace: 'BKFJ', remarks: 'Underhåll stuga' },
  ];
  for (const f of plan) await insertMannedFlight(f);

  // Certificates for bushpilot
  await addCertificate({ cert_type: 'CPL', label: 'CPL(H)', issued_date: '2016-08-20', expires_date: '', notes: '' });
  await addCertificate({ cert_type: 'IR', label: 'IR(H)', issued_date: '2019-04-12', expires_date: isoDaysFromNow(90), notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'Bell 407', issued_date: isoDaysAgo(180), expires_date: isoDaysFromNow(185), notes: '' });
  await addCertificate({ cert_type: 'Type Rating', label: 'H125', issued_date: isoDaysAgo(300), expires_date: isoDaysFromNow(65), notes: 'Renewal due soon' });
  await addCertificate({ cert_type: 'Medical Class 1', label: '', issued_date: isoDaysAgo(100), expires_date: isoDaysFromNow(265), notes: '' });
  await addCertificate({ cert_type: 'Proficiency Check (PC)', label: 'B407', issued_date: isoDaysAgo(45), expires_date: isoDaysFromNow(320), notes: 'TRE: Capt Johansson' });
  await addCertificate({ cert_type: 'SEP', label: 'Single engine piston', issued_date: '2017-06-01', expires_date: isoDaysFromNow(400), notes: '' });
  await addCertificate({ cert_type: 'English Language Proficiency', label: 'Level 5', issued_date: '2023-01-10', expires_date: isoDaysFromNow(600), notes: '' });
  await addCertificate({ cert_type: 'CRM', label: '', issued_date: isoDaysAgo(250), expires_date: isoDaysFromNow(115), notes: '' });
}

export async function clearMannedTestUser() {
  await wipeMannedData();
}

// ── Operator test users ─────────────────────────────────────────────────────

interface OpFlight {
  date: string; type: string; reg: string; total: number; night: number;
  opData: Record<string, any>; remarks?: string;
}

async function insertOperatorFlight(f: OpFlight) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, flight_rules, flight_type,
      multi_pilot, single_pilot, instructor, nvg, stop_place,
      operator_data
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      f.date, f.type, f.reg,
      '', '', '', '',
      f.total, 0, f.night, 0, 0, 0,
      0, 0, f.remarks ?? '',
      'verified', 'manual', 'VFR', 'normal',
      0, 0, 0, 0, '',
      JSON.stringify(f.opData),
    ]
  );
}

// Crew Chief — 180 flights, ~620h, SAR/transport/CAS
export async function seedOperatorCrewChief() {
  await wipeMannedData();
  await addAircraftReg('HKP16', 'FM161', 140, 2.5, 'sp', 'helicopter', 'se');
  await addAircraftReg('HKP14', 'FM141', 155, 3.5, 'mp', 'helicopter', 'me');

  const flights: OpFlight[] = [
    { date: isoDaysAgo(340), type: 'HKP16', reg: 'FM161', total: 3.2, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'SAR', equipment: 'FLIR, Searchlight', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 }, remarks: 'SAR exercise Gotland' },
    { date: isoDaysAgo(310), type: 'HKP16', reg: 'FM161', total: 2.8, night: 1.2, opData: { role: 'crew-chief', seat_position: 'right', mission_type: 'Transport', equipment: 'NVG', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 }, remarks: 'Night troop transport' },
    { date: isoDaysAgo(280), type: 'HKP14', reg: 'FM141', total: 4.1, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: ['CAS'], equipment: ['Sensor'], weapon_category: ['mg'], weapon_type: 'Ksp 58', rounds_fired: '240', fire_bucket_drops: 0 }, remarks: 'Live fire exercise' },
    { date: isoDaysAgo(250), type: 'HKP16', reg: 'FM161', total: 1.8, night: 0, opData: { role: 'crew-chief', seat_position: 'rear', mission_type: 'FFO', equipment: 'Bambi bucket', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 8 }, remarks: 'Forest fire support Norrbotten' },
    { date: isoDaysAgo(220), type: 'HKP14', reg: 'FM141', total: 3.5, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: ['CAS'], equipment: ['Sensor'], weapon_category: ['mg'], weapon_type: 'Ksp 58', rounds_fired: '180', fire_bucket_drops: 0 } },
    { date: isoDaysAgo(190), type: 'HKP16', reg: 'FM161', total: 2.4, night: 2.4, opData: { role: 'crew-chief', seat_position: 'right', mission_type: 'CSAR', equipment: 'NVG, FLIR', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 }, remarks: 'Night CSAR exercise' },
    { date: isoDaysAgo(160), type: 'HKP16', reg: 'FM161', total: 1.5, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'Transport', equipment: '', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 } },
    { date: isoDaysAgo(130), type: 'HKP14', reg: 'FM141', total: 5.2, night: 1.8, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'ISTAR', equipment: 'Sensor suite, Datalink', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 }, remarks: 'ISR mission Baltic' },
    { date: isoDaysAgo(90), type: 'HKP16', reg: 'FM161', total: 2.1, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'FFO', equipment: 'Bambi bucket', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 12 }, remarks: 'Wildfire Jämtland' },
    { date: isoDaysAgo(60), type: 'HKP14', reg: 'FM141', total: 3.8, night: 0, opData: { role: 'crew-chief', seat_position: 'right', mission_type: ['CAS'], equipment: ['Sensor'], weapon_category: ['mg', 'precision'], weapon_type: 'Ksp 58, AG90', rounds_fired: '320', fire_bucket_drops: 0 }, remarks: 'Annual quals — Ksp 58 (200) + AG90 (120)' },
    { date: isoDaysAgo(30), type: 'HKP16', reg: 'FM161', total: 2.6, night: 1.0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'SAR', equipment: 'FLIR, Searchlight', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 } },
    { date: isoDaysAgo(14), type: 'HKP16', reg: 'FM161', total: 1.9, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: 'Transport', equipment: '', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 } },
    { date: isoDaysAgo(7), type: 'HKP14', reg: 'FM141', total: 4.5, night: 2.0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: ['CSAR'], equipment: ['NVG', 'FLIR'], weapon_category: ['mg'], weapon_type: 'Ksp 58', rounds_fired: '60', fire_bucket_drops: 0 }, remarks: 'Night CSAR with live fire' },
    { date: isoDaysAgo(4), type: 'HKP14', reg: 'FM141', total: 2.8, night: 0, opData: { role: 'crew-chief', seat_position: 'left', mission_type: ['CAS'], equipment: ['Sensor'], weapon_category: ['rocket'], weapon_type: 'HELLFIRE', rounds_fired: '4', fire_bucket_drops: 0 }, remarks: 'Live fire — HELLFIRE qualification' },
    { date: isoDaysAgo(1), type: 'HKP16', reg: 'FM161', total: 3.1, night: 0, opData: { role: 'crew-chief', seat_position: 'right', mission_type: ['CAS'], equipment: ['Sensor', 'FLIR'], weapon_category: ['mg', 'other'], weapon_type: 'Ksp 58, M3M', rounds_fired: '450', fire_bucket_drops: 0 }, remarks: 'Combined arms — Ksp 58 (300) + M3M (150)' },
    { date: isoDaysAgo(2), type: 'HKP16', reg: 'FM161', total: 2.2, night: 0, opData: { role: 'crew-chief', seat_position: 'right', mission_type: 'SAR', equipment: 'FLIR', weapon_system: '', rounds_fired: 0, fire_bucket_drops: 0 }, remarks: 'SAR standby Berga' },
  ];

  await insertSummary('HKP16', 380, 0, 0, 0, 45, isoDaysAgo(3600), 'Historical — 5 years crew chief HKP16');
  await insertSummary('HKP14', 200, 0, 0, 0, 30, isoDaysAgo(3600), 'Historical — 3 years crew chief HKP14');
  for (const f of flights) await insertOperatorFlight(f);
}

// Rescue Swimmer — 90 flights, ~280h, water rescue ops
export async function seedOperatorSwimmer() {
  await wipeMannedData();
  await addAircraftReg('HKP16', 'FM162', 140, 2.5, 'sp', 'helicopter', 'se');

  const flights: OpFlight[] = [
    { date: isoDaysAgo(300), type: 'HKP16', reg: 'FM162', total: 2.5, night: 0, opData: { role: 'swimmer', deployments: 2, deployment_type: ['rescue'], sea_state: '3', hoists_up: 2, hoists_down: 2, persons_rescued: 1, night_ops: false }, remarks: 'Man overboard Baltic' },
    { date: isoDaysAgo(260), type: 'HKP16', reg: 'FM162', total: 3.1, night: 0, opData: { role: 'swimmer', deployments: 4, deployment_type: ['training'], sea_state: '2', hoists_up: 4, hoists_down: 4, persons_rescued: 0, night_ops: false }, remarks: 'Quarterly training' },
    { date: isoDaysAgo(220), type: 'HKP16', reg: 'FM162', total: 2.8, night: 2.8, opData: { role: 'swimmer', deployments: 3, deployment_type: ['exercise'], sea_state: '4', hoists_up: 3, hoists_down: 3, persons_rescued: 0, night_ops: true }, remarks: 'Night exercise Baltic Fleet' },
    { date: isoDaysAgo(180), type: 'HKP16', reg: 'FM162', total: 1.5, night: 0, opData: { role: 'swimmer', deployments: 1, deployment_type: ['rescue'], sea_state: '5', hoists_up: 1, hoists_down: 1, persons_rescued: 2, night_ops: false }, remarks: 'Fishing vessel rescue' },
    { date: isoDaysAgo(140), type: 'HKP16', reg: 'FM162', total: 3.4, night: 0, opData: { role: 'swimmer', deployments: 6, deployment_type: ['training'], sea_state: '2', hoists_up: 6, hoists_down: 6, persons_rescued: 0, night_ops: false } },
    { date: isoDaysAgo(100), type: 'HKP16', reg: 'FM162', total: 2.2, night: 1.0, opData: { role: 'swimmer', deployments: 2, deployment_type: ['rescue'], sea_state: '3', hoists_up: 2, hoists_down: 2, persons_rescued: 3, night_ops: true }, remarks: 'Sailboat rescue, 3 POB' },
    { date: isoDaysAgo(60), type: 'HKP16', reg: 'FM162', total: 2.9, night: 0, opData: { role: 'swimmer', deployments: 5, deployment_type: ['exercise'], sea_state: '3', hoists_up: 5, hoists_down: 5, persons_rescued: 0, night_ops: false } },
    { date: isoDaysAgo(30), type: 'HKP16', reg: 'FM162', total: 1.8, night: 0, opData: { role: 'swimmer', deployments: 1, deployment_type: ['rescue'], sea_state: '4', hoists_up: 1, hoists_down: 1, persons_rescued: 1, night_ops: false }, remarks: 'Kayak rescue archipelago' },
    { date: isoDaysAgo(10), type: 'HKP16', reg: 'FM162', total: 3.0, night: 1.5, opData: { role: 'swimmer', deployments: 3, deployment_type: ['training', 'exercise'], sea_state: '2', hoists_up: 3, hoists_down: 3, persons_rescued: 0, night_ops: true } },
    { date: isoDaysAgo(3), type: 'HKP16', reg: 'FM162', total: 2.1, night: 0, opData: { role: 'swimmer', deployments: 2, deployment_type: ['training'], sea_state: '1', hoists_up: 2, hoists_down: 2, persons_rescued: 0, night_ops: false }, remarks: 'Refresher training' },
  ];

  await insertSummary('HKP16', 255, 0, 0, 0, 35, isoDaysAgo(3600), 'Historical — 6 years rescue swimmer');
  for (const f of flights) await insertOperatorFlight(f);
}

// HEMS Operator — 120 flights, ~340h
export async function seedOperatorHEMS() {
  await wipeMannedData();
  await addAircraftReg('EC135', 'SE-JHP', 137, 2.8, 'sp', 'helicopter', 'me');

  const flights: OpFlight[] = [
    { date: isoDaysAgo(280), type: 'EC135', reg: 'SE-JHP', total: 1.2, night: 0, opData: { role: 'hems', mission_type: ['primary'], patients: 1, priority: 'P1', hoists: 0, night_ops: false }, remarks: 'RTC E4 motorway' },
    { date: isoDaysAgo(250), type: 'EC135', reg: 'SE-JHP', total: 2.1, night: 0, opData: { role: 'hems', mission_type: ['iht'], patients: 1, priority: 'P1', hoists: 0, night_ops: false }, remarks: 'IHT Linköping → Karolinska' },
    { date: isoDaysAgo(220), type: 'EC135', reg: 'SE-JHP', total: 0.8, night: 0.8, opData: { role: 'hems', mission_type: ['primary'], patients: 1, priority: 'P2', hoists: 0, night_ops: true }, remarks: 'Cardiac arrest night call' },
    { date: isoDaysAgo(190), type: 'EC135', reg: 'SE-JHP', total: 1.5, night: 0, opData: { role: 'hems', mission_type: ['primary'], patients: 2, priority: 'P1', hoists: 0, night_ops: false }, remarks: 'Multi-casualty MVA' },
    { date: isoDaysAgo(160), type: 'EC135', reg: 'SE-JHP', total: 3.2, night: 0, opData: { role: 'hems', mission_type: ['sar'], patients: 1, priority: 'P2', hoists: 2, night_ops: false }, remarks: 'Hiker rescue mountain' },
    { date: isoDaysAgo(120), type: 'EC135', reg: 'SE-JHP', total: 1.0, night: 0, opData: { role: 'hems', mission_type: ['primary'], patients: 1, priority: 'P1', hoists: 0, night_ops: false } },
    { date: isoDaysAgo(90), type: 'EC135', reg: 'SE-JHP', total: 2.4, night: 0, opData: { role: 'hems', mission_type: ['secondary', 'iht'], patients: 1, priority: 'P2', hoists: 0, night_ops: false }, remarks: 'Neonatal transfer' },
    { date: isoDaysAgo(60), type: 'EC135', reg: 'SE-JHP', total: 1.1, night: 1.1, opData: { role: 'hems', mission_type: ['primary'], patients: 1, priority: 'P1', hoists: 0, night_ops: true }, remarks: 'Night primary, stroke' },
    { date: isoDaysAgo(30), type: 'EC135', reg: 'SE-JHP', total: 1.8, night: 0, opData: { role: 'hems', mission_type: ['primary'], patients: 1, priority: 'P3', hoists: 0, night_ops: false } },
    { date: isoDaysAgo(7), type: 'EC135', reg: 'SE-JHP', total: 2.6, night: 0, opData: { role: 'hems', mission_type: ['sar'], patients: 2, priority: 'P1', hoists: 1, night_ops: false }, remarks: 'SAR maritime, 2 casualties' },
  ];

  await insertSummary('EC135', 320, 0, 0, 0, 42, isoDaysAgo(3600), 'Historical — 7 years HEMS operator');
  for (const f of flights) await insertOperatorFlight(f);
}

export async function clearOperatorTestUser() {
  await wipeMannedData();
}
