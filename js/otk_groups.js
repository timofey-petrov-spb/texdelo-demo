// Приёмка ОТК (SPEC 3.7; К37, П5): очередь тремя группами по сводке детали (ItemSummary) — без запроса профиля
// на каждую строку. «Готовы к приёмке» / «Мешает» (одна главная причина словом) / «Ещё в пути» + «Принято ОТК».
// Готовность по сводке — ориентир: у выбранной детали решает профиль (acceptance.allowed) — не разрешена, строка
// уходит в «Мешает» с причиной ядра. Порядок в группе — как детали пришли к ОТК, обновление его не меняет.
// Без DOM — проверяется node --test (k16.test.mjs).

import { checklist } from './checklist.js';
import { clean } from './group.js';
import { lapOf, latestPerDetail, runVisible } from './lap.js';
import { itemLineId, otkQueue } from './state.js';

const DONE = new Set(['accepted_qc', 'accepted_concession', 'scrapped']);

// Главная причина «Мешает» по сводке, по старшинству SPEC 3.7: пропуск контроля → удержана → открыта карточка →
// у границы → оценка невозможна. null — по сводке мешать нечему.
export function summaryReason(it) {
  const cov = it?.coverage || {};
  if (Number(cov.skipped) > 0) return { key: 'skip', icon: '✕', text: 'пропуск контроля' };
  if (it?.on_hold) return { key: 'hold', icon: '⏸', text: 'удержана' };
  const cards = Number(it?.open_cards) || 0;
  if (cards > 1) return { key: 'card', icon: '!', text: `открыто карточек: ${cards}` };
  if (cards === 1) return { key: 'card', icon: '!', text: 'открыта карточка' };
  if (it?.zone === 'beyond_limit') return { key: 'near', icon: '✕', text: 'признаки несоответствия' };
  if (it?.zone === 'near_limit') return { key: 'near', icon: '!', text: 'у границы допуска' };
  if (it?.zone === 'not_assessable' || Number(cov.unreliable) > 0) return { key: 'unreliable', icon: '?', text: 'оценка невозможна' };
  if (Array.isArray(cov.missing) && cov.missing.length && !(Number(cov.pending) > 0)) {
    return { key: 'missing', icon: '○', text: 'нет результата точки контроля' };
  }
  return null;
}

// Причина из профиля выбранной детали: первое препятствие ядра словами, первая часть фразы
export function profileReason(p) {
  const first = (p?.acceptance?.blockers || [])[0];
  const raw = typeof first === 'string' ? first : first?.text || first?.title || '';
  const text = clean(String(raw || '')).split(/[;:]\s/)[0].trim();
  return { key: 'profile', icon: '!', text: text ? text[0].toLowerCase() + text.slice(1) : 'ядро не разрешает приёмку' };
}

// Что знаем из профиля выбранной детали: { allowed, stamped, onWay, reason }. Причина — из чек-листа страницы
// детали (checklist.js, К39): первая невыполненная строка «✕» до « — » («пропущена проверка: контроль скрытых
// работ»); ждёт только дороги (●: «ещё в пути») — строка в «Ещё в пути», а не в «Мешает»
export function profileVerdict(p) {
  if (!p?.acceptance) return null;
  if (p.acceptance.stamp) return { allowed: false, stamped: true, onWay: false, reason: null };
  if (p.acceptance.allowed) return { allowed: true, stamped: false, onWay: false, reason: null };
  let c = null;
  try {
    c = checklist(p);
  } catch {
    c = null;
  }
  if (c && !c.people && c.onWay) return { allowed: false, stamped: false, onWay: true, reason: null };
  const line = (c?.rows || []).flatMap((r) => r.lines || []).find((l) => l.mark === '✕' && l.text);
  if (line) {
    const t = clean(String(line.text).split(' — ')[0]).trim();
    if (t) return { allowed: false, stamped: false, onWay: false, reason: { key: 'profile', icon: '!', text: t[0].toLowerCase() + t.slice(1) } };
  }
  return { allowed: false, stamped: false, onWay: false, reason: profileReason(p) };
}

// Порядок прихода к ОТК: номер присваивается, когда деталь впервые видна в очереди; пришедшие одним пакетом —
// по номеру детали. arrival — Map, живёт, пока открыт экран
export function arrive(arrival, ids) {
  let next = arrival.size;
  for (const id of [...ids].filter((x) => !arrival.has(x)).sort()) arrival.set(id, next++);
  return arrival;
}

const byArrival = (arrival) => (a, b) => (arrival.get(a.item_id) ?? 1e9) - (arrival.get(b.item_id) ?? 1e9)
  || String(a.item_id).localeCompare(String(b.item_id));

