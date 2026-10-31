// AI-kostnad per anrop — delas av appens proxy (index.ts) och Ops-assistenten (ops.ts), så att telemetrin
// räknar likadant oavsett varifrån anropet kommer.

// USD per miljon tokens (indata, utdata) enligt Anthropics prislista 2026-10-26 → telemetrins kostnad följer
// modellen som faktiskt svarade. Okänd modell → Sonnet 4.6-pris.
const MODEL_PRICES: [RegExp, number, number][] = [
  [/^claude-haiku-5-5/, 0.1, 0.5], [/^claude-haiku-4-5/, 1, 5],
  [/^claude-sonnet-5/, 2, 10], [/^claude-sonnet-4/, 3, 15],
  [/^claude-opus-5-5/, 4, 20], [/^claude-opus-[45]/, 5, 25],
  [/^claude-fable/, 10, 50],
];

// Cachade systemprompter faktureras separat: skrivning 1,25× och läsning 0,1× av indatapriset. De ingår
// inte i input_tokens, så de måste räknas in här — annars visar telemetrin ungefär hälften av kostnaden.
export function costUsd(model: string, inTok: number, outTok: number, cacheWrite = 0, cacheRead = 0): number {
  const [, pin, pout] = MODEL_PRICES.find(([re]) => re.test(model)) ?? [null, 3, 15];
  return Math.round(((inTok * pin + cacheWrite * pin * 1.25 + cacheRead * pin * 0.1 + outTok * pout) / 1e6) * 10000) / 10000;
}
