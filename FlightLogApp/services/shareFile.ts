// Delningsrutan (iOS UIActivityViewController) för allt appen exporterar och delar. Medan den är uppe väntar appens
// egna popup-rutor (GlassDialog, t.ex. "Update ready" när en EAS-uppdatering hämtats klart): en native Modal som
// öppnas ovanpå delningsrutan kan låsa hela skärmen, samma sak som ovanpå kartorna. Rutan öppnas först när
// pågående animationer och tryck är klara, så att den inte krockar med en ruta som håller på att stängas.

import { InteractionManager } from 'react-native';
import * as Sharing from 'expo-sharing';
import { create } from 'zustand';

export const useShareSheetStore = create<{ open: boolean }>(() => ({ open: false }));

export async function shareFileAsync(url: string, options: Sharing.SharingOptions = {}): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  await new Promise<void>((resolve) => { InteractionManager.runAfterInteractions(() => resolve()); });
  useShareSheetStore.setState({ open: true });
  try {
    await Sharing.shareAsync(url, options);
  } finally {
    useShareSheetStore.setState({ open: false });
  }
}
