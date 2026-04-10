// Enkel global buffer för OCR-bilden — undviker URI-problem via router-params
let pendingImageBase64: string | null = null;
let pendingMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg';

export function setScanImage(base64: string, mediaType: 'image/jpeg' | 'image/png') {
  pendingImageBase64 = base64;
  pendingMediaType = mediaType;
}

export function getScanImage(): { base64: string; mediaType: 'image/jpeg' | 'image/png' } | null {
  if (!pendingImageBase64) return null;
  return { base64: pendingImageBase64, mediaType: pendingMediaType };
}

export function clearScanImage() {
  pendingImageBase64 = null;
}