// Группы очереди. opts: line ('all' | 'L-1' …), lap ('current' | 'all'), verdicts (Map itemId → profileVerdict),
// arrival (Map). Возвращает { ready, blocked, transit, accepted } — у строк { it, reason }
export function otkGroups(state, { line = 'all', lap = 'current', verdicts = new Map(), arrival = new Map() } = {}) {
  const queue = otkQueue(state, line, lap);
  arrive(arrival, queue.map((it) => it.item_id));
  // «в пути» — не у ОТК вовсе: деталь прошлого круга у ОТК, скрытая своим двойником, туда не попадает
  const inQueue = new Set(otkQueue(state, line, 'all').map((it) => it.item_id));
  const ready = [];
  const blocked = [];
  const transit = [];
  const accepted = [];
  for (const it of [...queue].sort(byArrival(arrival))) {
    const v = verdicts.get(it.item_id);
    if (v?.stamped) {
      accepted.push({ it, reason: null });
      continue;
    }
    // у ОТК, но проверки ещё идут (pending > 0) — «Ещё в пути», а не «Мешает» (SPEC 3.7): иначе каждая пришедшая
    // деталь сначала мелькала в «Мешает» с «нет результата точки контроля»
    if ((Number(it.coverage?.pending) > 0 || v?.onWay) && !summaryReason(it)) {
      transit.push({ it, reason: null, checking: true });
      continue;
    }
    const reason = summaryReason(it) || (v && !v.allowed ? v.reason : null);
    if (reason) blocked.push({ it, reason });
    else ready.push({ it, reason: null });
  }
  for (const it of state.items.values()) {
    if (inQueue.has(it.item_id)) continue;
    const lid = itemLineId(state, it);
    if (line !== 'all' && lid !== line) continue;
    if (lap !== 'all' && !runVisible(state, it.item_id)) continue;
    if (it.accepted || ['accepted_qc', 'accepted_concession'].includes(it.status)) accepted.push({ it, reason: null });
    else if (!DONE.has(it.status)) transit.push({ it, reason: null });
  }
  const byId = (a, b) => String(a.it.item_id).localeCompare(String(b.it.item_id));
  // по одной детали на номер в каждой группе — последнего круга (lap.js)
  const latest = (rows) => {
    if (lap === 'all') return rows;
    const keep = latestPerDetail(state, rows.map((x) => x.it.item_id));
    return rows.filter((x) => keep.has(x.it.item_id));
  };
  return { ready, blocked, transit: latest(transit).sort(byId), accepted: latest(accepted).sort(byId) };
}

// Числа для «Показать: Обе линии 12 · Линия 1 7 · Линия 2 5» — детали у ОТК (готовы и мешает) по линиям; те, у
// которых приёмочный контроль ещё идёт (они в «Ещё в пути»), не считаются
export function lineCounts(state, lap = 'current') {
  const out = { all: 0 };
  for (const it of otkQueue(state, 'all', lap)) {
    if (Number(it.coverage?.pending) > 0 && !summaryReason(it)) continue;
    const lid = itemLineId(state, it);
    out.all += 1;
    out[lid] = (out[lid] || 0) + 1;
  }
  return out;
}

// Деталь прошлого круга среди деталей текущего: подписать круг («круг 1»), иначе номера совпадут
export function staleLap(state, itemId) {
  const n = lapOf(itemId);
  if (n === null) return '';
  let top = 0;
  for (const id of state.items.keys()) {
    const m = lapOf(id);
    if (m !== null && m > top && runVisible(state, id)) top = m;
  }
  return n < top ? `круг ${n}` : '';
}

// «Линия 1» для L-1
export function lineName(id) {
  const m = /^[A-ZА-Я]+-(\d+)$/.exec(String(id || ''));
  return m ? `Линия ${m[1]}` : String(id || '');
}

// Линия роли по её названию («QC-01, инженер ОТК, линия Л-1» → L-1); нет — обе линии
export function roleLine(role) {
  if (/^L-\d+$/.test(String(role?.line || ''))) return role.line; // roles.js (К38) уже разобрал линию роли
  const m = /лини[яи]\s+(?:Л|L)-(\d+)/i.exec(String(role?.title || ''));
  return m ? `L-${m[1]}` : 'all';
}

// Соседняя деталь для ↑ ↓ и «3 из 12»: по видимому порядку «Готовы» + «Мешает»
export function neighbour(ids, currentId, step) {
  if (!ids.length) return null;
  const i = ids.indexOf(currentId);
  if (i < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, i + step))];
}

export function positionText(ids, currentId) {
  const i = ids.indexOf(currentId);
  return i < 0 ? `${ids.length}` : `${i + 1} из ${ids.length}`;
}
