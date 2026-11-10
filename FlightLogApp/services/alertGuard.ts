// Systemrutor (Alert.alert) som väntar medan en karta eller delningsrutan är öppen. Appen visar sådana rutor från
// många ställen, flera från bakgrundsjobb (coins slut, en hämtning som misslyckats), och en ruta som öppnas ovanpå
// kartans fönster eller delningsrutan kan låsa skärmen på iOS. I stället för att ändra varje ställe byts
// Alert.alert ut EN gång här: rutan köas och visas strax efter att kartan eller delningsrutan stängts.
// alertNow visar direkt, för en ruta som användaren själv just bett om inne i kartan (t.ex. Delete flight).

import { Alert } from 'react-native';
import { useMapScreenStore } from '../store/mapScreenStore';
import { useShareSheetStore } from './shareFile';

type Args = Parameters<typeof Alert.alert>;
const original = Alert.alert.bind(Alert);
const queue: Args[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const busy = () => useMapScreenStore.getState().open || useShareSheetStore.getState().open;

function flush() {
  if (timer || !queue.length || busy()) return;
  timer = setTimeout(() => {
    timer = null;
    if (busy()) return; // öppnades igen under väntan: nästa stängning försöker på nytt
    const next = queue.shift();
    if (next) original(...next);
    flush();
  }, 400);
}

export const alertNow: typeof Alert.alert = (...args) => original(...args);

let installed = false;
export function installAlertGuard(): void {
  if (installed) return;
  installed = true;
  Alert.alert = (...args: Args) => {
    if (busy()) { queue.push(args); return; }
    original(...args);
  };
  useMapScreenStore.subscribe(flush);
  useShareSheetStore.subscribe(flush);
}
