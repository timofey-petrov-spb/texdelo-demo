// Решения человека в демо поверх сюжета. Сюжет demo/stream.jsonl записан заранее и ничего не знает о клейме,
// удержании или возврате, которые инженер ОТК делает на защите. Поэтому каждое такое решение — поправка
// (запись overlay), и каждый следующий кадр сюжета line/item/decision проходит через поправки: итоги линии,
// списки участков и детали остаются такими, какими их сделало решение, а не откатываются следующим кадром.
// Чистые функции без DOM — проверяются node --test.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ACCEPTED = new Set(['accepted_qc', 'accepted_concession']);
const KEYS = ['in_work', 'on_hold', 'at_otk', 'accepted'];

export function createOverlay() {
  return { entries: new Map(), stamps: new Map(), holds: new Map(), templates: new Set() };
}

export function clearOverlay(ov) {
  ov.entries.clear();
  ov.stamps.clear();
  ov.holds.clear();
}

// Признаки детали так, как их считает сюжет (demo_state.World.totals): в работе / на удержании / у ОТК / принято
export function itemFlags(it) {
  return {
    accepted: !!it?.accepted || ACCEPTED.has(it?.status),
    on_hold: !!it?.on_hold,
    at_otk: it?.status === 'under_inspection',
  };
}

function counts(f) {
  const live = !f.accepted;
  return { in_work: +(live && !f.on_hold && !f.at_otk), on_hold: +(live && f.on_hold), at_otk: +(live && f.at_otk),
    accepted: +f.accepted };
}

// Записать решение: item — какой деталь теперь видит табло, flags — как её считать в итогах
export function setEntry(ov, entry) {
  ov.entries.set(entry.item_id, entry);
  if (entry.stamp) ov.stamps.set(entry.item_id, entry.stamp);
  else ov.stamps.delete(entry.item_id);
  if (entry.hold) ov.holds.set(entry.item_id, entry.hold);
  else ov.holds.delete(entry.item_id);
}

export function dropEntry(ov, id) {
  ov.entries.delete(id);
  ov.stamps.delete(id);
  ov.holds.delete(id);
}

function entriesOf(ov, lineId) {
  return [...ov.entries.values()].filter((e) => e.line_id === lineId);
}

// Поправка к итогам линии: для каждой детали с решением — «как после решения» минус «как считает сюжет сейчас»
export function totalsDelta(ov, lineId, storyItems) {
  const d = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const e of entriesOf(ov, lineId)) {
    const a = counts(e.flags);
    const b = counts(itemFlags(storyItems?.get(e.item_id) || e.base));
    for (const k of KEYS) d[k] += a[k] - b[k];
  }
  return d;
}

export function patchTotals(totals, delta) {
  const out = { ...totals };
  for (const k of KEYS) if (Number.isFinite(out[k]) && delta[k]) out[k] = Math.max(0, out[k] + delta[k]);
  return out;
}

function patchZones(zc, ov, lineId, storyItems) {
  const out = { ...zc };
  const add = (z, n) => {
    if (z) out[z] = Math.max(0, (out[z] || 0) + n);
  };
  for (const e of entriesOf(ov, lineId)) {
    const story = storyItems?.get(e.item_id) || e.base;
    if (story && !itemFlags(story).accepted) add(story.zone, -1);
    if (!e.flags.accepted) add(e.item.zone, 1);
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

// Участок: детали с решением убираются из списков сюжета и ставятся туда, где их оставило решение
export function patchStation(st, ov, lineId) {
  const mine = entriesOf(ov, lineId);
  if (!mine.length || !isObj(st)) return st;
  const ids = new Set(mine.map((e) => e.item_id));
  const here = mine.filter((e) => !e.flags.accepted && e.item.station_id === st.station_id);
  const out = { ...st };
  const keep = (list) => (Array.isArray(list) ? list.filter((x) => !ids.has(x)) : []);
  out.items_in_work = [...keep(st.items_in_work), ...here.filter((e) => !e.flags.on_hold).map((e) => e.item_id)];
  out.on_hold = [...keep(st.on_hold), ...here.filter((e) => e.flags.on_hold).map((e) => e.item_id)];
  if (Number.isFinite(st.wip)) out.wip = out.items_in_work.length + out.on_hold.length;
  return out;
}

function patchItems(items, ov, lineId) {
  const out = items.map((it) => ov.entries.get(it?.item_id)?.item || it);
  const have = new Set(out.map((it) => it?.item_id));
  for (const e of entriesOf(ov, lineId)) if (!have.has(e.item_id)) out.push(e.item);
  return out;
}

export function patchLine(ls, ov, storyItems) {
  if (!isObj(ls) || !ov.entries.size) return ls;
  const lid = ls.line_id;
  const out = { ...ls };
  if (isObj(ls.totals)) out.totals = patchTotals(ls.totals, totalsDelta(ov, lid, storyItems));
  if (isObj(ls.zone_counts)) out.zone_counts = patchZones(ls.zone_counts, ov, lid, storyItems);
  if (Array.isArray(ls.stations)) out.stations = ls.stations.map((st) => patchStation(st, ov, lid));
  if (Array.isArray(ls.items)) out.items = patchItems(ls.items, ov, lid);
  return out;
}

// Кадр сюжета после поправок; null — кадр не показывать (деталь уже живёт по решению человека)
export function patchEvent(ev, frameItemId, ov, storyItems) {
  if (!isObj(ev)) return ev;
  if (ev.type === 'item' && ov.entries.has(ev.item?.item_id)) return null;
  if (ev.type === 'decision' && frameItemId && ov.entries.has(frameItemId)) return null;
  if (ev.type === 'line') return { ...ev, line: patchLine(ev.line, ov, storyItems) };
  return ev;
}
