// Hur mycket ett anrop drar från användarens Blade coins (1 coin = 200 tokens). Skanning av loggbok får
// dubbelt så många tokens per coin som andra funktioner för PREMIUM: ett uppslag är stort (bild + långt svar),
// och en betalande användare ska kunna skanna en hel bok. Gratisnivån betalar full taxa — den har inte
// betalat något, så den lägre taxan skulle bara öka kostnaden.
//
// Skanningen känns igen på själva anropet, inte på en header från appen, så att den lägre taxan inte kan
// användas för annat: verktyget emit_flights är tvingat (tool_choice), det är det enda verktyget, anropet
// innehåller en bild och svaret har ett tak. Svaret måste då följa skanningens schema.

export const SCAN_QUOTA_WEIGHT = 0.5;
const SCAN_TOOL = 'emit_flights';
const SCAN_MAX_TOKENS = 16000;

export function quotaWeight(body: any, tier = 'free'): number {
  if (tier !== 'premium') return 1;
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
