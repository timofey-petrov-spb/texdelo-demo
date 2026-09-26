// Приёмка на объектной странице детали (К39): чек-лист «Можно ли принять» (строки — checklist.js), клеймо сверху у
// принятой, нижняя панель с одной главной кнопкой и подтверждение клейма. Прежняя форма решений (К35) осталась
// для карточек в разделе «Карточки» — до панели карточки К40.

import {
  actionLabel, decisionRequest, DUE_CHOICES, dueAt, idempotencyKey, isStamp, needsDue, needsReason, parseActions, receiptText,
} from './actions.js';
import { decisionMessage, decisionOk } from './api.js';
import { goneText, hhmm, SEP } from './checklist.js';
import { clear, h, toast } from './dom.js';
import { openDialog } from './decide.js';
import { draftKey, drafts, scopeOf } from './drafts.js';
import { receiptsLine } from './history.js';
import { fmtDateTime, itemTitle, plural, shortHash } from './format.js';
import { clean } from './group.js';
import { charTitle, itemParts } from './names.js';
import { stampSignature } from './stamp.js';
import { REASON_PROMPTS, receiptStatus } from './texts.js';
import { riskText } from './words.js';

// Препятствия и «обратить внимание» словами (коды — названиями, карточки — по порядку). После клейма строка ядра
// «изделие уже принято» не нужна: клеймо показано записью рядом
const ALREADY = /^\s*изделие уже принято/i;

export function acceptanceTexts(acc, stamped = !!acc?.stamp) {
  const keep = (x) => x && !(stamped && ALREADY.test(String(x)));
  return { blockers: (acc?.blockers || []).filter(keep).map(clean), notes: (acc?.notes || []).filter(keep).map(clean) };
}

// Что сказать над кнопкой: препятствия / «препятствий нет» (только если ядро разрешило) / ядро молчит о причине
export function acceptanceState(acc) {
  const blockers = (acc?.blockers || []).filter(Boolean);
  if (blockers.length) return 'blocked';
  return acc?.allowed === true ? 'clear' : 'unknown';
}

export function receiptList(list) {
  if (!list?.length) return null;
  return h('ul', { class: 'rcpt' }, list.map((r) => {
    const st = receiptStatus(r.status);
    return h('li', { class: `tone-${st.tone}` }, [h('span', { class: 'rc-ic', 'aria-hidden': 'true', text: r.status ? st.icon : '' }),
      h('span', { text: receiptText(r) })]);
  }));
}

// Клеймо ОТК после приёмки — запись, а не печать: кто, когда, запись № N, голова цепочки, алгоритм, подпись.
// Красным — только подпись, которая проверялась и не сошлась (stamp.js)
export function stampRecord(stamp, receipts, verdict = null) {
  const rework = stamp.action === 'accept_after_rework';
  const sig = stampSignature(stamp, verdict);
  const bad = sig.state === 'bad';
  const rows = [
    ['Кто', [stamp.author_id, stamp.author_title].filter(Boolean).join(', ') || '—'],
    ['Когда', fmtDateTime(stamp.decided_at)],
    ['Запись журнала', Number.isFinite(stamp.seq) ? `№ ${stamp.seq}` : '—'],
    ['Голова цепочки', shortHash(stamp.item_hash, 10, 6)],
    ['Ключ и алгоритм', [sig.key || stamp.key_id, stamp.signature_alg].filter(Boolean).join(', ') || '—'],
    ['Подпись', sig.text],
  ];
  // DOMAIN §17.1: наибольшая вероятность несоответствия среди характеристик изделия (API v1.6, Stamp.worst_risk)
  const risk = riskText(stamp.worst_risk, charTitle(stamp.worst_risk?.characteristic_id, ''));
  if (risk) rows.push(['Риск', risk]);
  return h('div', { class: `stamp-rec${bad ? ' tone-critical' : ''}` }, [
    h('div', { class: 'stamp-h' }, [h('span', { class: 'zic z-with_margin', 'aria-hidden': 'true', text: '✓' }),
      h('b', { text: stamp.statement || (rework ? 'Принято после доработки' : 'Принято ОТК') }),
      h('span', { class: 'muted', text: 'цифровое клеймо' })]),
    h('dl', { class: 'stamp-dl' }, rows.flatMap(([k, v]) => [h('dt', { text: k }),
      h('dd', { class: k === 'Голова цепочки' ? 'mono' : k === 'Подпись' ? `sig-${sig.state}${bad ? ' bad' : ''}` : '',
        title: k === 'Голова цепочки' ? stamp.item_hash || '' : k === 'Подпись' ? sig.detail || null : null, text: v })])),
    receipts?.length ? h('div', { class: 'acc-sub' }, [h('h3', { text: 'Квитанции внешних систем' }), receiptList(receipts)]) : null,
  ]);
}

