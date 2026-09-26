// Полоса «Требует действия» (ISA-101: сначала то, что требует вмешательства, по тяжести): «Стоп» и пропуски
// контроля, решения по карточкам и удержаниям, уход режима, прочее — каждое с тем, кто должен действовать.
// Одна строка на объект (SPEC.md 3.2): все предупреждения по детали — в её строке, по участку без детали — в строке
// участка; прошлые круги не показываются (5.6); «К сведению» — счётчиком, не строкой. Словарь кодов — SPEC.md 7.12.
// Без DOM — проверяется node --test.

import { ITEM_ID, lineTitle } from './format.js';
import { addMentions, clean, mentionText, normalizeText, tidy } from './group.js';
import { cardHint, cardLabel, humanizeCodes, itemParts, placeTitle } from './names.js';
import { enumTitle } from './plain.js';
import * as stateMod from './state.js';
import { itemLineId, warningKey } from './state.js';
import { roleTitle } from './texts.js';
import { CODE_TITLES, shortStation } from './words.js';

export { CODE_TITLES };

// Тяжесть: цвет + знак + слово (как у зон). rank — порядок в полосе.
export const SEVERITY = {
  critical: { rank: 0, label: 'Стоп', icon: '✕' },
  serious: { rank: 1, label: 'Решение', icon: '!' },
  caution: { rank: 2, label: 'Внимание', icon: '◐' },
  advisory: { rank: 3, label: 'К сведению', icon: 'i' },
};
const KIND_RANK = { stop: 0, skip: 1, card: 2, hold: 3, drift: 4, warning: 5, info: 6 };

export function rowLabel(e) {
  if (e.severity === 'caution' && e.kind === 'drift') return 'Уход режима';
  return SEVERITY[e.severity].label;
}

// уход режима — значок «◐ Уход» строки статуса и строка участка
export const DRIFT_CODES = new Set(['W_SPC_RULE1', 'W_SPC_RULE2', 'W_SPC_RULE3', 'W_SPC_EWMA', 'W_SPC_CUSUM', 'W_SPC']);
// Пропуск контроля и уход без оценки — всегда «Стоп», каким бы уровнем ни пришло предупреждение (в
// config/rules.yaml ядра — warn): деталь ушла дальше без обязательной проверки, решать по ней должен человек
const SKIP_CODES = new Set(['W_CHECK_SKIPPED', 'W_NOT_ASSESSED']);
// уровень по смыслу кода, а не по уровню ядра (SPEC.md 7.12, столбец «значок строки статуса»)
const STOP_CODES = new Set(['W_CUSTOMER_NOTIFY_OVERDUE', 'W_JOURNAL_INTEGRITY']);
const DECISION_CODES = new Set(['W_GATE_BLOCKED', 'W_CUSTOMER_NOTIFY_DUE', 'W_PREVENTIVE_ACTION_DUE']);
const INFO_CODES = new Set(['W_LATE_EVENT']);
// поверка и прибор под сомнением — метрологу (так маршрутизирует ядро, config/rules.yaml), даже без адресатов
const INSTRUMENT_CODES = new Set(['W_INSTRUMENT_CALIBRATION_DUE', 'W_INSTRUMENT_CALIBRATION_EXPIRED', 'W_INSTRUMENT_SUSPECT']);
const CLOSED_CARDS = new Set(['closed', 'not_confirmed']);
// чей ход по карточке — родительным: «ждёт инженера ОТК»
const ROLE_GEN = { controller: 'инженера ОТК', qc_head: 'начальника ОТК', foreman: 'мастера', technologist: 'технолога',
  design_authority: 'держателя КД', customer_rep: 'представителя заказчика', shift_supervisor: 'начальника смены' };
const ACCEPTED = new Set(['accepted_qc', 'accepted_concession', 'scrapped']);

function cardWho(status) {
  if (status === 'awaiting_approval') return ['design_authority', 'customer_rep'];
  if (status === 'confirmed') return ['controller', 'qc_head'];
  return ['controller'];
}

// «Л-1, БД-01-0094: пропуск…» → «пропуск…»: линия и деталь уже есть в строке полосы
const ID = `(?:(?:Л|L)-\\d+|${ITEM_ID.source}|[A-Z]+-\\d+)`;
const LEAD = new RegExp(`^${ID}(?:[,\\s·]+${ID})*:\\s*`);

export function stripLead(text) {
  const t = tidy(text);
  const out = t.replace(LEAD, '');
  return out ? out[0].toUpperCase() + out.slice(1) : t;
}

