// Systemrutor (Alert.alert) som väntar medan en karta eller delningsrutan är öppen. Appen visar sådana rutor från
// många ställen, flera från bakgrundsjobb (coins slut, en hämtning som misslyckats), och en ruta som öppnas ovanpå
// kartans fönster eller delningsrutan kan låsa skärmen på iOS. I stället för att ändra varje ställe byts
// Alert.alert ut EN gång här: rutan köas och visas strax efter att kartan eller delningsrutan stängts.
// alertNow visar direkt, för en ruta som användaren själv just bett om inne i kartan (t.ex. Delete flight).

//
// Systemrutan räknas också själv: medan en Alert syns (och en kort stund efter) väntar appens egna rutor
// (GlassDialog, t.ex. "Fleet updated" när bakgrundshämtningen blir klar mitt i "Saved"). En Modal som öppnas
// medan en systemruta syns kan på iOS bli osynlig men ändå ta alla tryck — hela appen känns fryst.

import { Alert } from 'react-native';
import { create } from 'zustand';
import { useMapScreenStore } from '../store/mapScreenStore';
import { useShareSheetStore } from './shareFile';

type Args = Parameters<typeof Alert.alert>;
const rawAlert = Alert.alert.bind(Alert);

/** Syns en systemruta (Alert) just nu, eller stängdes den nyss? */
export const useSystemAlertStore = create<{ open: boolean }>(() => ({ open: false }));
const RELEASE_MS = 550;   // systemrutan glider undan en stund efter tryck
let openCount = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
// Skyddsnät: säger en systemruta aldrig till att den stängts (visades den alls?) släpps spärren efter en stund,
// så att appens rutor aldrig väntar för evigt.
const MAX_HOLD_MS = 45000;
let failsafe: ReturnType<typeof setTimeout> | null = null;
const markOpen = () => {
  openCount++;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
  if (failsafe) clearTimeout(failsafe);
  failsafe = setTimeout(() => { failsafe = null; openCount = 0; useSystemAlertStore.setState({ open: false }); }, MAX_HOLD_MS);
  useSystemAlertStore.setState({ open: true });
};
const markClosed = () => {
  openCount = Math.max(0, openCount - 1);
  if (openCount > 0) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  if (failsafe) { clearTimeout(failsafe); failsafe = null; }
  releaseTimer = setTimeout(() => { releaseTimer = null; if (openCount === 0) useSystemAlertStore.setState({ open: false }); }, RELEASE_MS);
};
// Systemrutan med knappar som säger till när den stängs. Utan knappar visar iOS en OK-knapp — samma här.
const original = (...args: Args) => {
  const [title, message, buttons, options] = args;
  const list = buttons && buttons.length ? buttons : [{ text: 'OK' }];
  let closed = false;
  const close = () => { if (!closed) { closed = true; markClosed(); } };
  const wrapped = list.map((b) => ({ ...b, onPress: (v?: string) => { close(); b.onPress?.(v as any); } }));
  markOpen();
  try {
    rawAlert(title, message, wrapped, { ...(options ?? {}), onDismiss: () => { close(); options?.onDismiss?.(); } });
  } catch (e) { close(); throw e; }
};
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