// Черновики форм решений (К35 → drafts.js, К39): причина и срок живут, пока решение не записано или не отменено, —
// перерисовка экрана, смена вкладки, возврат к детали и перезагрузка страницы их не стирают. Ключ — цель решения
// и вид окна: item:<id>:acceptance, item:<id>:hold, card:<nc_id>:decision
function draftKeys(target) {
  return target?.kind === 'item' ? [draftKey(target, 'acceptance'), draftKey(target, 'hold')] : [draftKey(target, 'decision')];
}

export function draftOf(target) {
  for (const k of draftKeys(target)) {
    const d = drafts.get(k);
    if (d) return d;
  }
  return null;
}

// Кнопки готовых решений: отправка POST /v1/decisions по разобранной строке kind:action[:disposition].
// basedOnSeq — число или функция (профиль знает, на какую запись журнала смотрит человек); onClose — форма закрыта
export function decisionControls(app, { actions, target, basedOnSeq, onDecided, onClose, stampHint = '' }) {
  let key = '';
  const status = h('div', { class: 'acc-status', role: 'status' });
  const reasonBox = h('div', { class: 'acc-reason', hidden: true });
  const row = h('div', { class: 'acc-row' });
  const el = h('div', { class: 'acc-actions' });
  const list = parseActions(actions);
  const stamp = list.find(isStamp);
  if (stamp) {
    el.append(h('button', { class: 'btn btn-accept', type: 'button', onclick: () => start(stamp) }, actionLabel(stamp)),
      h('p', { class: 'acc-why', text: 'Решение подпишется личным ключом и войдёт в цепочку изделия.' }));
  } else if (stampHint) {
    el.append(h('button', { class: 'btn btn-accept-off', type: 'button', disabled: true }, 'Принять — поставить клеймо'),
      h('p', { class: 'acc-why', text: stampHint }));
  }
  for (const a of list.filter((x) => x !== stamp)) {
    row.append(h('button', { class: `btn act-${a.action}`, type: 'button', onclick: () => start(a) }, actionLabel(a)));
  }
  if (row.firstChild) el.append(row);
  el.append(reasonBox, status);
  for (const k of draftKeys(target)) {
    const saved = drafts.get(k);
    if (!saved?.open) continue; // черновик без открытой формы (окно решения закрыто) — форму не раскрываем
    const again = list.find((a) => a.code === saved.code && needsReason(a));
    if (again) {
      start(again, saved);
      break;
    }
  }
  return el;

  function close() {
    drafts.drop(key);
    reasonBox.hidden = true;
    clear(reasonBox);
    onClose?.();
  }

  function start(a, restore = null) {
    if (!needsReason(a)) {
      send(a, '');
      return;
    }
    // другая форма той же цели была открыта — её черновик уходит (одна форма на цель)
    const next = draftKey(target, scopeOf(a, target));
    if (key && key !== next) drafts.drop(key);
    key = next;
    const old = drafts.get(key);
    const d = restore || drafts.save(key, { code: a.code, reason: old?.code === a.code ? old.reason || '' : '', due: null, focus: true, open: true });
    const put = (patch) => drafts.save(key, patch);
    const ta = h('textarea', { rows: 3, maxlength: 1000, required: true, placeholder: 'Обязательно: что не так и что сделать',
      oninput: () => put({ reason: ta.value }), onfocus: () => put({ focus: true }),
      onblur: () => setTimeout(() => { if (ta.isConnected) put({ focus: false }); }, 0) });
    ta.value = d.reason || '';
    const err = h('div', { class: 'acc-err' });
    const due = needsDue(a) ? h('select', { 'aria-label': 'контрольный срок исправления', onchange: () => put({ due: due.value }) },
      DUE_CHOICES.map(([m, t], i) => h('option', { value: String(m), selected: d.due ? String(m) === String(d.due) : i === 1, text: t }))) : null;
    // Element.append(null) пишет «null» текстом — пустые части отбрасываются
    clear(reasonBox).append(...[h('label', { text: `${REASON_PROMPTS[a.action] || 'Основание решения'}: ${actionLabel(a).toLowerCase()}` }), ta,
      due ? h('label', { class: 'acc-due' }, ['Контрольный срок ', due]) : null, err,
      h('p', { class: 'acc-stale hint', hidden: true, text: 'Данные детали обновились — экран обновится после записи решения или отмены.' }),
      h('div', { class: 'acc-row' }, [
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Записать решение', onclick: () => {
          const reason = ta.value.trim();
          if (reason.length < 5) {
            err.textContent = 'Укажите причину — не короче 5 знаков.';
            ta.focus();
            return;
          }
          send(a, reason, due ? dueAt(Number(due.value)) : null);
        } }),
        h('button', { class: 'btn', type: 'button', text: 'Отмена', onclick: close }),
      ])].filter(Boolean));
    reasonBox.hidden = false;
    // курсор — в поле причины; форма, восстановленная из черновика, ещё не в документе — фокус после вставки
    const focus = () => {
      if (!ta.isConnected) return;
      ta.focus({ preventScroll: !!restore });
      ta.setSelectionRange?.(ta.value.length, ta.value.length);
    };
    if (d.focus) (ta.isConnected ? focus() : requestAnimationFrame(focus));
  }

  async function send(a, reason, due = null) {
    const seq = typeof basedOnSeq === 'function' ? basedOnSeq() : basedOnSeq;
    const req = decisionRequest(a, target, { reason, basedOnSeq: seq, due });
    const buttons = [...el.querySelectorAll('button')].map((b) => [b, b.disabled]);
    for (const [b] of buttons) b.disabled = true;
    status.className = 'acc-status busy';
    status.textContent = isStamp(a) ? 'Подписываю решение личным ключом…' : 'Записываю решение…';
    // ключ повтора — из черновика: повторная подпись того же решения не создаст второй записи
    const idem = key && needsReason(a) ? drafts.save(key, { basedOnSeq: seq }).idem : idempotencyKey();
    const { http, result } = await app.api.decide(req, app.role, { idempotencyKey: idem });
    const ok = decisionOk(http, result);
    const msg = decisionMessage(http || 0, result);
    status.className = `acc-status ${ok ? 'ok' : 'err'}`;
    status.textContent = msg;
    if (!ok) {
      for (const [b, was] of buttons) b.disabled = was;
      toast(msg, 'error');
      onDecided?.({ ok, http, result, req, refresh: http === 409 || result?.status === 'stale' });
      return;
    }
    if (key) drafts.drop(key);
    reasonBox.hidden = true;
    clear(reasonBox);
    toast(isStamp(a) ? `Клеймо ОТК поставлено: ${itemTitle(req.target_id)}` : msg, 'ok');
    onDecided?.({ ok, http, result, req, refresh: true });
    onClose?.();
  }
}

