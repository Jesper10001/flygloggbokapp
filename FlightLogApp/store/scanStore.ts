import * as Updates from 'expo-updates';
import type { PageContext } from '../services/ocr';

// Buffer för OCR-bilder — stöder enkel skanning (1 bild) och batch (upp till MAX_SPREADS bilder)

// Högst så många uppslag per skanning (kameran, fotoväljaren, granskningen). En hel bok delas upp i omgångar
// om lika många i "Scan your whole logbook" (app/import/scan-book).
export const MAX_SPREADS = 10;
// Gratisanvändare: högst så många uppslag per skanning. Engångspotten är 100 Blade coins, ett uppslag kostar
// 25–33 coins med gratisnivåns taxa och varje ny flygplanstyp ca 6 (uppslag + Fleet-data). Två uppslag lämnar
// coins kvar att prova resten av appen med; tre kan tömma potten innan typerna hunnit slås upp.
export const FREE_SPREADS = 2;
export const spreadLimit = (paying: boolean) => (paying ? MAX_SPREADS : FREE_SPREADS);
// Testbygge: dev-builden eller TestFlight-bygget (kanalen preview, bara din telefon). Aldrig App Store-bygget.
export const TEST_BUILD = __DEV__ || Updates.channel === 'preview';
// Skanningen av pappersloggboken är pausad i App Store-bygget ("coming soon") men öppen i testbyggena medan den
// testas. Byt till true när den ska lanseras.
export const SCAN_OPEN = TEST_BUILD;

export interface ScanImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png';
  width?: number;    // px — granskningsvyn ritar rutor i bildens koordinater
  height?: number;
  cropped?: boolean; // redan beskuren till boken (kameran/dokumentskannern) — annars letar granskningen upp boken
  oriented?: boolean; // rättvänd (Blades kamera vet hur telefonen hölls) — annars prövas 90°/270°
  sourceUri?: string; // foto ur biblioteket som inte förberetts än (base64 tom): granskningen förbereder det
                      // själv, så att läsningsskärmen syns direkt efter valet
  // Redan förberett i "Scan your whole logbook" (vridet, rätat, beskuret): bilden som fil, Visions ord, var
  // Claudes läsning sparas (läses inte om, och kostar inga nya coins, om omgången öppnas igen) och vilka
  // sidnummer uppslaget bör ha (om Claude inte läser dem).
  prepared?: { uri: string; wordsUri: string; readUri: string; expected?: { left: number; right: number | null } };
}

let pendingImages: ScanImage[] = [];

// Enkel bild (bakåtkompatibel med befintlig flow)
export function setScanImage(base64: string, mediaType: 'image/jpeg' | 'image/png') {
  pendingImages = [{ base64, mediaType }];
}

export function getScanImage(): ScanImage | null {
  return pendingImages[0] ?? null;
}

export function clearScanImage() {
  pendingImages = [];
}

// Batch — flera bilder
export function setScanBatch(images: ScanImage[]) {
  pendingImages = images.slice(0, MAX_SPREADS);
}

// En omgång i "Scan your whole logbook": vilka foton, bokens format (id i scanFormat) och sista flygningen
// från förra omgången (ditto-tecken på första raden). ledger = bokens första och sista uppslag (vänster sida)
// för pappersbokens lista. Läses och töms av granskningen.
export interface ScanBookSession {
  projectId: string;
  photoIds: string[];
  formatId: string | null;
  ctx?: PageContext;
  ledger?: { start: number | null; latest: number | null };
}
// Skanningen startades från onboardingen: efter Save går man till dashboarden, inte tillbaka dit.
let fromOnboarding = false;
export function setScanFromOnboarding(v: boolean) { fromOnboarding = v; }
export function getScanFromOnboarding(): boolean { return fromOnboarding; }
let bookSession: ScanBookSession | null = null;
export function setScanBookSession(s: ScanBookSession | null) { bookSession = s; }
export function takeScanBookSession(): ScanBookSession | null { const s = bookSession; bookSession = null; return s; }

export function getScanBatch(): ScanImage[] {
  return [...pendingImages];
}

export function getScanBatchSize(): number {
  return pendingImages.length;
}

// Har användaren en loggbok i appen frågar skanningen om den fotade boken har samma upplägg. Ja → skannern
// får bokens kolumnlista; nej → Claude läser kolumnerna fritt.
let useBookLayout = true;
export function setScanUseBookLayout(v: boolean) { useBookLayout = v; }
export function getScanUseBookLayout(): boolean { return useBookLayout; }

// Original-foton ur kamerarullen som ska beskäras och vridas i "Frame the logbook" (app/import/scan-crop)
// innan de läses. Full upplösning — beskärningen görs från originalet.
export interface ScanSource { uri: string; width: number; height: number }
let sources: ScanSource[] = [];
export function setScanSources(list: ScanSource[]) { sources = list.slice(0, MAX_SPREADS); }
export function getScanSources(): ScanSource[] { return [...sources]; }

// Tiderna i den fotade boken: UTC eller lokal tid. Lokal räknas om till UTC per flygplats när raderna sparas.
// Senaste valet sparas i settings (scan_time_basis) av skärmarna.
export type TimeBasis = 'utc' | 'local';
let timeBasis: TimeBasis = 'utc';
export function setScanTimeBasis(b: TimeBasis) { timeBasis = b; }
export function getScanTimeBasis(): TimeBasis { return timeBasis; }

// Vad som är viktigt för användaren (väljs på startsidan, sparas i settings scan_focus). Styr hur många
// frågor granskningen ställer och vad Claude lägger kraft på:
//  exact    – varje flygning ska stämma exakt med boken
//  balanced – flygningarna i huvudsak, summorna exakt
//  totals   – bara summorna
export type ScanFocus = 'exact' | 'balanced' | 'totals';
let focus: ScanFocus = 'exact';
export function setScanFocus(f: ScanFocus) { focus = f; }
export function getScanFocus(): ScanFocus { return focus; }
