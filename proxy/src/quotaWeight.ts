// Hur mycket ett anrop drar från användarens Blade coins (1 coin = 200 tokens). Skanning av loggbok gav tidigare
// Premium och Max halva taxan (0.5); sedan 2026-11-08 betalar alla full taxa även vid skanning, så vikten är 1.
// Igenkänningen nedan ligger kvar så att en skanningstaxa kan slås på igen genom att ändra SCAN_QUOTA_WEIGHT.
//
// Skanningen känns igen på själva anropet, inte på en header från appen, så att en lägre taxa inte kan
// användas för annat: verktyget emit_flights är tvingat (tool_choice), det är det enda verktyget, anropet
// innehåller en bild och svaret har ett tak. Svaret måste då följa skanningens schema.

export const SCAN_QUOTA_WEIGHT = 1;
const SCAN_TOOL = 'emit_flights';
const SCAN_MAX_TOKENS = 16000;

export function quotaWeight(body: any, tier = 'free'): number {
  if (tier === 'free') return 1; // Premium och Max får skanningstaxan
  try {
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const forced = body?.tool_choice?.type === 'tool' && body?.tool_choice?.name === SCAN_TOOL;
    const onlyScanTool = tools.length === 1 && tools[0]?.name === SCAN_TOOL;
    const hasImage = Array.isArray(body?.messages) && body.messages.some((m: any) =>
      Array.isArray(m?.content) && m.content.some((c: any) => c?.type === 'image'));
    const max = Number(body?.max_tokens);
    const capped = max > 0 && max <= SCAN_MAX_TOKENS;
    return forced && onlyScanTool && hasImage && capped ? SCAN_QUOTA_WEIGHT : 1;
  } catch {
    return 1;
  }
}

/** Tokens som dras från kvoten för ett anrop (avrundat uppåt). */
export function quotaTokens(body: any, inTok: number, outTok: number, tier = 'free'): number {
  return Math.ceil((inTok + outTok) * quotaWeight(body, tier));
}