// Предупреждение уровня «Стоп» для экрана: stop, операция остановлена или пропуск контроля (любого уровня)
export function isStopWarning(w) {
  return !!w && (w.level === 'stop' || !!w.operation_stopped || SKIP_CODES.has(w.code));
}

export function warningFact(w, lineId) {
  const drift = DRIFT_CODES.has(w.code);
  const skip = SKIP_CODES.has(w.code);
  // «Решение» — у кодов, где ждут решения людей, даже если ядро остановило шаг (ворота по карточке: действие —
  // решение по карточке, SPEC.md 7.12); уровень ядра warning — «Внимание»; info — «К сведению»
  const decision = !skip && DECISION_CODES.has(w.code);
  const stop = !decision && (skip || STOP_CODES.has(w.code) || w.level === 'stop' || !!w.operation_stopped);
  const severity = stop ? 'critical' : decision ? 'serious' : drift ? 'caution'
    : INFO_CODES.has(w.code) || (w.level !== 'warning' && w.level !== 'stop') ? 'advisory' : 'caution';
  const kind = skip ? 'skip' : drift ? 'drift' : stop ? 'stop' : severity === 'advisory' ? 'info' : 'warning';
  const who = Array.isArray(w.addressees) && w.addressees.length ? w.addressees : skip ? ['controller', 'foreman']
    : INSTRUMENT_CODES.has(w.code) ? ['metrologist'] : ['controller'];
  // ворота по карточке: вид дефекта — из номера карточки в тексте ядра («Подрез шва»), чтобы строка не теряла его,
  // когда самой карточки во входе полосы нет
  const nc = w.code === 'W_GATE_BLOCKED' ? /NC-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*/.exec(String(w.title || ''))?.[0] : null;
  const defect = nc ? cardLabel(nc, { item: false }) : '';
  return { severity, kind, title: CODE_TITLES[w.code] || clean(stripLead(w.title)), detail: stripLead(w.title), code: w.code || '',
    line_id: lineId || null, station_id: w.station_id || null, item_id: w.item_id || null, who,
    at: w.raised_at || null, hold_suggested: !!w.suggest_hold, source_id: w.warning_id || null,
    defect: defect && !/^карточка/i.test(defect) ? defect : '' };
}

