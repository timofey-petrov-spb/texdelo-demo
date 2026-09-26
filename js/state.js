// Состояние табло и редьюсер StreamEvent (контракт API v1.3, /v1/stream). Без DOM — проверяется node --test.
//
// Как читается поток:
// • hello — начало (или возобновление) потока; seq меньше уже виденного этим потоком — журнал начат заново;
// • line — LineState; присланные поля заменяют прежние; участки сливаются по station_id (участок — целиком);
//   items, если присланы, — полный список деталей этой линии. Первый line после hello со seq меньше, чем
//   в hello (ядро отвечает hello с seq = since_seq, а снимок — с seq своего журнала), значит, ядро
//   перезапущено с новым журналом: состояние сбрасывается и строится по снимку;
// • item — ItemSummary целиком; обновление старше уже применённого (по seq) пропускается;
// • warning / card / decision — ленты и счётчики; активные предупреждения — StationState.warnings,
//   предупреждение, исчезнувшее из списка участка, считается закрытым; решение (DecisionView) хранится по
//   event_id — повтор того же решения с квитанциями MES и 1С (API v1.3) дополняет его;
// • heartbeat — только seq.
// Источник (source) — поток, из которого пришло событие: с ядром по линиям — свой поток на линию, у каждого
// свой since_seq; правило перезапуска проверяется в пределах одного потока.

import { latestPerDetail, runVisible } from './lap.js';

// Текущий круг (SPEC 5.6; К37, П1) — lap.js; здесь — для тех, кто берёт всё из state.js
export { currentLap, inView, lapOf, lapVisible, latestPerDetail, runVisible, setStripContext } from './lap.js';

export const FEED_LIMIT = 80;
// Предупреждения, решения и карточки в ленте (журнале) не вытесняются потоком обычных событий (2–3 в секунду):
// у них свой предел FEED_LIMIT, у обычных — свой (QA В-08)
const FEED_IMPORTANT = new Set(['warning', 'decision', 'card']);

function trimFeed(state) {
  let normal = 0;
  let important = 0;
  for (const e of state.feed) {
    if (FEED_IMPORTANT.has(e.type)) important += 1;
    else normal += 1;
  }
  for (let i = state.feed.length - 1; i >= 0 && (normal > FEED_LIMIT || important > FEED_LIMIT); i -= 1) {
    const imp = FEED_IMPORTANT.has(state.feed[i].type);
    if (imp ? important <= FEED_LIMIT : normal <= FEED_LIMIT) continue;
    state.feedKeys.delete(state.feed[i].key);
    state.feed.splice(i, 1);
    if (imp) important -= 1;
    else normal -= 1;
  }
}
export const WARNING_LIMIT = 40;
export const DECISION_LIMIT = 300;
const DEFAULT_LINE = '—';

export function createState() {
  return {
    seq: 0,
    hello: null,
    src: new Map(),
    lines: new Map(),
    items: new Map(),
    itemSeq: new Map(),
    warnings: new Map(),
    stationWarnings: new Map(),
    resolved: new Set(),
    cards: new Map(),
    decisions: new Map(),
    feed: [],
    feedKeys: new Set(),
    events: 0,
  };
}

export function emptyChanges() {
  return {
    reset: false, lines: new Set(), stations: new Set(), items: new Set(), removed: new Set(), totals: new Set(),
    feed: [], warnings: false, cards: false, decisions: false, seq: false,
  };
}

