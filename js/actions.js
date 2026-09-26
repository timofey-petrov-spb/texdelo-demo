// Решения на экранах (DOMAIN §8.1): allowed_actions — готовые решения «kind:action[:disposition]», уже
// отфильтрованные ядром по роли. Экран делит строку по двоеточию и отправляет POST /v1/decisions с этими полями;
// подпись кнопки — из справочника texts.js. Квитанции внешних систем на решение (API v1.3 DecisionView.receipts).
// Без DOM — проверяется node --test.

import {
  ACTION_TEXTS, CATEGORY_ORDER, CATEGORY_TEXTS, DISPOSITION_TEXTS, NEEDS_REASON, decisionText, receiptStatus, roleCode,
  systemTitle,
} from './texts.js';

// Ядро до API v1.3 присылало одно действие без вида: вид для действий над изделием в контракте однозначен
const LEGACY_KIND = {
  accept: 'acceptance', accept_after_rework: 'acceptance', return_for_rework: 'acceptance', hold: 'hold',
  release: 'hold', approve: 'approval', stop_operation: 'containment',
};
const PART = /^[a-z_]+$/;

export function parseAction(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const parts = s.split(':');
  if (parts.length === 1) {
    const kind = LEGACY_KIND[s];
    return kind ? { kind, action: s, disposition: null, code: `${kind}:${s}` } : null;
  }
  if (parts.length > 3 || !parts.every((p) => PART.test(p))) return null;
  const [kind, action, disposition = null] = parts;
  return { kind, action, disposition, code: s };
}

// Список готовых решений: без мусора и повторов, в порядке ядра
export function parseActions(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const a = parseAction(raw);
    if (a && !seen.has(a.code)) {
      seen.add(a.code);
      out.push(a);
    }
  }
  return out;
}

// Подпись кнопки. С целью (и ролью) — по словарю решений decisionText (SPEC.md 4): подпись зависит от цели, кода и
// роли. Без цели — прежняя подпись по action (для экранов, которые цель ещё не передают)
export function actionLabel(a, target, role) {
  if (!a) return '';
  if (target) {
    const t = decisionText(target, a, role);
    if (t.known) return t.label;
  }
  if (a.kind === 'disposition' && a.action === 'release') return 'Выпустить по разрешению на отклонение';
  if (a.disposition) {
    const d = DISPOSITION_TEXTS[a.disposition] || a.disposition;
    return `Решение: ${d}`;
  }
  return ACTION_TEXTS[a.action] || a.action;
}

export function needsReason(a) {
  return !!a && NEEDS_REASON.has(a.action);
}

// Клеймо ОТК — главная кнопка блока приёмки; остальные решения — второстепенные
export function isStamp(a) {
  return !!a && a.kind === 'acceptance' && (a.action === 'accept' || a.action === 'accept_after_rework');
}

export function splitActions(list) {
  const all = parseActions(list);
  return { stamp: all.find(isStamp) || null, others: all.filter((a) => !isStamp(a)) };
}

// Коррекция на месте — только с контрольным сроком (due_at): без него ядро отклонит решение (422)
export const DUE_CHOICES = [[60, 'через 1 час'], [120, 'через 2 часа'], [240, 'через 4 часа'], [480, 'до конца смены (8 часов)']];

export function needsDue(a) {
  return !!a && a.action === 'start_correction';
}

// Контрольный срок через minutes от now — момент с часовым поясом (AwareDatetime контракта)
export function dueAt(minutes, now = Date.now()) {
  return new Date(now + Math.max(1, Number(minutes) || 0) * 60000).toISOString();
}

// Категория дефекта обязательна при «Подтвердить несоответствие» (review:confirm по карточке): без неё у карточки нет
// решений дальше (INVENTORY.md 6.1-1). Отметка технолога тем же кодом категорию не ставит
export function needsCategory(a, target, role) {
  if (!a || a.kind !== 'review' || a.action !== 'confirm') return false;
  return decisionText(target || { kind: 'nonconformance' }, a, role).category;
}

// Тело POST /v1/decisions (DecisionRequest контракта); category — minor | major | critical → defect_category
export function decisionRequest(a, target, { reason, basedOnSeq, due, category } = {}) {
  const req = { kind: a.kind, action: a.action, target_kind: target.kind, target_id: target.id };
  if (a.disposition) req.disposition = a.disposition;
  if (category && CATEGORY_TEXTS[category]) req.defect_category = category;
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r) req.reason = r;
  if (Number.isFinite(basedOnSeq)) req.based_on_seq = basedOnSeq;
  if (due) req.due_at = due;
  return req;
}

// ---------- панель карточки (card_panel.js): варианты, чего не хватает, срез ----------
const MIN_REASON = 5;

