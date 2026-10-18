// Jordglobens bibliotek (globe.gl 2.34.4) + jordtexturer (ur three-globe 2.45.6, båda MIT) buntas i
// appen → globen fungerar offline och anropar ingen CDN (unpkg). Laddas EN gång per session och delas
// av pilot- och drönarglobens WebView: biblioteket bäddas in som inline-script och texturerna som
// data-URI:er (WebGL får läsa dem utan CORS-problem, vilket file://-adresser inte garanterar).
import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

export type GlobeAssets = { lib: string; night: string; bump: string };

async function localUri(moduleRef: number): Promise<string> {
  const asset = Asset.fromModule(moduleRef);
  if (!asset.downloaded) await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
}
const readText = async (moduleRef: number) => FileSystem.readAsStringAsync(await localUri(moduleRef));
const readDataUri = async (moduleRef: number, mime: string) =>
  `data:${mime};base64,${await FileSystem.readAsStringAsync(await localUri(moduleRef), { encoding: FileSystem.EncodingType.Base64 })}`;

let cache: Promise<GlobeAssets> | null = null;

export function loadGlobeAssets(): Promise<GlobeAssets> {
  if (!cache) {
    cache = Promise.all([
      readText(require('../assets/globe/globe-gl-2.34.4.dat')),
      readDataUri(require('../assets/globe/earth-night.jpg'), 'image/jpeg'),
      readDataUri(require('../assets/globe/earth-topology.jpg'), 'image/jpeg'),
    ])
      // "</script" i biblioteket skulle avsluta inline-scriptet i förtid (finns inte i 2.34.4, men skydda ändå).
      .then(([lib, night, bump]) => ({ lib: lib.replace(/<\/script/gi, '<\\/script'), night, bump }))
      .catch((e) => { cache = null; throw e; }); // nästa montering försöker igen
  }
  return cache;
}

/** null tills biblioteket och texturerna är inlästa (cachat efter första gången). */
export function useGlobeAssets(): GlobeAssets | null {
  const [assets, setAssets] = useState<GlobeAssets | null>(null);
  useEffect(() => {
    let alive = true;
    loadGlobeAssets()
      .then((a) => { if (alive) setAssets(a); })
      .catch((e) => console.warn('[globe] kunde inte läsa globens filer:', e?.message ?? e));
    return () => { alive = false; };
  }, []);
  return assets;
}