// ---------- объектная страница детали (К39, П4г; SPEC 3.4.3, 3.4.8, 3.4.9) ----------

const MARK_CLASS = { '✕': 'mk-fail', '●': 'mk-wait', '◐': 'mk-info' };

function line(l, onAction, gone = null) {
  const act = !gone && l.action ? h('button', { type: 'button', class: 'btn btn-small cl-act', text: l.action.label,
    onclick: () => onAction?.(l.action) }) : null;
  return h('li', { class: `cl-line ${gone ? 'cl-gone' : MARK_CLASS[l.mark] || ''}`, dataset: { sub: l.sub } }, [
    h('span', { class: 'cl-mk', 'aria-hidden': 'true', text: gone ? '✓' : l.mark }),
    h('span', { class: 'cl-t' }, [gone ? h('s', { text: l.text }) : l.text,
      gone ? h('small', { class: 'cl-when', text: ` ${goneText(gone)}` }) : null]),
    !gone && l.who ? h('span', { class: 'cl-who', text: `кто: ${l.who}` }) : null,
    act,
  ]);
}

// Чек-лист «Можно ли принять»: невыполненные условия сверху, развёрнуты; снятое — зачёркнуто 5 с; выполненные —
// одной строкой; тексты ядра — в «Подробно от системы ▸». onAction({ kind, target }) — кнопки строк
export function checklistView(cl, { gone = [], onAction, openDetails = false, onToggleDetails } = {}) {
  const goneBy = new Map();
  for (const g of gone) goneBy.set(g.key, [...(goneBy.get(g.key) || []), g]);
  const tone = cl.verdict === 'blocked' ? (cl.people ? 'sev-serious' : 'cl-way') : 'cl-okv';
  const head = h('div', { class: 'cl-head' }, [h('h2', { class: `cl-h ${tone}`, text: cl.head }),
    cl.verdict === 'blocked' ? h('span', { class: 'cl-done', text: `выполнено ${cl.done} из ${cl.total}` }) : null]);
  const rows = h('ul', { class: 'cl-rows' });
  const done = [];
  const quiet = [];
  for (const r of cl.rows) {
    const g = goneBy.get(r.key) || [];
    if (r.state === 'fail' || r.state === 'wait' || g.length) {
      rows.append(h('li', { class: `cl-row st-${r.state}`, id: `cl-${r.key}`, dataset: { key: r.key } }, [
        h('span', { class: 'cl-title', text: r.head || r.title }),
        h('ul', { class: 'cl-lines' }, [...r.lines.map((l) => line(l, onAction)), ...g.map((x) => line(x, null, x))]),
      ]));
      continue;
    }
    done.push(r.title);
    quiet.push(...r.lines); // ◐ «у границы — решается карточкой», «решено по карточке»
  }
  return h('section', { class: `pf-check cl-${cl.verdict}` }, [
    head,
    rows.firstChild ? rows : null,
    ...cl.extra.map((x) => h('p', { class: 'cl-extra' }, [h('span', { class: 'cl-mk', 'aria-hidden': 'true', text: '✕' }), x])),
    ...quiet.map((l) => h('p', { class: 'cl-quiet' }, [h('span', { class: 'cl-mk', 'aria-hidden': 'true', text: '◐' }), l.text])),
    done.length ? h('p', { class: 'cl-okline' }, [h('span', { class: 'muted', text: 'Выполнено:' }),
      ...done.map((t) => h('span', { class: 'cl-ok', text: `✓ ${t}` }))]) : null,
    ...cl.notes.map((n) => h('p', { class: 'cl-note' }, [h('span', { class: 'cl-nmk', 'aria-hidden': 'true', text: '!' }), n])),
    cl.details.length ? h('details', { class: 'cl-sys', open: openDetails || null, ontoggle: (e) => onToggleDetails?.(e.currentTarget.open) }, [
      h('summary', { text: 'Подробно от системы' }),
      h('ul', {}, cl.details.map((d) => h('li', { text: d }))),
    ]) : null,
  ]);
}

