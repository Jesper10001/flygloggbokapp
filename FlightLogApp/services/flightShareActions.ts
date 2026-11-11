// Avsändarens och mottagarens handgrepp runt services/flightShare (som är en ren modul): dela som länk eller
// fil, och öppna en delad flygning ur en fil. All delning går via services/shareFile (delningsrutan köar
// appens egna popup-rutor medan den är uppe).
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { getSetting } from '../db/flights';
import { shareFileAsync, shareUrlAsync } from './shareFile';
import { buildSharePayload, toShareLink, toShareFileText, shareFileName, shareTitle, decodeSharedFlight, type SharedPayload, type DecodeResult } from './flightShare';

/** Avsändarens namn ur profilen. Tomt namn → null (appen ber då om ett namn först). */
export async function getShareSender(): Promise<{ name: string; initials: string } | null> {
  const first = ((await getSetting('profile_first_name').catch(() => '')) ?? '').trim();
  const last = ((await getSetting('profile_last_name').catch(() => '')) ?? '').trim();
  const initials = ((await getSetting('profile_initials').catch(() => '')) ?? '').trim();
  const name = `${first} ${last}`.trim();
  if (!name && !initials) return null;
  return { name: name || initials, initials };
}

export async function payloadForFlight(flight: Record<string, any>): Promise<SharedPayload | null> {
  const sender = await getShareSender();
  return sender ? buildSharePayload(flight, sender) : null;
}

/** Delningsrutan med flygningen som länk: AirDrop öppnar den direkt i Blades hos mottagaren. */
export async function shareFlightLink(p: SharedPayload): Promise<void> {
  await shareUrlAsync(toShareLink(p), shareTitle(p));
}

/** Delningsrutan med flygningen som fil (.bladesflight): ger bland annat "Save to Files". */
export async function shareFlightFile(p: SharedPayload): Promise<void> {
  const path = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory) + shareFileName(p);
  await FileSystem.writeAsStringAsync(path, toShareFileText(p), { encoding: FileSystem.EncodingType.UTF8 });
  await shareFileAsync(path, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Blades flight' });
}

/** Välj en fil och läs flygningen ur den. null = användaren avbröt. */
export async function pickSharedFlightFile(): Promise<DecodeResult | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  if ((a.size ?? 0) > 100000) return { ok: false, reason: 'unreadable' };
  try {
    const text = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.UTF8 });
    return decodeSharedFlight(text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
