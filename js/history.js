// «История» детали (К35 → К39, П4д; SPEC 3.4.6). В общем потоке страницы, без своей прокрутки. Два тона: решения
// людей — карточкой (что решено, кто, когда, причина, квитанции MES и 1С одной строкой); записи станков, приёма и
// писем — серой строкой. Однотипные подряд — одной строкой «Станок — 6 записей ▸». Переключатели «Все события /
// Решения людей» и «Сначала новые / По порядку»; 20 записей и «Показать ещё 20». Узел один между перерисовками
// детали: раскрытое, выбранные переключатели и придержка новых записей не теряются. Прокрутил страницу вниз к
// истории — новые записи сверху не вставляются, плашка «новых записей: N — показать». Флаги приёма — словами
// (plain.js), служебные — только в подсказке.

import { receiptsFor } from './actions.js';
import { SEP } from './checklist.js';
import { clear, h } from './dom.js';
import { EVENT_TYPES, fmtDateTime, fmtTime, plural } from './format.js';
import { clean } from './group.js';
import { freshText, holdSplit, HOLD_PX, topSeq } from './hold.js';
import { flagTexts } from './plain.js';
import { ACTION_DONE, receiptStatus, roleTitle, systemTitle } from './texts.js';

export const PAGE = 20;
export const RUN_MIN = 3; // столько однотипных подряд — уже одна строка

// Группа для свёртки подряд идущих: письма и квитанции — вместе, остальное — по виду записи
export function runKind(e) {
  const t = String(e?.event_type || '');
  if (t === 'external.receipt' || t.startsWith('notification.')) return 'mail';
  return t;
}
const RUN_TITLES = { mail: 'Письма и квитанции', 'equipment.state': 'Станок', 'inspection.result': 'Контроль',
  'operation.started': 'Начало операций', 'operation.finished': 'Конец операций' };

export function isHuman(e) {
  return e?.event_type === 'decision.recorded' || e?.kind === 'decision';
}

// Строки истории: записи дела + решения из потока, которых в деле ещё нет (по номеру записи), по порядку
export function historyRows(timeline, decisions = [], { humansOnly = false, oldestFirst = false } = {}) {
  const seen = new Set((timeline || []).map((e) => e?.seq).filter((s) => s != null));
  const rows = [...(timeline || []).filter(Boolean)];
  for (const d of decisions || []) {
    if (d && d.seq != null && !seen.has(d.seq)) rows.push({ kind: 'decision', seq: d.seq, occurred_at: d.decided_at, decision: d });
  }
  const bySeq = new Map((decisions || []).filter((d) => d?.seq != null).map((d) => [d.seq, d]));
  for (const r of rows) if (r.event_type === 'decision.recorded' && bySeq.has(r.seq)) r.decision = bySeq.get(r.seq);
  const list = humansOnly ? rows.filter(isHuman) : rows;
  return list.sort((a, b) => (oldestFirst ? 1 : -1) * ((a.seq ?? 0) - (b.seq ?? 0)));
}

// Однотипные подряд (не решения) — в одну группу: [{ run: true, kind, items }] или сама запись
export function foldRuns(rows, min = RUN_MIN) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const k = isHuman(rows[i]) ? null : runKind(rows[i]);
    let j = i + 1;
    while (k && j < rows.length && !isHuman(rows[j]) && runKind(rows[j]) === k) j += 1;
    if (k && j - i >= min) out.push({ run: true, kind: k, key: `${k}:${rows[i].seq}`, items: rows.slice(i, j) });
    else out.push(...rows.slice(i, j));
    i = j;
  }
  return out;
}

function hhmm(iso) {
  return iso ? fmtTime(iso).slice(0, 5) : '';
}

// Система квитанции: «MES-01-RCPT» (строка дела) и «MES» (решение) — одна система; ONEC — 1С, MAIL — почта
const SYSTEM_WORDS = { MAIL: 'почта' };
export function systemOf(s) {
  const x = String(s || '').toUpperCase().replace(/-RCPT$/, '').replace(/-\d+$/, '');
  return x === 'ONEC' ? '1C' : x;
}

