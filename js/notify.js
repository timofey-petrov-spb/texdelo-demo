// Оповещения (DOMAIN §14.1, API v1.4 Notification): у строки полосы «Требует действия» — кому ушло оповещение,
// сколько осталось до эскалации, кто и когда получил, кому эскалировано. «Получил» — готовое решение
// review:take_review из allowed_actions оповещения (DOMAIN §8.1). Без DOM — проверяется node --test.
// Живые отсчёты («до эскалации 4 мин 05 с», «следующая ступень через …») в text не входят: text — подпись строки,
// она не меняется каждую секунду; отсчёт по dueMs пишет тикер полосы через dueText (К37, П0).

import { decisionRequest, parseActions } from './actions.js';
import { fmtTime, parseTime } from './format.js';
import { CHANNEL_TEXTS, roleTitle } from './texts.js';

const pad = (n) => String(n).padStart(2, '0');

// «4 мин 05 с», «45 с», «1 ч 02 мин»
export function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${pad(s % 60)} с`;
  return `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`;
}

// Оповещения строки полосы: по источнику (предупреждение или карточка), иначе по детали, иначе по участку
export function notificationsFor(entry, list) {
  const all = Array.isArray(list) ? list.filter((n) => n && n.notification_id) : [];
  const src = new Set(entry?.sources || []);
  const bySource = all.filter((n) => n.source_id && src.has(n.source_id));
  if (bySource.length) return bySource;
  if (entry?.item_id) return all.filter((n) => n.item_id === entry.item_id && !n.source_id);
  if (entry?.station_id) {
    return all.filter((n) => !n.item_id && n.station_id === entry.station_id && (!n.line_id || !entry.line_id || n.line_id === entry.line_id)
      && !n.source_id);
  }
  return [];
}

// Кому уйдёт оповещение на следующей ступени (SPEC 3.2: «до начальника смены 3 мин»). Ступени — config/rules.yaml
// ядра (notifications.routes): «стоп» — начальнику смены через 5 мин, затем начальнику ОТК через 10; карточка
// значительная — начальнику ОТК через 30 мин. В оповещении ядра следующей ступени нет — неизвестно, «до эскалации»
const ROLE_GEN = { shift_supervisor: 'начальника смены', qc_head: 'начальника ОТК', manager: 'руководителя производства' };

export function nextStep(n) {
  if (!n || n.acknowledged_at) return null;
  const esc = n.escalated_to || [];
  if (n.level === 'stop') {
    if (!esc.includes('shift_supervisor')) return 'shift_supervisor';
    return esc.includes('qc_head') ? null : 'qc_head';
  }
  if (n.source_kind === 'card' && n.due_at) return esc.includes('qc_head') ? null : 'qc_head';
  return null;
}

// Живой отсчёт до срока: у ожидания — «до начальника смены 3 мин 05 с» (или «до эскалации …», если ступень
// неизвестна) / «срок подтверждения истёк — эскалация»; у эскалации — «до начальника ОТК …» или «следующая ступень
// через …», срок прошёл — ступеней больше нет, пусто. Пишет его только тикер полосы.
export function dueText(state, leftMs, next = null) {
  const to = next && ROLE_GEN[next] ? `до ${ROLE_GEN[next]}` : '';
  if (state === 'waiting') return leftMs > 0 ? `${to || 'до эскалации'} ${fmtLeft(leftMs)}` : 'срок подтверждения истёк — эскалация';
  if (state === 'escalated') return leftMs > 0 ? (to ? `${to} ${fmtLeft(leftMs)}` : `следующая ступень через ${fmtLeft(leftMs)}`) : '';
  return '';
}

// Состояние одного оповещения на момент nowMs. text — без секунд (подпись строки полосы), dueMs — срок, до которого
// идёт отсчёт (у ожидания — эскалация, у эскалации — следующая ступень), next — отсчёт на момент nowMs
// Квитирование — по источнику (DOMAIN §14.1, ядро К20): получил один адресат — оповещение снято у всех адресатов
// этого предупреждения или карточки; эскалация, случившаяся раньше, остаётся в строке
export function escalation(n, nowMs = Date.now()) {
  if (!n) return { state: 'none', text: '' };
  if (n.acknowledged_at) {
    const esc = (n.escalated_to || []).length ? `; эскалировано: ${n.escalated_to.map(roleTitle).join(', ')}` : '';
    return { state: 'acknowledged', text: `получил${n.acknowledged_by ? ` ${n.acknowledged_by}` : ''} в ${fmtTime(n.acknowledged_at)}${esc}` };
  }
  if ((n.escalated_to || []).length) {
    // ступени эскалации (К34): после ступени due_at — срок следующей; прошёл — ступеней больше нет
    const due = parseTime(n.due_at)?.getTime();
    const left = Number.isFinite(due) ? due - nowMs : 0;
    const step = nextStep(n);
    return { state: 'escalated', text: `эскалировано: ${n.escalated_to.map(roleTitle).join(', ')}`,
      dueMs: left > 0 ? due : null, next: dueText('escalated', left, step), step, at: n.escalated_at || null };
  }
  const due = parseTime(n.due_at);
  if (!due) return { state: 'none', text: '' };
  const left = due.getTime() - nowMs;
  if (left <= 0) return { state: 'overdue', leftMs: 0, text: dueText('waiting', 0) };
  const step = nextStep(n);
  return { state: 'waiting', leftMs: left, dueMs: due.getTime(), step, text: dueText('waiting', left, step) };
}

const RANK = { overdue: 0, escalated: 1, waiting: 2, none: 3, acknowledged: 4 };

// Что показать в строке: сначала то, что горит (истекло, эскалировано), потом ближайший срок
export function summarize(list, nowMs = Date.now()) {
  // полученное по источнику — получено всеми его адресатами, даже если ядро отдало квитанцию только в одном оповещении
  const took = new Map();
  for (const n of list || []) if (n?.acknowledged_at && n.source_id && !took.has(n.source_id)) took.set(n.source_id, n);
  const acked = (n) => (n.acknowledged_at || !took.has(n.source_id) ? n
    : { ...n, acknowledged_at: took.get(n.source_id).acknowledged_at, acknowledged_by: took.get(n.source_id).acknowledged_by });
  const rows = (list || []).map((n) => {
    const x = acked(n);
    return { n: x, e: escalation(x, nowMs) };
  });
  if (!rows.length) return null;
  rows.sort((a, b) => RANK[a.e.state] - RANK[b.e.state] || (a.e.leftMs ?? Infinity) - (b.e.leftMs ?? Infinity));
  const roles = [...new Set(rows.map((r) => r.n.addressee_role).filter(Boolean))];
  // кому — адресаты и те, кому уже эскалировано (у начальника смены после эскалации строка — «ему»)
  const reached = [...new Set([...roles, ...rows.flatMap((r) => (r.e.state === 'acknowledged' ? [] : r.n.escalated_to || []))])];
  const top = rows[0];
  return { to: roles.map(roleTitle).join(', '), roles: reached, step: top.e.step || null, state: top.e.state, text: top.e.text, dueMs: top.e.dueMs ?? null, next: top.e.next || '',
    top: top.n, open: rows.filter((r) => r.e.state !== 'acknowledged').map((r) => r.n) };
}

// Подпись оповещения для полосы: кому, состояние, текст без секунд, есть ли срок. Живые отсчёты в неё не входят —
// тикер меняет секунды, а строка и полоса не пересобираются (у ожидания text несёт секунды — он не входит)
export function noteRowSig(note) {
  if (!note) return '';
  return [note.to, note.state, note.state === 'waiting' ? '' : note.text, Boolean(note.dueMs)].join('~');
}

// «Получил»: решения review:take_review по всем неподтверждённым оповещениям строки, которые ядро дало этой роли, —
// по одному на источник (предупреждение или карточку). В строке «Пропуск контроля + нарушение маршрута» два
// источника: одно нажатие получает оба (QA Ф14)
export function takeReviews(list) {
  const took = new Set((list || []).filter((n) => n?.acknowledged_at && n.source_id).map((n) => n.source_id));
  const out = [];
  const seen = new Set();
  for (const n of list || []) {
    if (!n || n.acknowledged_at || took.has(n.source_id) || !n.source_id || seen.has(n.source_id)) continue;
    const a = parseActions(n.allowed_actions).find((x) => x.kind === 'review' && x.action === 'take_review');
    if (!a) continue;
    seen.add(n.source_id);
    out.push({ n, action: a });
  }
  return out;
}

// Первое из них (для подписи строки) и все — в all
export function takeReview(list) {
  const all = takeReviews(list);
  return all.length ? { ...all[0], all } : null;
}

export function takeRequest(n, action) {
  const kind = n.source_kind === 'card' ? 'nonconformance' : 'warning';
  return decisionRequest(action, { kind, id: n.source_id }, { reason: 'оповещение получено' });
}

// Журнал каналов: «рабочее место — доставлено; терминал MES — доставлено; внутренняя почта — ждёт доставки»
// (API v1.7: терминал и почту доставляет worker интеграций, ядро ставит статус по его квитанции)
const CH_STATUS = { pending: 'ждёт доставки', delivered: 'доставлено', failed: 'не доставлено' };

export function channelsText(n) {
  return (n?.channels || []).map((c) => `${CHANNEL_TEXTS[c.channel] || c.channel} — ${CH_STATUS[c.status] || c.status}`).join('; ');
}

// Список оповещений полосы «Требует действия»: когда брать заново и для какой роли. Не чаще одного запроса в gapMs
// (живой стенд меняет полосу часто); смена роли сразу убирает оповещения и кнопки «Получил» прежней роли, а ответ,
// пришедший для неё, не показывается; роли не положено читать оповещения (401, 403) — список пуст; ядро без API v1.4
// (404) — больше не спрашивать. poll — редкий опрос, пока у строк есть неподтверждённые: эскалацию ядро делает по
// своим часам, «Получил» может прийти с другого рабочего места. Часы и отложенный вызов передаются — без DOM.
export function noteFeed({ load, onChange, gapMs = 2000, pollMs = 30000, clock = () => Date.now(),
  later = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let notes = [];
  let gen = 0;
  let lastFetch = 0;
  let fetching = false;
  let again = false;
  let waiting = false;
  let unsupported = false;

  async function refresh(force = false) {
    if (unsupported || typeof load !== 'function') return;
    const wait = gapMs - (clock() - lastFetch);
    if (!force && wait > 0) {
      if (!waiting) {
        waiting = true;
        later(() => {
          waiting = false;
          refresh();
        }, wait);
      }
      return;
    }
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    lastFetch = clock();
    const my = gen;
    try {
      const got = await load();
      if (my === gen) notes = Array.isArray(got) ? got : [];
    } catch (e) {
      if (e?.status === 404) unsupported = true;
      if (my === gen && (e?.status === 401 || e?.status === 403)) notes = [];
    } finally {
      fetching = false;
    }
    if (my !== gen) again = true; // ответ был для прежней роли — спросить заново уже для новой
    onChange?.();
    if (again) {
      again = false;
      refresh(true);
    }
  }

  return {
    get list() {
      return notes;
    },
    refresh,
    roleChanged() {
      gen += 1;
      notes = [];
      unsupported = false;
      lastFetch = 0;
    },
    poll(pending) {
      if (pending && clock() - lastFetch >= pollMs) refresh();
    },
  };
}
