// M4: slår ihop vänster- och högersidans rå-OCR-JSON (efter att uppslaget delats
// vid ryggen och lästs i två anrop) till ETT flights-resultat. Nyckel = row_index
// med positionell fallback. Returnerar null om det inte går att slå ihop säkert,
// då faller anroparen tillbaka på ett hela-uppslag-anrop. Ren funktion (testbar).

const META = ['needs_review', 'field_issues', 'overall_confidence', 'review_reason', 'row_index'];

function combine(base: any, add: any): any {
  const out = { ...base };
  for (const [k, v] of Object.entries(add)) {
    if (v === undefined || v === null || v === '' || META.includes(k)) continue;
    out[k] = v;
  }
  out.field_issues = [...(base.field_issues ?? []), ...(add.field_issues ?? [])];
  out.needs_review = Boolean(base.needs_review) || Boolean(add.needs_review);
  if (add.review_reason && !out.review_reason) out.review_reason = add.review_reason;
  const lc = Number(base.overall_confidence), rc = Number(add.overall_confidence);
  if (!isNaN(lc) || !isNaN(rc)) out.overall_confidence = Math.min(isNaN(lc) ? 1 : lc, isNaN(rc) ? 1 : rc);
  return out;
}

const hasIdx = (arr: any[]): boolean =>
  arr.length > 0 && arr.filter((f) => Number.isFinite(Number(f.row_index))).length >= Math.ceil(arr.length * 0.7);

export function mergeSpreadParsed(left: any, right: any): any | null {
  const lf: any[] = Array.isArray(left?.flights) ? left.flights : [];
  const rf: any[] = Array.isArray(right?.flights) ? right.flights : [];
  if (lf.length === 0 && rf.length === 0) return null;

  let merged: any[];
  if (hasIdx(lf) && hasIdx(rf)) {
    const byIdx = new Map<number, any>();
    for (const f of lf) { const i = Number(f.row_index); if (Number.isFinite(i)) byIdx.set(i, { ...f }); }
    for (const f of rf) {
      const i = Number(f.row_index);
      if (!Number.isFinite(i)) continue;
      byIdx.set(i, combine(byIdx.get(i) ?? {}, f));
    }
    merged = [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  } else if (lf.length === rf.length) {
    merged = lf.map((f, i) => combine(f, rf[i]));
  } else {
    return null;
  }

  return {
    flights: merged,
    aircraft_detections: (left?.aircraft_detections?.length ? left.aircraft_detections : right?.aircraft_detections) ?? [],
    page_totals: left?.page_totals ?? right?.page_totals ?? {},
    page_numbers: left?.page_numbers ?? right?.page_numbers ?? {},
  };
}
