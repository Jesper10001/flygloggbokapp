// Buffer för OCR-bilder — stöder enkel skanning (1 bild) och batch (2–5 bilder)

interface ScanImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png';
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