const worse = (a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank || KIND_RANK[a.kind] - KIND_RANK[b.kind];

function merge(facts, base) {
  const sorted = [...facts].sort(worse);
  const top = sorted[0];
  const who = [...new Set(sorted.flatMap((f) => f.who))];
  const at = sorted.map((f) => f.at).filter(Boolean).sort().at(-1) || null;
  const rest = [...new Set(sorted.slice(1).map((f) => f.title))].filter((t) => t !== top.title);
  const sources = [...new Set(sorted.map((f) => f.source_id).filter(Boolean))];
  const step = sorted.find((f) => f.step)?.step || '';
  return { ...base, severity: top.severity, kind: top.kind, title: top.title, detail: top.detail, hint: top.hint || '',
    facts: rest, who, at, count: base.count || 1, sources, step };
}

// input: { warnings: [{warning, line_id}], items: [ItemSummary + line_id], cards: [CardSummary],
//          stations: [{line_id, station_id, title, drift}] }; stationTitle(line, station) — подпись участка
function rawBuild(input, stationTitle = (l, s) => s) {
  const byItem = new Map();
  const byStation = new Map();
  const out = [];
  const itemFacts = (id) => {
    if (!byItem.has(id)) byItem.set(id, []);
    return byItem.get(id);
  };
  const stationFacts = (lid, sid) => {
    const k = `${lid}/${sid}`;
    if (!byStation.has(k)) byStation.set(k, []);
    return byStation.get(k);
  };
  const items = new Map((input.items || []).map((it) => [it.item_id, it]));
  // предупреждения: повторы одного и того же (без номеров деталей) — одной строкой с числом
  const groups = new Map();
  for (const { warning: w, line_id: lid } of input.warnings || []) {
    if (!w?.title) continue;
    const it = items.get(w.item_id);
    const f = warningFact(w, lid || it?.line_id);
    // уход режима — про участок, а не про деталь: всегда строкой участка, даже если ядро назвало деталь
    if (f.kind === 'drift' && (f.station_id || it?.station_id)) {
      stationFacts(f.line_id, f.station_id || it.station_id).push({ ...f, item_id: null });
      continue;
    }
    const key = [f.code, f.line_id, f.station_id, normalizeText(w.title)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const [key, fs] of groups) {
    // повторы сворачиваются, кроме «Стоп» и пропуска контроля: по каждой такой детали нужен человек. Одна и та же
    // деталь разных кругов сюжета («Вся смена») — не повтор: предупреждение остаётся в строке своей детали (QA В-22)
    const bases = new Set(fs.map((f) => (f.item_id ? itemParts(f.item_id).base : '')));
    const sameItem = bases.size === 1 && !bases.has('');
    if (fs.length > 1 && fs[0].severity !== 'critical' && !sameItem) {
      const ids = [...new Set(fs.map((f) => f.item_id).filter(Boolean))];
      const slots = fs.reduce((acc, f) => addMentions(acc, f.detail), []);
      const row = merge(fs, { key: `g|${key}`, count: fs.length, items: ids, line_id: fs[0].line_id,
        station_id: fs[0].station_id, item_id: null });
      out.push({ ...row, detail: mentionText(row.detail, slots), facts: [] });
    } else {
      // одна строка на объект: по детали — в строку детали, по участку без детали — в строку участка
      fs.forEach((f, i) => {
        if (f.item_id) itemFacts(f.item_id).push(f);
        else if (f.station_id && f.severity !== 'advisory') stationFacts(f.line_id, f.station_id).push(f); // «к сведению» — не в строку участка
        else out.push(merge([f], { key: `w|${key}|${i}`, line_id: f.line_id, station_id: null, item_id: null }));
      });
    }
  }
  for (const it of items.values()) {
    if (it.accepted || ACCEPTED.has(it.status)) continue;
    if (it.on_hold) {
      itemFacts(it.item_id).push({ severity: 'serious', kind: 'hold', title: 'Удержано', detail: '',
        who: ['controller'], at: null });
    }
    const skipped = Number(it.coverage?.skipped) || 0;
    if (skipped > 0 && !(byItem.get(it.item_id) || []).some((f) => f.kind === 'skip')) {
      itemFacts(it.item_id).push({ severity: 'critical', kind: 'skip', title: 'Пропуск контроля',
        detail: `пропущено обязательных точек: ${skipped}`, who: ['controller', 'foreman'], at: null });
    }
  }
  for (const c of input.cards || []) {
    if (!c?.nc_id || CLOSED_CARDS.has(c.status)) continue;
    // заголовок — вид дефекта («Подрез шва»); чей ход — словами во второй строке («ждёт инженера ОТК»), статус ядра —
    // в подсказке
    const who = cardWho(c.status);
    itemFacts(c.item_id).push({ severity: c.zone === 'beyond_limit' ? 'critical' : 'serious', kind: 'card',
      title: cardLabel(c, { item: false }), detail: `карточка: ${c.status_title || enumTitle(c.status)}`, who,
      step: `ждёт ${who.map((r) => ROLE_GEN[r] || roleTitle(r)).join(' или ')}`, at: c.opened_at || null, source_id: c.nc_id,
      hint: cardHint(c.nc_id) });
  }
  for (const st of input.stations || []) {
    if (!st?.drift) continue;
    const facts = stationFacts(st.line_id, st.station_id);
    if (!facts.some((f) => f.kind === 'drift')) {
      facts.push({ severity: 'caution', kind: 'drift', title: `Уход режима, критерий ${st.drift.criterion}`,
        detail: tidy(st.drift.title || ''), who: ['technologist', 'foreman'], at: null });
    }
  }
  for (const [id, all] of byItem) {
    const it = items.get(id);
    // ворота без карточки во входе — вид дефекта из текста ворот: «Подрез шва + шаг закрыт, пока карточка открыта»
    const hasCard = all.some((f) => f.kind === 'card');
    const facts = hasCard ? all : all.map((f) => (f.defect ? { ...f, title: `${f.defect} + ${lowerFirst(f.title)}` } : f));
    out.push(merge(facts, { key: `i|${id}`, item_id: id, items: [id], line_id: it?.line_id || facts[0].line_id || null,
      station_id: it?.station_id || facts[0].station_id || null }));
  }
  for (const [k, facts] of byStation) {
    const cut = k.lastIndexOf('/');
    const lid = k.slice(0, cut);
    out.push(merge(facts, { key: `s|${k}`, line_id: lid === 'null' ? null : lid, station_id: k.slice(cut + 1), item_id: null }));
  }
  for (const e of out) {
    e.label = rowLabel(e);
    e.detail = clean(e.detail || '');
    e.where = [e.line_id ? lineTitle(e.line_id) : '', e.station_id ? stationTitle(e.line_id, e.station_id) : '']
      .filter(Boolean).join(', ');
    e.whoText = e.who.map(roleTitle).filter(Boolean).join(', ');
    e.subject = e.item_id ? itemParts(e.item_id).base : e.items?.length > 1 ? `деталей: ${e.items.length}` : '';
    e.cycle = e.item_id ? itemParts(e.item_id).cycleText : '';
  }
  return out.sort((a, b) => worse(a, b) || String(b.at || '').localeCompare(String(a.at || '')) || a.key.localeCompare(b.key));
}

// Сколько строк полосы видно без раскрытия: остальное — кнопкой «ещё N» в заголовке полосы (строку не занимает)
export function visibleRows(total, max) {
  if (total <= max) return { shown: total, more: 0 };
  const shown = Math.max(1, max);
  return { shown, more: total - shown };
}

// Вход полосы из состояния табло: предупреждения с линией (по списку участка или по детали), детали, карточки
// и уходы режима видимых линий; keep(itemId) — деталь текущего круга (5.6), без него — все
function rawInput(state, lineFilter = 'all', keep = null) {
  const want = (lid) => lineFilter === 'all' || !lid || lid === lineFilter;
  const now = (id) => !keep || !id || keep(id);
  const lineOfItem = (id) => {
    const it = state.items.get(id);
    return it ? itemLineId(state, it) : null;
  };
  const warnings = [];
  const seen = new Set();
  for (const [key, list] of state.stationWarnings) {
    const lid = key.slice(0, key.lastIndexOf('/'));
    for (const w of list) {
      const k = warningKey(w);
      if (seen.has(k) || !want(lid) || !now(w.item_id)) continue;
      seen.add(k);
      warnings.push({ warning: w, line_id: lid });
    }
  }
  for (const [k, w] of state.warnings) {
    if (seen.has(k) || state.resolved.has(k)) continue;
    const lid = w.item_id ? lineOfItem(w.item_id) : null;
    if (!want(lid) || !now(w.item_id)) continue;
    seen.add(k);
    warnings.push({ warning: w, line_id: lid });
  }
  const items = [...state.items.values()].map((it) => ({ ...it, line_id: itemLineId(state, it) }))
    .filter((it) => want(it.line_id) && now(it.item_id));
  const cards = [...state.cards.values()].filter((c) => want(lineOfItem(c.item_id)) && now(c.item_id));
  const stations = [];
  for (const line of state.lines.values()) {
    if (!want(line.line_id)) continue;
    for (const st of line.stations.values()) stations.push({ line_id: line.line_id, station_id: st.station_id, title: st.title, drift: st.drift });
  }
  return { warnings, items, cards, stations };
}

// ---------- текущий круг (SPEC.md 5.6) ----------
// «BD-01-0114-Ra427ea41-C4» → 4; без метки круга — 0
export function lapOf(itemId) {
  const m = /-C(\d+)$/.exec(String(itemId || ''));
  return m ? Number(m[1]) : 0;
}

// Деталь текущего круга: inView(app, id) из state.js (К37), пока его нет — наибольший круг среди деталей на табло
export function lapKeep(app) {
  if (app?.lapFilter === 'all') return null;
  if (typeof stateMod.inView === 'function') return (id) => !id || stateMod.inView(app, id);
  let max = 0;
  for (const id of app?.state?.items?.keys?.() || []) max = Math.max(max, lapOf(id));
  return max ? (id) => !id || lapOf(id) >= max : null;
}

// ---------- вид полосы на «Линии» ----------
// Полосу рисует attn.js (К37); что в ней видно, задаёт экран «Линия» (setAttentionView при монтировании):
// lineAll — обе линии всегда (фильтр линии живёт в «Приёмке ОТК»), keep — текущий круг, hideInfo — «К сведению»
// счётчиком, mine — роль для «Мне», kind — значок строки статуса (stop / decision / drift)
const VIEW = { lineAll: false, keep: null, hideInfo: false, mine: null, kind: null, oldest: false };
let stats = { all: 0, info: 0, shown: 0 };

export function setAttentionView(v) {
  Object.assign(VIEW, v);
}

export function resetAttentionView() {
  Object.assign(VIEW, { lineAll: false, keep: null, hideInfo: false, mine: null, kind: null, oldest: false });
}

// Сколько строк всего, сколько «К сведению», сколько показано после «Мне» и значка — для подписей экрана
export function attentionStats() {
  return stats;
}

// Значок строки статуса, к которому относится строка: «Стоп», «Решение», «Уход»; прочее — ни к одному
export function watchKind(e) {
  if (e.severity === 'critical') return 'stop';
  if (e.severity === 'serious') return 'decision';
  if (e.kind === 'drift') return 'drift';
  return '';
}

// Строки «Требует действия». Пока открыта «Линия» (VIEW.lineAll), вид применяется здесь же — так его получает любой,
// кто рисует полосу через attentionInput + buildAttention (attn.js К37: attentionForView) или attentionFromState;
// без вида — прежняя чистая функция (тесты). Значкам строки статуса и «Участку» — attentionRaw, без вида
export function buildAttention(input, stationTitle = (l, s) => s) {
  const rows = rawBuild(input, stationTitle);
  return VIEW.lineAll ? viewRows(rows, stationTitle) : rows;
}

export function attentionInput(state, lineFilter = 'all', keep = null) {
  return VIEW.lineAll ? rawInput(state, 'all', keep || VIEW.keep) : rawInput(state, lineFilter, keep);
}

export function attentionRaw(state, lineFilter = 'all', keep = null, stationTitle = (l, s) => s) {
  return rawBuild(rawInput(state, lineFilter, keep), stationTitle);
}

function viewRows(input, title) {
  let rows = input;
  const info = rows.filter((e) => e.severity === 'advisory').length;
  if (VIEW.hideInfo) rows = rows.filter((e) => e.severity !== 'advisory');
  const all = rows.length;
  if (VIEW.kind) rows = rows.filter((e) => watchKind(e) === VIEW.kind);
  if (VIEW.mine) rows = rows.filter((e) => (e.who || []).includes(VIEW.mine));
  stats = { all, info, shown: rows.length };
  // по сроку эскалации (начальник смены): внутри уровня — самое давнее сверху
  if (VIEW.oldest) rows = [...rows].sort((x, y) => worse(x, y) || String(x.at || '').localeCompare(String(y.at || '')));
  return rows.map((e) => compactRow(e, title));
}

export function attentionFromState(state, lineFilter = 'all') {
  const title = (l, s) => humanizeCodes(state.lines.get(l)?.stations.get(s)?.title || placeTitle(s));
  return buildAttention(attentionInput(state, lineFilter), title);
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// «Уход режима, критерий 3» + «Уход режима, критерий 2» → «Уход режима, критерии 3 и 2»; прочее — через «+»
export function joinTitles(title, facts) {
  const all = [title, ...facts];
  const crit = all.map((t) => /^Уход режима, критерий (\d+)$/i.exec(t || ''));
  if (all.length > 1 && crit.every(Boolean)) return `Уход режима, критерии ${crit.map((m) => m[1]).join(' и ')}`;
  return [title, ...facts.map(lowerFirst)].join(' + ');
}

// Строка на объект в две строки текста (3.2): первая — всё, что случилось с объектом («Пропуск контроля + нарушение
// маршрута»), вторая — объект и где он («БД-01-0115; Сборочный участок, линия 2»); фраза ядра — в подсказке
export function compactRow(e, stationTitle = (l, s) => s) {
  const line = e.line_id ? lineTitle(e.line_id).replace(/^Л-/, 'линия ') : '';
  const place = [e.station_id ? shortStation(stationTitle(e.line_id, e.station_id)) : '', line].filter(Boolean).join(', ');
  const title = joinTitles(e.title, e.facts || []);
  const hint = [e.detail, e.hint].filter(Boolean).join('\n');
  // число повторов уже в подписи объекта («деталей: 2») — без «×2»
  // по карточке «ждёт инженера ОТК» уже говорит, чей ход, — «кому» не повторяется
  if (e.item_id && e.kind === 'card' && e.step) return { ...e, title, facts: [place, e.step].filter(Boolean), detail: '', where: '', hint, count: 1, who: [] };
  if (e.item_id || e.items?.length > 1) return { ...e, title, facts: place ? [place] : [], detail: '', where: '', hint, count: 1 };
  return { ...e, title, subject: place, facts: [], detail: '', where: '', hint };
}

// Три значка строки статуса (2.3): строки полосы текущего круга по обеим линиям, без «Мне»; свёртка вверх —
// строка объекта считается по худшему, что в ней есть
export function watchCounts(state, keep = null) {
  const out = { stop: 0, decision: 0, drift: 0 };
  if (!state?.lines?.size) return { stop: null, decision: null, drift: null };
  for (const e of attentionRaw(state, 'all', keep)) {
    const k = watchKind(e);
    if (k) out[k] += 1;
  }
  return out;
}
