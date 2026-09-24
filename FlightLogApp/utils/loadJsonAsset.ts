// Laddar en STOR JSON som buntad ASSET (fil) i stället för require()-inlining.
// En flera-MB JSON via require() blir ett gigantiskt objekt-literal som Hermes i SDK 57
// (RN 0.86) inte klarar bytecode-kompilera → require() kastar och datan blir otillgänglig.
// Som asset läses filen i stället som text och JSON.parse:as i runtime (ingen bytecode-blowup).
// Filen måste ha en extension som ligger i metro.config assetExts (t.ex. .dat).
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

export async function loadJsonAsset<T>(moduleRef: number): Promise<T> {
  const asset = Asset.fromModule(moduleRef);
  if (!asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const text = await FileSystem.readAsStringAsync(uri);
  return JSON.parse(text) as T;
}
