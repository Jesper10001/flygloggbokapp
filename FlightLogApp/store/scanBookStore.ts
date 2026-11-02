import { create } from 'zustand';
import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getSetting, setSetting } from '../db/flights';
import { prepareSpread } from '../services/scanPrepare';
import { readLogbookFormat, saveScanFormat, loadScanFormat, deleteScanFormat, pageStep, type ScanFormat } from '../services/scanFormat';
import { MAX_SPREADS } from './scanStore';
import type { PageContext } from '../services/ocr';

// "Scan your whole logbook": alla uppslag läggs till på en gång. Varje foto förbereds direkt (boken letas upp,
// vrids, rätas och beskärs — services/scanPrepare) och sparas som fil i appens dokumentmapp, och formatet läses
// från första uppslaget (services/scanFormat). Sedan granskas boken i omgångar om MAX_SPREADS uppslag. Allt
// sparas på telefonen: stängs appen fortsätter man där man var, och en omgång som redan lästs kostar inga nya
// coins (Claudes läsning sparas per foto).
//
// Förberedelsen och formatläsningen körs här (inte i skärmen), så att de fortsätter om man lämnar skärmen.

export const SESSION_SIZE = MAX_SPREADS;
const KEY = 'scan_book_project';
const ROOT = `${FileSystem.documentDirectory}scan-book/`;

export interface BookPhoto {
  id: string;
  status: 'waiting' | 'preparing' | 'ready' | 'failed';
  source?: string;          // väljarens/kamerans fil tills fotot förberetts
  srcW?: number;
  srcH?: number;
  cropped?: boolean;        // kamerans foton är redan beskurna och rättvända
  w: number;                // den förberedda bilden
  h: number;
  found?: boolean;          // boken hittades i fotot (annars läses hela fotot)
  savedIn?: number;         // omgången fotot sparades i (filerna är då borttagna, miniatyren kvar)
}

export interface ScanBookProject {
  id: string;
  createdAt: string;
  photos: BookPhoto[];
  formatId: string | null;
  firstPage: number | null;   // bokens första sida
  lastPage: number | null;    // sista sidan man skrivit på
  lastContext?: PageContext;  // sista flygningen i förra omgången (ditto på nästa omgångs första rad)
  sessionsSaved: number;
  flightsSaved: number;
}

export interface BookSession {
  number: number;           // 1…
  photos: BookPhoto[];
  start: number;            // index i projektets foton
  saved: boolean;
}

// Filerna per foto.
export const photoFile = (p: { id: string }, ph: { id: string }) => `${ROOT}${p.id}/${ph.id}.jpg`;
export const thumbFile = (p: { id: string }, ph: { id: string }) => `${ROOT}${p.id}/${ph.id}.t.jpg`;
export const wordsFile = (p: { id: string }, ph: { id: string }) => `${ROOT}${p.id}/${ph.id}.w.json`;
export const readFile = (p: { id: string }, ph: { id: string }) => `${ROOT}${p.id}/${ph.id}.r.json`;

/** Omgångarna: sparade foton som de sparades, resten i ordning, högst SESSION_SIZE per omgång. */
export function sessionsOf(photos: BookPhoto[]): BookSession[] {
  const out: BookSession[] = [];
  photos.forEach((ph, i) => {
    const last = out[out.length - 1];
    const saved = ph.savedIn != null;
    const fits = last && last.saved === saved && (saved ? last.photos[0].savedIn === ph.savedIn : last.photos.length < SESSION_SIZE);
    if (fits) last.photos.push(ph);
    else out.push({ number: out.length + 1, photos: [ph], start: i, saved });
  });
  return out;
}

/** Sidnumren fotot nummer i bör ha: räknat från första uppslagets tryckta nummer (formatet), annars första sidan. */
export function expectedPages(p: ScanBookProject, format: ScanFormat | null, i: number): { left: number; right: number | null } | null {
  const anchor = format?.pageNumbers.left ?? p.firstPage;
  if (anchor == null) return null;
  const step = pageStep(format);
  const left = anchor + i * step;
  return { left, right: step === 1 ? left : left + 1 };
}

/** Bokens första och sista uppslag (vänster sida) för pappersbokens lista, ur sidspannet. */
export function ledgerRange(p: ScanBookProject, format: ScanFormat | null): { start: number | null; latest: number | null } {
  if (p.firstPage == null || p.lastPage == null) return { start: p.firstPage, latest: null };
  const step = pageStep(format);
  const anchor = format?.pageNumbers.left ?? p.firstPage;
  // Vänstersidorna har samma udda/jämna som första uppslagets vänstersida.
  const latest = step === 1 ? p.lastPage : (Math.abs(p.lastPage - anchor) % 2 === 0 ? p.lastPage : p.lastPage - 1);
  // Börjar boken på en högersida (sida 1 när vänstersidorna är jämna) är första hela uppslaget nästa.
  const start = step === 1 ? p.firstPage : (Math.abs(p.firstPage - anchor) % 2 === 0 ? p.firstPage : p.firstPage + 1);
  return { start, latest };
}