// «MES: исполнено 14:06 · 1С: доставлено 14:06» — одна строка на систему, со статусом важнее без статуса
export function receiptsLine(list) {
  const by = new Map();
  for (const r of list || []) {
    const k = systemOf(r.system);
    if (!by.has(k) || (!by.get(k).status && r.status)) by.set(k, r);
  }
  return [...by.entries()].map(([k, r]) => `${SYSTEM_WORDS[k] || systemTitle(k)}: ${r.status ? receiptStatus(r.status).label : 'квитанция получена'}`
    + `${r.received_at ? ` ${hhmm(r.received_at)}` : ''}`).join(SEP);
}

function humanRow(e, timeline, decisions) {
  const d = e.decision;
  const head = d ? [ACTION_DONE[d.action] || 'решение', [roleTitle(d.role), d.author_id].filter(Boolean).join(' '), hhmm(d.decided_at)]
    .filter(Boolean).join(SEP) : `${clean(e.summary)}${e.occurred_at ? `${SEP}${hhmm(e.occurred_at)}` : ''}`;
  const rc = d?.event_id ? receiptsLine(receiptsFor(d.event_id, { decisions, timeline })) : '';
  return h('li', { class: 'tl-e tl-human', dataset: { seq: String(e.seq ?? '') } }, [
    h('b', { class: 'tl-dh', text: head.charAt(0).toUpperCase() + head.slice(1) }),
    d?.reason ? h('span', { class: 'tl-why', text: `Причина: ${d.reason}` }) : null,
    rc ? h('span', { class: 'tl-rc', title: 'квитанции внешних систем', text: rc }) : null,
  ]);
}

function row(e, open) {
  const flags = flagTexts(e.flags);
  const loud = flags.filter((f) => !f.quiet);
  const quiet = flags.filter((f) => f.quiet);
  const li = h('li', { class: `tl-e tl-${String(e.event_type || '').replace('.', '-')}`, dataset: { seq: String(e.seq ?? '') } }, [
    h('time', { title: fmtDateTime(e.occurred_at), text: fmtTime(e.occurred_at) }),
    h('span', { class: 'tl-tag', text: EVENT_TYPES[e.event_type] || 'запись' }),
    h('span', { class: 'tl-s', text: clean(e.summary) }),
    e.signed_by ? h('span', { class: 'tl-sig', title: `запись подписана ключом ${e.signed_by}`, text: '✓' }) : null,
  ]);
  if (loud.length || e.basis || e.reason) {
    const more = h('details', { class: 'tl-more', open: open.has(String(e.seq)) || null, ontoggle: () => {
      if (more.open) open.add(String(e.seq));
      else open.delete(String(e.seq));
    } }, [
      h('summary', { text: loud.length ? loud.map((f) => f.text).join('; ') : 'подробнее' }),
      e.reason ? h('p', { text: `Причина: ${e.reason}` }) : null,
      e.basis ? h('p', { text: `Основание зоны: ${clean(e.basis)}` }) : null,
      loud.length ? h('p', { class: 'muted', text: 'Отметки приёма записи ядром — запись принята и в журнале.' }) : null,
    ]);
    li.append(more);
  }
  if (quiet.length) li.title = quiet.map((f) => f.text).join('; ');
  return li;
}

function runRow(g, open) {
  const first = g.items[g.items.length - 1];
  const last = g.items[0];
  const span = [hhmm(first.occurred_at), hhmm(last.occurred_at)].filter(Boolean);
  const d = h('details', { class: 'tl-run', open: open.has(g.key) || null, ontoggle: () => {
    if (d.open) open.add(g.key);
    else open.delete(g.key);
  } }, [h('summary', { text: `${RUN_TITLES[g.kind] || EVENT_TYPES[g.kind] || 'Записи'} — ${g.items.length} ${plural(g.items.length, 'запись', 'записи', 'записей')}${span.length ? `, ${[...new Set(span)].join('–')}` : ''}` }),
    h('ol', { class: 'tl tl-in' }, g.items.map((e) => row(e, open)))]);
  return h('li', { class: 'tl-e tl-group', dataset: { seq: String(g.items[0].seq ?? '') } }, [d]);
}