export function mergeChanges(a, b) {
  if (!b) return a;
  a.reset = a.reset || b.reset;
  for (const k of ['lines', 'stations', 'items', 'removed', 'totals']) for (const v of b[k]) a[k].add(v);
  a.feed.push(...b.feed);
  if (a.feed.length > FEED_LIMIT) a.feed.splice(0, a.feed.length - FEED_LIMIT); // вкладка была скрыта — лишнее не рисуем
  a.warnings = a.warnings || b.warnings;
  a.cards = a.cards || b.cards;
  a.decisions = a.decisions || b.decisions;
  a.seq = a.seq || b.seq;
  return a;
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function lineOf(state, id) {
  const key = id || DEFAULT_LINE;
  let line = state.lines.get(key);
  if (!line) {
    line = { line_id: key, route: [], stations: new Map(), equipment: new Map(), totals: {}, zone_counts: {},
      thresholds: null, as_of_seq: 0 };
    state.lines.set(key, line);
  }
  return line;
}

// Линия детали: её line_id, если такая линия известна; если линия одна (снимок без line_id) — она
export function itemLineId(state, item) {
  if (item?.line_id && (state.lines.has(item.line_id) || state.lines.size !== 1)) return item.line_id;
  return state.lines.size ? [...state.lines.keys()][0] : item?.line_id || DEFAULT_LINE;
}

export function stationKey(lineId, stationId) {
  return `${lineId}/${stationId}`;
}

export function warningKey(w) {
  return w.warning_id || `${w.code}|${w.station_id || ''}|${w.item_id || ''}|${w.title}`;
}

function syncStationWarnings(state, lineId, st, ch) {
  if (!Array.isArray(st.warnings)) return;
  const key = stationKey(lineId, st.station_id);
  const prev = state.stationWarnings.get(key) || [];
  const next = st.warnings.filter((w) => isObj(w) && w.title);
  const ids = new Set(next.map(warningKey));
  for (const w of prev) {
    const k = warningKey(w);
    if (!ids.has(k)) {
      state.resolved.add(k);
      state.warnings.delete(k);
      ch.warnings = true;
    }
  }
  for (const w of next) state.resolved.delete(warningKey(w));
  if (prev.length !== next.length || next.some((w, i) => warningKey(w) !== warningKey(prev[i] || {}))) {
    ch.warnings = true;
  }
  state.stationWarnings.set(key, next);
}

// Одинаковы ли два ответа ядра (объекты из JSON — порядок полей у ядра постоянный)
export function sameData(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// snapshot — деталь из снимка линии (line каждую секунду несёт все детали): та же сводка — не изменение, иначе
// экран детали и метки перерисовывались бы на каждый кадр потока. Событие item — новая запись по детали: изменение.
function upsertItem(state, item, seq, ch, snapshot = false) {
  if (!isObj(item) || !item.item_id) return;
  const last = state.itemSeq.get(item.item_id);
  if (last !== undefined && seq < last) return;
  if (snapshot && last !== undefined && sameData(state.items.get(item.item_id), item)) return;
  state.items.set(item.item_id, item);
  state.itemSeq.set(item.item_id, seq);
  ch.items.add(item.item_id);
}

function applyLine(state, ls, seq, ch) {
  if (!isObj(ls)) return;
  const line = lineOf(state, ls.line_id);
  const id = line.line_id;
  ch.lines.add(id);
  if (Array.isArray(ls.route)) line.route = ls.route.filter((s) => typeof s === 'string');
  if (Array.isArray(ls.stations)) {
    for (const st of ls.stations) {
      if (!isObj(st) || !st.station_id) continue;
      if (sameData(line.stations.get(st.station_id), st)) continue; // участок не изменился — плитку не трогать
      line.stations.set(st.station_id, st);
      ch.stations.add(stationKey(id, st.station_id));
      syncStationWarnings(state, id, st, ch);
    }
    if (!line.route.length) {
      line.route = [...line.stations.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => s.station_id);
    }
  }
  if (Array.isArray(ls.equipment)) for (const e of ls.equipment) if (isObj(e) && e.equipment_id) line.equipment.set(e.equipment_id, e);
  if (isObj(ls.totals) && !sameData(line.totals, ls.totals)) {
    line.totals = { ...ls.totals };
    ch.totals.add(id);
  }
  if (isObj(ls.zone_counts)) line.zone_counts = { ...ls.zone_counts };
  if (isObj(ls.thresholds)) line.thresholds = { ...ls.thresholds };
  if (Number.isFinite(ls.as_of_seq)) line.as_of_seq = ls.as_of_seq;
  if (Array.isArray(ls.items)) {
    const keep = new Set(ls.items.filter(isObj).map((i) => i.item_id));
    for (const [iid, it] of state.items) {
      if (!keep.has(iid) && itemLineId(state, it) === id) {
        state.items.delete(iid);
        state.itemSeq.delete(iid);
        ch.removed.add(iid);
      }
    }
    for (const it of ls.items) upsertItem(state, it, seq, ch, true);
  }
}

function feedEntry(state, ev) {
  const item = isObj(ev.item) ? ev.item : null;
  const w = isObj(ev.warning) ? ev.warning : null;
  const card = isObj(ev.card) ? ev.card : null;
  const d = isObj(ev.decision) ? ev.decision : null;
  const target = d?.target_kind === 'item' ? d.target_id : null;
  return {
    key: `${ev.seq}|${ev.type}|${ev.summary}`,
    seq: ev.seq,
    at: ev.at || null,
    type: ev.type,
    event_type: ev.event_type || null,
    summary: String(ev.summary),
    item_id: item?.item_id || card?.item_id || w?.item_id || target || null,
    line_id: item?.line_id || (isObj(ev.line) ? ev.line.line_id : null) || null,
    zone: item?.zone || null,
    level: w?.level || null,
    code: w?.code || null,
    receipts: Array.isArray(d?.receipts) ? d.receipts : null,
  };
}

function reset(state) {
  const fresh = createState();
  for (const k of Object.keys(fresh)) state[k] = fresh[k];
}

export { reset as resetState };

// Снимок линии из состояния — LineState по контракту (так отвечает ядро после hello)
export function lineSnapshot(state, line) {
  const out = {
    route: [...line.route], stations: [...line.stations.values()], equipment: [...line.equipment.values()],
    totals: { ...line.totals }, zone_counts: { ...line.zone_counts }, as_of_seq: state.seq,
    items: [...state.items.values()].filter((it) => itemLineId(state, it) === line.line_id),
  };
  if (line.line_id !== DEFAULT_LINE) out.line_id = line.line_id;
  if (line.thresholds) out.thresholds = { ...line.thresholds };
  return out;
}

// Применить событие потока. Возвращает, что изменилось (для точечной перерисовки), или null, если событие отброшено.
const TYPES = new Set(['hello', 'line', 'item', 'warning', 'decision', 'card', 'heartbeat']);

function sourceOf(state, source) {
  let s = state.src.get(source);
  if (!s) {
    s = { seq: 0, hello: null };
    state.src.set(source, s);
  }
  return s;
}

export function sourceSeq(state, source = 'main') {
  return state.src.get(source)?.seq ?? 0;
}

export function applyEvent(state, ev, source = 'main') {
  if (!isObj(ev) || !TYPES.has(ev.type) || !Number.isFinite(ev.seq)) return null;
  const ch = emptyChanges();
  let src = sourceOf(state, source);
  const restart = () => {
    reset(state);
    ch.reset = true;
    src = sourceOf(state, source);
  };
  if (ev.type === 'hello') {
    if (src.seq > 0 && ev.seq < src.seq && ev.seq < state.seq) restart();
    src.hello = ev.seq;
    state.hello = ev.seq;
  } else if (ev.type === 'line') {
    const after = src.hello;
    src.hello = null;
    if (after !== null && ev.seq < after && ev.seq < state.seq) restart();
    applyLine(state, ev.line, ev.seq, ch);
  } else if (ev.type === 'item') {
    upsertItem(state, ev.item, ev.seq, ch);
  } else if (ev.type === 'warning' && isObj(ev.warning) && ev.warning.title) {
    const k = warningKey(ev.warning);
    if (!state.resolved.has(k)) {
      state.warnings.set(k, ev.warning);
      while (state.warnings.size > WARNING_LIMIT) state.warnings.delete(state.warnings.keys().next().value);
      ch.warnings = true;
    }
  } else if (ev.type === 'card' && isObj(ev.card) && ev.card.nc_id) {
    state.cards.set(ev.card.nc_id, ev.card);
    ch.cards = true;
  } else if (ev.type === 'decision' && isObj(ev.decision) && ev.decision.event_id) {
    rememberDecision(state, ev.decision);
    ch.decisions = true;
  }
  if (ev.type !== 'heartbeat') state.events += 1;
  // seq в hello — это since_seq, который назвал сам клиент, а не запись журнала: номер потока он не двигает
  const journal = ev.type !== 'hello';
  if (journal && ev.seq > src.seq) src.seq = ev.seq;
  if (journal && ev.seq > state.seq) {
    state.seq = ev.seq;
    ch.seq = true;
  }
  // предупреждение без summary — в ленту его заголовком (иначе в журнале «Предупреждения» пусто, QA В-08)
  const summary = ev.summary || (ev.type === 'warning' && isObj(ev.warning) ? ev.warning.title : '');
  if (summary && ev.type !== 'heartbeat') {
    const e = feedEntry(state, { ...ev, summary });
    if (!state.feedKeys.has(e.key)) {
      state.feedKeys.add(e.key);
      state.feed.unshift(e);
      ch.feed.push(e);
      trimFeed(state);
    }
  }
  return ch;
}

// Решение по event_id: повтор того же решения (квитанции пришли позже) дополняет его, а не дублирует
function rememberDecision(state, d) {
  const old = state.decisions.get(d.event_id);
  const merged = old ? { ...old, ...d, receipts: Array.isArray(d.receipts) ? d.receipts : old.receipts } : { ...d };
  state.decisions.delete(d.event_id);
  state.decisions.set(d.event_id, merged);
  while (state.decisions.size > DECISION_LIMIT) state.decisions.delete(state.decisions.keys().next().value);
}

// Решения по цели (изделие, карточка) — от новых к старым
export function decisionsFor(state, targetId) {
  return [...state.decisions.values()].filter((d) => d.target_id === targetId).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

// Активные предупреждения: списки участков + пришедшие отдельными событиями и ещё не закрытые
export function activeWarnings(state) {
  const all = new Map();
  for (const list of state.stationWarnings.values()) for (const w of list) all.set(warningKey(w), w);
  for (const [k, w] of state.warnings) if (!state.resolved.has(k)) all.set(k, w);
  const rank = { stop: 0, warning: 1, info: 2 };
  return [...all.values()].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3)
    || String(b.raised_at || '').localeCompare(String(a.raised_at || '')));
}

export function sortedLines(state) {
  return [...state.lines.values()].sort((a, b) => String(a.line_id).localeCompare(String(b.line_id)));
}

export function itemsAt(state, lineId, stationId) {
  const out = [];
  for (const it of state.items.values()) {
    if (it.station_id === stationId && itemLineId(state, it) === lineId && !it.accepted) out.push(it);
  }
  return out;
}

// Очередь поста ОТК: не принятые детали «на контроле» или на последнем участке маршрута без непройденных точек;
// lapFilter не 'all' — текущий прогон и по одной детали на номер (последний круг среди тех, что у ОТК)
export function otkQueue(state, lineFilter = 'all', lapFilter = 'current') {
  const out = [];
  for (const it of state.items.values()) {
    const lid = itemLineId(state, it);
    if (lineFilter !== 'all' && lid !== lineFilter) continue;
    if (lapFilter !== 'all' && !runVisible(state, it.item_id)) continue;
    if (it.accepted || ['accepted_qc', 'accepted_concession', 'scrapped'].includes(it.status)) continue;
    const route = state.lines.get(lid)?.route || [];
    const last = route[route.length - 1];
    const checked = !it.coverage || !Number.isFinite(it.coverage.pending) || it.coverage.pending === 0;
    if (it.status === 'under_inspection' || (last && it.station_id === last && checked)) out.push(it);
  }
  // текущий круг: по одной детали на номер — последнего круга среди тех, что у ОТК (lap.js)
  const keep = lapFilter === 'all' ? null : latestPerDetail(state, out.map((it) => it.item_id));
  return (keep ? out.filter((it) => keep.has(it.item_id)) : out).sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)));
}

// Линии в сводном снимке без line_id (ядро отдало одну LineState на все линии): по line_id деталей
export function linesOf(snapshot) {
  if (!isObj(snapshot) || snapshot.line_id) return [];
  const ids = new Set();
  for (const it of Array.isArray(snapshot.items) ? snapshot.items : []) if (isObj(it) && it.line_id) ids.add(String(it.line_id));
  return [...ids].sort();
}

// Итоги по видимым линиям: суммы LineTotals
export function sumTotals(lines) {
  const keys = ['in_work', 'on_hold', 'at_otk', 'accepted', 'open_cards', 'active_warnings', 'events_per_min'];
  const out = {};
  for (const k of keys) {
    const vals = lines.map((l) => l.totals?.[k]).filter((v) => Number.isFinite(v));
    out[k] = vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  }
  return out;
}