// Принятая деталь: клеймо сверху вместо чек-листа (SPEC 3.4.9)
export function stampTop(stamp, { receipts = [], verdict = null, where = '' } = {}) {
  const sig = stampSignature(stamp, verdict);
  const who = [stamp.author_title, stamp.author_id].filter(Boolean).join(' ');
  const rc = receiptsLine(receipts); // квитанции MES и 1С — одна строка на систему
  const risk = riskText(stamp.worst_risk, charTitle(stamp.worst_risk?.characteristic_id, ''));
  const rework = stamp.action === 'accept_after_rework';
  const parts = [`${rework ? 'Принято ОТК после доработки' : 'Принято ОТК'} ${hhmm(stamp.decided_at)}`.trim(), who, risk, rc, where].filter(Boolean);
  return h('section', { class: `pf-stamp${sig.state === 'bad' ? ' tone-critical' : ''}` }, [
    h('p', { class: 'st-line' }, [h('span', { class: 'st-mk', 'aria-hidden': 'true', text: '✓' }), parts.join(SEP)]),
    h('details', { class: 'st-sig' }, [h('summary', { text: sig.state === 'ok' ? 'Подпись проверена' : sig.text }), stampRecord(stamp, receipts, verdict)]),
  ]);
}

// Нижняя панель 64 px: слева «✕ N мешают приёмке» (всплывающий список, клик — к условию), справа одна главная
// кнопка — «Принять ОТК» или «Решение по приёмке…». Роли без решений по детали — панели нет
export function footerBar(cl, { stamp = null, other = false, onStamp, onDecide, onJump }) {
  // «ещё в пути» — не препятствие, которое кто-то должен снять: без красной кнопки, тихой подписью
  const n = cl.verdict === 'blocked' ? cl.people : 0;
  if (!stamp && !other) return null;
  const pop = h('ul', { class: 'ft-pop', hidden: true });
  for (const r of cl.rows) {
    for (const l of r.lines) {
      if (l.mark !== '✕') continue;
      pop.append(h('li', {}, [h('button', { type: 'button', class: 'ft-go', text: `${l.mark} ${l.text}`, onclick: () => {
        pop.hidden = true;
        onJump?.(r.key);
      } })]));
    }
  }
  const word = plural(n, 'мешает', 'мешают', 'мешают');
  const left = n ? h('div', { class: 'ft-left' }, [h('button', { type: 'button', class: 'btn ft-block', 'aria-expanded': 'false',
    text: `✕ ${n} ${word} приёмке`, onclick: (e) => {
      pop.hidden = !pop.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!pop.hidden));
    } }), pop]) : h('div', { class: 'ft-left' }, cl.verdict === 'blocked' && cl.onWay ? h('span', { class: 'ft-way', text: '○ Ещё в пути — принять можно, когда деталь пройдёт маршрут' }) : null);
  const right = h('div', { class: 'ft-right' }, [
    stamp && other ? h('button', { type: 'button', class: 'btn', text: 'Другое решение…', onclick: onDecide }) : null,
    stamp ? h('button', { type: 'button', class: 'btn btn-main', text: stamp.action === 'accept_after_rework' ? 'Принять ОТК после доработки' : 'Принять ОТК',
      onclick: onStamp })
      : h('button', { type: 'button', class: 'btn btn-main', text: 'Решение по приёмке…', onclick: onDecide }),
  ]);
  return h('footer', { class: 'pf-foot' }, [left, right]);
}