// Роли, у которых «Удержать» есть в шапке детали: на панели карточки удержания нет (SPEC.md 4.1 п. 4); версии
// причины — в кабинете (у табло нет номера версии)
const SKIP_KINDS = new Set(['hold', 'hypothesis']);

// Варианты решения по карточке: только из allowed_actions, в порядке ядра; у каждого — подпись и пояснения
export function panelOptions(card, role) {
  const r = roleCode(role);
  const target = { kind: 'nonconformance', id: card?.nc_id };
  // «дальше: по категории …» — у карточки с категорией сразу кто: малозначительный — инженер ОТК, иначе начальник ОТК
  const cat = card?.defect_category;
  const who = cat ? (cat === 'minor' ? 'инженер ОТК' : 'начальник ОТК') : '';
  return parseActions(card?.allowed_actions).filter((a) => !SKIP_KINDS.has(a.kind)).map((a) => {
    const t = decisionText(target, a, r);
    const text = who && /^по категории/.test(t.next) ? { ...t, next: who } : t;
    return { a, code: a.code, text, target, category: needsCategory(a, target, r) };
  });
}

// Чего не хватает для подписи: '' — можно подписывать
export function missingText(opt, draft = {}) {
  if (!opt) return 'выберите решение';
  const need = [];
  if (opt.category && !CATEGORY_ORDER.includes(draft.category)) need.push('нужна категория');
  if (opt.text.reason === 'required' && String(draft.reason || '').trim().length < MIN_REASON) {
    need.push(`нужна причина (не короче ${MIN_REASON} знаков)`);
  }
  return need.join(', ');
}

// Подпись среза карточки: панель перестраивается, только когда меняется то, что видит человек (номер записи
// based_on_seq сюда не входит — он растёт с каждой записью по детали)
export function cardSig(c) {
  if (!c) return '';
  return [c.status, c.defect_category, c.disposition, (c.decisions || []).length, (c.allowed_actions || []).join(',')].join('|');
}

// Ключ идемпотентности (API v1.3): повтор того же нажатия не запишет решение дважды
export function idempotencyKey(rand = Math.random) {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `dec-${Date.now().toString(36)}-${Math.floor(rand() * 1e12).toString(36)}`;
}

// ---------- квитанции внешних систем ----------

function fromTimeline(e) {
  const status = (e.flags || []).find((f) => ['delivered', 'accepted', 'refused', 'error'].includes(f)) || null;
  const system = String(e.source_id || '').replace(/-\d+$/, '');
  return { system, status, detail: e.summary || '', received_at: e.occurred_at || null, seq: e.seq ?? null,
    receipt_no: null, source: 'timeline' };
}

// Квитанции на решение eventId: из самого решения (DecisionView.receipts — поток, карточка) и из дела изделия
// (записи external.receipt с receipt_for). Одна система — одна строка: последняя по seq.
export function receiptsFor(eventId, { decisions = [], timeline = [] } = {}) {
  if (!eventId) return [];
  const bySystem = new Map();
  // квитанция из решения полнее строки дела (статус, номер); среди равных — более поздняя
  const better = (r, old) => (r.source !== old.source ? r.source === 'decision' : (r.seq ?? 0) >= (old.seq ?? 0));
  const put = (r) => {
    const key = String(r.system || '?');
    const old = bySystem.get(key);
    if (!old || better(r, old)) bySystem.set(key, r);
  };
  const list = decisions instanceof Map ? [...decisions.values()] : decisions;
  for (const d of list || []) {
    if (d?.event_id !== eventId) continue;
    for (const r of d.receipts || []) put({ ...r, source: 'decision' });
  }
  for (const e of timeline || []) if (e?.receipt_for === eventId) put(fromTimeline(e));
  return [...bySystem.values()].sort((a, b) => systemTitle(a.system).localeCompare(systemTitle(b.system)));
}

// Строка квитанции: «MES — исполнено: изделие передано на склад (квитанция MES-004321)»
export function receiptText(r) {
  const st = r.status ? receiptStatus(r.status).label : '';
  const head = [systemTitle(r.system), st].filter(Boolean).join(' — ');
  const detail = r.source === 'timeline' ? r.detail.replace(/^[^:]+:\s*/, '') : r.detail;
  return `${head}${detail ? `: ${detail}` : ''}${r.receipt_no ? ` (квитанция ${r.receipt_no})` : ''}`;
}

// Худшая квитанция решения — для значка рядом с решением: сбой > отказ > ждёт > исполнено
export function worstReceipt(list) {
  const rank = { error: 0, refused: 1, delivered: 2, accepted: 3 };
  let worst = null;
  for (const r of list || []) if (!worst || (rank[r.status] ?? 2) < (rank[worst.status] ?? 2)) worst = r;
  return worst;
}
