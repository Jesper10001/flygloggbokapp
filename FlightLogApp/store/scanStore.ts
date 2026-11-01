// Buffer för OCR-bilder — stöder enkel skanning (1 bild) och batch (2–5 bilder)

export interface ScanImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png';
  width?: number;    // px — granskningsvyn ritar rutor i bildens koordinater
  height?: number;
  cropped?: boolean; // redan beskuren till boken (kameran/dokumentskannern) — annars letar granskningen upp boken
  oriented?: boolean; // rättvänd (Blades kamera vet hur telefonen hölls) — annars prövas 90°/270°
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
  pendingImages = images.slice(0, 5);
}

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
export function setScanSources(list: ScanSource[]) { sources = list.slice(0, 5); }
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
