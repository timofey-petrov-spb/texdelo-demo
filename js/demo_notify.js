// Оповещения в демо без ядра (DOMAIN §14.1, API v1.4 Notification): из активных предупреждений и открытых карточек
// сюжета — адресаты, каналы, срок подтверждения и эскалация по часам сюжета. «Стоп» без подтверждения уходит выше
// ступенями — как у ядра (config/rules.yaml, решение DOMAIN §9 от 26.09): начальнику смены, затем начальнику ОТК;
// карточка без решения — начальнику ОТК. После ступени due_at — срок следующей.
// «Принял» (review:take_review) — поправка поверх сюжета. Без DOM — проверяется node --test.

import { isStopWarning } from './attention.js';
import { cardLabel } from './names.js';
import { warningKey } from './state.js';

// Сроки ядра — 5 (+10) и 30 минут; демо-смена ускорена (детали идут каждые 11 с), и сроки в демо короче — 3 (+6) и 10
// минут по часам сюжета: эскалация «стопа» по БД-01-0094 видна на первой минуте сюжета
export const DEMO_ESCALATION = { stop_ms: 3 * 60000, card_ms: 10 * 60000,
  stop_steps: [{ ms: 3 * 60000, to: ['shift_supervisor'] }, { ms: 6 * 60000, to: ['qc_head'] }],
  card_steps: [{ ms: 10 * 60000, to: ['qc_head'] }] };
const CLOSED = new Set(['closed', 'not_confirmed']);

function iso(ms) {
  return new Date(ms).toISOString();
}

// Активные предупреждения сюжета с линией: списки участков и отдельные предупреждения по деталям
function activeWarnings(state) {
  const out = new Map();
  for (const [key, list] of state.stationWarnings || []) {
    const lid = key.slice(0, key.lastIndexOf('/'));
    for (const w of list) if (w?.warning_id && !out.has(w.warning_id)) out.set(w.warning_id, { w, line_id: lid });
  }
  for (const [k, w] of state.warnings || []) {
    if (!w?.warning_id || out.has(w.warning_id) || state.resolved?.has(k) || state.resolved?.has(warningKey(w))) continue;
    out.set(w.warning_id, { w, line_id: state.items?.get(w.item_id)?.line_id || null });
  }
  return [...out.values()];
}

// Каналы — как у ядра на стенде с worker интеграций (API v1.7): терминал MES участка (только у «стопа» с участком)
// и письмо в ящик роли доставлены — у ядра это статус по квитанции worker, без неё было бы pending
function channels(level, at, role, station) {
  const rows = [{ channel: 'workstation', status: 'delivered', at }];
  if (level === 'stop' && station) {
    rows.push({ channel: 'mes_terminal', status: 'delivered', at, to: station, detail: `Терминал MES участка ${station}` });
  }
  rows.push({ channel: 'mail', status: 'delivered', at, to: role, detail: `Внутренняя почта: письмо в ящик роли ${role}` });
  return rows;
}

// Решение человека по предупреждению или карточке (любое, из потока) — это и есть подтверждение получения
function decidedBy(state, id) {
  let first = null;
  for (const d of state.decisions?.values() || []) {
    if (d?.target_id === id && d.decided_at && (!first || d.decided_at < first.at)) first = { by: d.author_id || '—', at: d.decided_at };
  }
  return first;
}

export function demoNotifications(state, { acks = new Map(), now = Date.now(), role = null } = {}) {
  const out = [];
  const add = (src, roles, base, startMs, steps) => {
    const ack = acks.get(src.source_id) || decidedBy(state, src.source_id);
    let at = startMs;
    const plan = Number.isFinite(startMs) ? steps.map((s) => ({ to: s.to, due: (at += s.ms) })) : [];
    const done = ack ? [] : plan.filter((s) => now >= s.due);
    const to = done.flatMap((s) => s.to);
    for (const r of roles) {
      const n = { ...src, notification_id: `${src.source_id}|${r}`, addressee_role: r, ...base,
        channels: channels(src.level, base.raised_at, r, src.station_id) };
      if (plan.length) n.due_at = iso((plan[done.length] || plan[plan.length - 1]).due);
      if (ack) Object.assign(n, { acknowledged_at: ack.at, acknowledged_by: ack.by });
      if (done.length) Object.assign(n, { escalated_to: to, escalated_at: iso(done[done.length - 1].due) });
      n.allowed_actions = !ack && role && (role === r || to.includes(role)) ? ['review:take_review'] : [];
      out.push(n);
    }
  };
  for (const { w, line_id: lineId } of activeWarnings(state)) {
    const stop = isStopWarning(w);
    const raised = Date.parse(w.raised_at);
    const src = { source_kind: 'warning', source_id: w.warning_id, level: stop ? 'stop' : w.level === 'info' ? 'info' : 'warning',
      title: w.title, station_id: w.station_id || undefined, line_id: lineId || undefined, item_id: w.item_id || undefined };
    const roles = Array.isArray(w.addressees) && w.addressees.length ? w.addressees : ['controller'];
    add(src, roles, { raised_at: Number.isFinite(raised) ? w.raised_at : iso(now) },
      stop && Number.isFinite(raised) ? raised : NaN, DEMO_ESCALATION.stop_steps);
  }
  for (const c of state.cards?.values() || []) {
    if (!c?.nc_id || CLOSED.has(c.status)) continue;
    const opened = Date.parse(c.opened_at);
    const it = state.items?.get(c.item_id);
    const src = { source_kind: 'card', source_id: c.nc_id, level: 'warning', title: cardLabel(c),
      station_id: it?.station_id || undefined, line_id: it?.line_id || undefined, item_id: c.item_id || undefined };
    const minor = c.defect_category === 'minor';
    add(src, ['controller'], { raised_at: Number.isFinite(opened) ? c.opened_at : iso(now) },
      !minor && Number.isFinite(opened) ? opened : NaN, DEMO_ESCALATION.card_steps);
  }
  return out;
}

// Решение «Принял» в демо: только адресат (или тот, кому эскалировано); ответ — как у ядра на POST /v1/decisions
export function demoAck(req, role, list, { acks, at }) {
  const mine = (list || []).filter((n) => n.source_id === req.target_id);
  if (!mine.length) return { http: 422, result: { status: 'rejected', detail: 'Оповещение не найдено — возможно, уже закрыто.' } };
  if (mine.some((n) => n.acknowledged_at)) {
    return { http: 202, result: { status: 'accepted', detail: 'Оповещение уже принято.' } };
  }
  if (!mine.some((n) => (n.allowed_actions || []).includes('review:take_review'))) {
    return { http: 403, result: { status: 'forbidden', detail: `Оповещение адресовано другой роли; у роли «${role?.title || '—'}» права нет — отказ записан.` } };
  }
  acks.set(req.target_id, { by: role?.actor || role?.id || '—', at });
  return { http: 202, result: { status: 'accepted', detail: 'Получение оповещения записано в журнал.' } };
}