// От чьего имени клеймо: «от имени инженера ОТК QC-01»
const GENITIVE = { controller: 'инженера ОТК', qc_head: 'начальника ОТК', customer_rep: 'представителя заказчика' };

// «Поставить клеймо ОТК на БД-01-0114 от имени инженера ОТК QC-01?» [Отмена] [Поставить клеймо] (SPEC 3.4.8)
export function confirmStamp(app, { itemId, label = 'Поставить клеймо', onYes }) {
  openDialog()?.close(true);
  const base = itemParts(itemId).base;
  const r = app?.role;
  const who = [GENITIVE[r?.id] || '', r?.actor || ''].filter(Boolean).join(' ');
  const status = h('p', { class: 'dec-status', role: 'status' });
  const yes = h('button', { type: 'button', class: 'btn btn-main', text: label });
  const no = h('button', { type: 'button', class: 'btn', text: 'Отмена' });
  const dlg = h('dialog', { class: 'dlg dec-dlg dec-stamp', 'aria-label': 'Клеймо ОТК' }, [
    h('header', { class: 'dlg-h' }, [h('h2', { text: `Поставить клеймо ОТК на ${base}${who ? ` от имени ${who}` : ''}?` })]),
    h('p', { class: 'muted', text: 'Клеймо подписывается вашим ключом и входит в цепочку детали; квитанция уйдёт в 1С.' }),
    h('footer', { class: 'dlg-f' }, [status, h('div', { class: 'dlg-btns' }, [no, yes])]),
  ]);
  const close = () => {
    try {
      dlg.close();
    } catch {
      dlg.removeAttribute('open');
    }
    dlg.remove();
  };
  no.addEventListener('click', close);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    no.disabled = true;
    status.className = 'dec-status busy';
    status.textContent = 'Подписываю клеймо…';
    const res = await onYes();
    if (res?.ok) {
      close();
      return;
    }
    yes.disabled = false;
    no.disabled = false;
    status.className = 'dec-status err';
    status.textContent = res?.message || 'Клеймо не поставлено.';
  });
  document.body.append(dlg);
  try {
    dlg.show();
  } catch {
    dlg.setAttribute('open', '');
  }
  yes.focus();
  return { close, el: dlg };
}