export function createHistory() {
  const count = h('span', { class: 'count' });
  const bar = h('button', { class: 'fresh-bar', type: 'button', hidden: true, onclick: () => show() });
  const list = h('ol', { class: 'tl' });
  const more = h('button', { type: 'button', class: 'btn btn-small tl-more-b', hidden: true, onclick: () => { limit += PAGE; sig = ''; paint(); } });
  const state = { humansOnly: false, oldestFirst: false };
  const chip = (text, key, val) => h('button', { type: 'button', class: 'chip', dataset: { k: key, v: String(val) }, text,
    onclick: () => { state[key] = val; limit = PAGE; frozen = null; sig = ''; paint(); } });
  const tools = h('div', { class: 'tl-tools' }, [
    h('div', { class: 'chk-filter', role: 'group', 'aria-label': 'Какие записи' }, [chip('Все события', 'humansOnly', false), chip('Решения людей', 'humansOnly', true)]),
    h('div', { class: 'chk-filter', role: 'group', 'aria-label': 'Порядок' }, [chip('Сначала новые', 'oldestFirst', false), chip('По порядку', 'oldestFirst', true)]),
  ]);
  const el = h('div', { class: 'pf-history' }, [h('p', { class: 'tl-count muted' }, ['Записей: ', count]), tools, bar, list, more]);
  const open = new Set();
  let timeline = [];
  let decisions = [];
  let frozen = null;
  let sig = '';
  let limit = PAGE;
  let lastTop = null; // самая новая запись, которую человек видит

  // Страница прокручена так, что начало списка ушло вверх, — человек читает историю: новое сверху придерживаем
  function held() {
    if (state.oldestFirst || !list.isConnected) return false;
    const view = list.closest('.view');
    if (!view) return false;
    return list.getBoundingClientRect().top < view.getBoundingClientRect().top - HOLD_PX;
  }

  function paint() {
    const rows = historyRows(timeline, decisions, state);
    const { shown, fresh } = holdSplit(rows, frozen);
    bar.hidden = !fresh;
    if (fresh && bar.textContent !== freshText(fresh)) bar.textContent = freshText(fresh);
    for (const b of tools.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(String(state[b.dataset.k]) === b.dataset.v));
    const page = shown.slice(0, limit);
    const next = `${rows.length}|${limit}|${page.map((e) => `${e.seq}:${(e.flags || []).join(',')}:${(e.decision?.receipts || []).length}`).join(',')}`;
    if (next === sig) return;
    sig = next;
    lastTop = topSeq(shown);
    count.textContent = String(rows.length);
    clear(list);
    if (!rows.length) list.append(h('li', { class: 'muted', text: state.humansOnly ? 'Решений по детали ещё нет.' : 'История не получена.' }));
    for (const x of foldRuns(page)) list.append(x.run ? runRow(x, open) : isHuman(x) ? humanRow(x, timeline, decisions) : row(x, open));
    more.hidden = shown.length <= limit;
    more.textContent = `Показать ещё ${Math.min(PAGE, shown.length - limit)}`;
  }

  function show() {
    frozen = null;
    paint();
    list.scrollIntoView?.({ block: 'start' });
  }

  const onScroll = () => {
    if (frozen !== null && !held()) show();
  };
  document.addEventListener?.('scroll', onScroll, true);

  return {
    el,
    update(tl, decs = []) {
      timeline = Array.isArray(tl) ? tl : [];
      decisions = Array.isArray(decs) ? decs : [];
      if (held() && frozen === null) frozen = lastTop;
      else if (!held()) frozen = null;
      paint();
    },
    restore() {},
    count: () => historyRows(timeline, decisions).length,
    destroy() {
      document.removeEventListener?.('scroll', onScroll, true);
    },
  };
}