type FormatStatus = 'idle' | 'reading' | 'error';

interface State {
  loaded: boolean;
  project: ScanBookProject | null;
  format: ScanFormat | null;
  formatStatus: FormatStatus;
  formatError: string | null;
  load: () => Promise<void>;
  addPhotos: (list: { uri: string; width: number; height: number; cropped?: boolean }[]) => Promise<void>;
  removePhoto: (id: string) => Promise<void>;
  movePhoto: (id: string, by: -1 | 1) => Promise<void>;
  setPages: (first: number | null, last: number | null) => Promise<void>;
  readFormat: (photoId?: string) => Promise<void>;
  sessionSaved: (photoIds: string[], flights: number, ctx: PageContext | undefined) => Promise<void>;
  discard: () => Promise<void>;
}

const persist = (p: ScanBookProject | null) => setSetting(KEY, p ? JSON.stringify(p) : '').catch(() => {});
const del = (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

let preparing = false;

const sizeOf = (uri: string) => new Promise<{ w: number; h: number }>((res, rej) => Image.getSize(uri, (w, h) => res({ w, h }), rej));

export const useScanBookStore = create<State>((set, get) => {
  const update = (fn: (p: ScanBookProject) => ScanBookProject) => {
    const cur = get().project;
    if (!cur) return;
    const next = fn(cur);
    set({ project: next });
    persist(next);
  };
  const patchPhoto = (id: string, patch: Partial<BookPhoto>) =>
    update((p) => ({ ...p, photos: p.photos.map((ph) => (ph.id === id ? { ...ph, ...patch } : ph)) }));

  // Fotona förbereds ett i taget (minnet: en bild åt gången). Första färdiga uppslaget → formatet läses.
  const runQueue = async () => {
    if (preparing) return;
    preparing = true;
    try {
      for (;;) {
        const p = get().project;
        const ph = p?.photos.find((x) => x.status === 'waiting');
        if (!p || !ph) break;
        patchPhoto(ph.id, { status: 'preparing' });
        try {
          if (!ph.source || !(await FileSystem.getInfoAsync(ph.source)).exists) throw new Error('missing');
          const size = ph.srcW && ph.srcH ? { w: ph.srcW, h: ph.srcH } : await sizeOf(ph.source);
          const out = await prepareSpread({ uri: ph.source, width: size.w, height: size.h, cropped: ph.cropped, oriented: ph.cropped });
          await FileSystem.makeDirectoryAsync(`${ROOT}${p.id}/`, { intermediates: true }).catch(() => {});
          const dest = photoFile(p, ph);
          if (out.uri === ph.source) await FileSystem.copyAsync({ from: out.uri, to: dest });
          else await FileSystem.moveAsync({ from: out.uri, to: dest });
          await FileSystem.writeAsStringAsync(wordsFile(p, ph), JSON.stringify(out.words));
          const thumb = await ImageManipulator.manipulateAsync(dest, [{ resize: { width: 240 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
          await FileSystem.moveAsync({ from: thumb.uri, to: thumbFile(p, ph) });
          // Väljarens och kamerans kopior ligger i cachen och behövs inte längre.
          if (ph.source.startsWith(FileSystem.cacheDirectory ?? '#')) del(ph.source);
          // Fotot kan ha tagits bort medan det förbereddes.
          if (!get().project?.photos.some((x) => x.id === ph.id)) { [dest, wordsFile(p, ph), thumbFile(p, ph)].forEach(del); continue; }
          patchPhoto(ph.id, { status: 'ready', source: undefined, w: out.width, h: out.height, found: out.found });
          console.log(`[SCAN] Helbok: foto ${get().project!.photos.findIndex((x) => x.id === ph.id) + 1} förberett${out.found ? '' : ' (boken hittades inte, hela fotot)'}`);
        } catch (e) {
          console.warn('[SCAN] Helbok: kunde inte förbereda fotot', e);
          patchPhoto(ph.id, { status: 'failed' });
        }
        maybeReadFormat();
      }
    } finally {
      preparing = false;
    }
  };

  const maybeReadFormat = () => {
    const { project, formatStatus } = get();
    if (!project || project.formatId || formatStatus !== 'idle') return;
    const first = project.photos.find((x) => x.status === 'ready');
    if (first) get().readFormat(first.id).catch(() => {});
  };

  return {
    loaded: false,
    project: null,
    format: null,
    formatStatus: 'idle',
    formatError: null,

    load: async () => {
      // Läses en gång; sedan är minnet sanningen (förberedelsen och granskningen uppdaterar här och sparar).
      if (get().loaded) { runQueue(); maybeReadFormat(); return; }
      let p: ScanBookProject | null = null;
      try { p = JSON.parse((await getSetting(KEY)) || 'null'); } catch { p = null; }
      // Avbruten förberedelse (appen stängdes): fortsätt med de foton vars original finns kvar.
      if (p) p = { ...p, photos: p.photos.map((ph) => (ph.status === 'preparing' ? { ...ph, status: 'waiting' as const } : ph)) };
      set({ loaded: true, project: p, format: await loadScanFormat(p?.formatId) });
      if (p) { runQueue(); maybeReadFormat(); }
    },

    addPhotos: async (list) => {
      let p = get().project;
      if (!p) {
        p = { id: `book_${Date.now().toString(36)}`, createdAt: new Date().toISOString(), photos: [], formatId: null, firstPage: null, lastPage: null, sessionsSaved: 0, flightsSaved: 0 };
        set({ project: p, format: null, formatStatus: 'idle', formatError: null });
      }
      const stamp = Date.now().toString(36);
      const added: BookPhoto[] = list.map((a, i) => ({
        id: `${stamp}${i.toString(36).padStart(2, '0')}`, status: 'waiting', source: a.uri, srcW: a.width, srcH: a.height, cropped: a.cropped, w: 0, h: 0,
      }));
      update((cur) => ({ ...cur, photos: [...cur.photos, ...added] }));
      runQueue();
    },

    removePhoto: async (id) => {
      const p = get().project;
      const ph = p?.photos.find((x) => x.id === id);
      if (!p || !ph || ph.savedIn != null) return;
      [photoFile(p, ph), thumbFile(p, ph), wordsFile(p, ph), readFile(p, ph)].forEach(del);
      if (ph.source?.startsWith(FileSystem.cacheDirectory ?? '#')) del(ph.source);
      update((cur) => ({ ...cur, photos: cur.photos.filter((x) => x.id !== id) }));
    },

    movePhoto: async (id, by) => {
      update((cur) => {
        const i = cur.photos.findIndex((x) => x.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= cur.photos.length || cur.photos[i].savedIn != null || cur.photos[j].savedIn != null) return cur;
        const photos = cur.photos.slice();
        [photos[i], photos[j]] = [photos[j], photos[i]];
        // Claudes sparade läsning hör till fotot och följer med; sidnumren räknas efter platsen.
        return { ...cur, photos };
      });
    },

    setPages: async (first, last) => { update((cur) => ({ ...cur, firstPage: first, lastPage: last })); },

    readFormat: async (photoId) => {
      const p = get().project;
      const ph = p?.photos.find((x) => x.id === (photoId ?? p.photos.find((y) => y.status === 'ready')?.id));
      if (!p || !ph || ph.status !== 'ready') return;
      set({ formatStatus: 'reading', formatError: null });
      try {
        const f = await readLogbookFormat(photoFile(p, ph));
        await saveScanFormat(f);
        const old = get().project?.formatId;
        if (old && old !== f.id) deleteScanFormat(old).catch(() => {});
        update((cur) => ({ ...cur, formatId: f.id }));
        set({ format: f, formatStatus: 'idle' });
      } catch (e: any) {
        set({ formatStatus: 'error', formatError: e?.message ?? "Couldn't read the format." });
      }
    },

    // En omgång sparad i granskningen: fotona markeras som sparade (bilderna, orden och läsningen raderas,
    // miniatyren finns kvar) och sista flygningen följer med till nästa omgång.
    sessionSaved: async (photoIds, flights, ctx) => {
      const p = get().project;
      if (!p) return;
      const n = p.sessionsSaved + 1;
      for (const ph of p.photos) if (photoIds.includes(ph.id)) [photoFile(p, ph), wordsFile(p, ph), readFile(p, ph)].forEach(del);
      update((cur) => ({
        ...cur,
        photos: cur.photos.map((ph) => (photoIds.includes(ph.id) ? { ...ph, savedIn: n } : ph)),
        sessionsSaved: n, flightsSaved: cur.flightsSaved + flights,
        ...(ctx ? { lastContext: ctx } : {}),
      }));
    },

    discard: async () => {
      const p = get().project;
      if (p) {
        await FileSystem.deleteAsync(`${ROOT}${p.id}/`, { idempotent: true }).catch(() => {});
        for (const ph of p.photos) if (ph.source?.startsWith(FileSystem.cacheDirectory ?? '#')) del(ph.source);
        if (p.formatId) deleteScanFormat(p.formatId).catch(() => {});
      }
      set({ project: null, format: null, formatStatus: 'idle', formatError: null });
      persist(null);
    },
  };
});
