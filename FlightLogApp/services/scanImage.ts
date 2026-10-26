// Gemensam bildförberedelse för AI-skanning (ACARS/Instrument scan, drönarens flyglogg-scan): skala ned
// (aldrig upp) så långsidan ≤ 1568 px — Claude skalar ändå ner större bilder, så mer ger bara längre
// uppladdning — och koda som JPEG/base64. Små skärmdumpar skickas i originalstorlek.
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

const LONG_EDGE = 1568;

export async function prepareScanImage(uri: string): Promise<string> {
  const probe = await ImageManipulator.manipulateAsync(uri, [], { format: ImageManipulator.SaveFormat.JPEG, compress: 1 });
  const long = Math.max(probe.width, probe.height);
  const actions = long > LONG_EDGE
    ? [{ resize: probe.width >= probe.height ? { width: LONG_EDGE } : { height: LONG_EDGE } }]
    : [];
  const out = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG });
  return FileSystem.readAsStringAsync(out.uri, { encoding: FileSystem.EncodingType.Base64 });
}
