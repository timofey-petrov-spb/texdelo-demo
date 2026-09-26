// Полоса «Требует действия» наверху табло линии: строки по тяжести, у каждой — кто действует и переход.
// Ничего не требует действия — одна серая строка «Отклонений нет». Логика — attention.js.
// Оповещения (DOMAIN §14.1, GET /v1/notifications): у строки — кому ушло, сколько осталось до эскалации, кнопка
// «Получил» (review:take_review из allowed_actions оповещения), после эскалации — кому эскалировано и когда
// следующая ступень. Список оповещений табло берёт, когда меняется полоса или роль, когда истекает срок и, пока у
// строк есть неподтверждённые оповещения, раз в 30 с: эскалацию ядра и «Получил» с другого рабочего места видно без
// событий потока. Секунды идут по часам табло (в демо — по часам сюжета) и только в своём <span>: тикер трогает его
// текст, строка и полоса не пересобираются (К37, П0).

import { idempotencyKey } from './actions.js';
import { decisionMessage, decisionOk } from './api.js';
import { attentionInput, attentionRaw, buildAttention, SEVERITY, visibleRows } from './attention.js';
import { attentionRows, NOTES_POLL_MS } from './config.js';
import { clear, h, toast } from './dom.js';
import { fmtTime, itemTitle } from './format.js';
import { countMark } from './group.js';
import { freshKeys, freshText, isHeld } from './hold.js';
import { humanizeCodes, placeTitle } from './names.js';
import { dueText, noteFeed, noteRowSig, notificationsFor, summarize, takeRequest, takeReview } from './notify.js';
import { inView, runVisible, setStripContext } from './state.js';

// Поверка и прибор под сомнением — это про средство измерений, не про участок (QA В-12)
const INSTRUMENT_CODES = new Set(['W_INSTRUMENT_CALIBRATION_DUE', 'W_INSTRUMENT_CALIBRATION_EXPIRED', 'W_INSTRUMENT_SUSPECT']);

export function target(e) {
  const code = e.code || String(e.key || '').split('|')[1] || '';
  if (INSTRUMENT_CODES.has(code)) return { href: '#/metrology', label: 'Открыть средства измерений' };
  if (e.item_id) return { href: `#/item/${encodeURIComponent(e.item_id)}`, label: 'Открыть деталь' };
  if (e.station_id && e.line_id) {
    return { href: `#/station/${encodeURIComponent(e.line_id)}/${encodeURIComponent(e.station_id)}`, label: 'Открыть участок' };
  }
  if (e.items?.length) return { href: `#/item/${encodeURIComponent(e.items[0])}`, label: 'Открыть деталь' };
  return { href: '#/otk', label: 'Пост ОТК' };
}

// У детали — сначала что случилось, потом где она сейчас; у участка — где, потом что
function detailText(e) {
  if (e.item_id) return [e.detail, e.where ? `деталь сейчас: ${e.where}` : ''].filter(Boolean).join('; ');
  return [e.where, e.detail].filter(Boolean).join(': ');
}

const now = (app) => (typeof app.api?.now === 'function' ? app.api.now() : Date.now());

// Строки полосы — по одной детали на номер (SPEC 3.2, 5.6; app.lapFilter): среди деталей, у которых есть строки,
// — последнего круга. «Стоп» прошлого круга виден (и эскалирует), пока у двойника нового круга нет своей строки;
// детали прежнего прогона эмулятора — не видны. Строки идут через attentionInput + buildAttention — вид «Линии»
// (К38: «Мне | Всем», «К сведению», значок) применяется там же
// Какие детали дают строки полосы (без «текущего круга», но только текущий прогон) — для inView (lap.js)
setStripContext((state) => {
  const ids = [];
  for (const e of attentionRaw(state, 'all', (id) => !id || runVisible(state, id))) {
    if (e.item_id) ids.push(e.item_id);
    for (const i of e.items || []) ids.push(i);
  }
  return ids;
});

export function stripKeep(app) {
  if (app.lapFilter === 'all') return () => true;
  return (id) => !id || (runVisible(app.state, id) && inView(app, id));
}

export function attentionForView(app) {
  const state = app.state;
  const title = (l, s) => humanizeCodes(state.lines.get(l)?.stations.get(s)?.title || placeTitle(s));
  return buildAttention(attentionInput(state, app.lineFilter, stripKeep(app)), title);
}

// Кому — в дательном падеже: «мастеру, инженеру ОТК» (SPEC 3.2)
const ROLE_TO = {
  controller: 'инженеру ОТК', foreman: 'мастеру', technologist: 'технологу', manager: 'руководителю производства',
  admin: 'администратору', qc_head: 'начальнику ОТК', design_authority: 'держателю КД',
  customer_rep: 'представителю заказчика', shift_supervisor: 'начальнику смены', metrologist: 'метрологу',
};

export function toWhom(roles) {
  return [...new Set((roles || []).filter(Boolean))].map((r) => ROLE_TO[r] || r).join(', ');
}

// Сколько ждёт: «40 с», «2 мин», «1 ч 05 мин» — пишет тикер. Дольше 12 ч (истёкшая поверка прибора и т. п.) —
// не счёт ожидания, а давность: не показывается
export const AGE_MAX_MS = 12 * 3600 * 1000;

export function ageText(ms) {
  if (!(ms < AGE_MAX_MS)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

// Строка «Линии» уже свёрнута в attention.js (К38, compactRow): в title — всё, что случилось с объектом, в facts —
// где он, detail и where пусты. Строка без свёртки (другие экраны, тесты): факты — через «+», где — из where
const compacted = (e) => e.detail === '' && e.where === '';

// Первая строка: одна фраза и через «+» — что ещё по тому же объекту
// Слово уровня уже стоит слева («◐ Уход режима»): фраза его не повторяет — «Уход режима, критерий 3» → «критерий 3»
// (SPEC 3.2, QA2 п. 14)
export function rowLine1(e) {
  const t = compacted(e) ? e.title : [e.title, ...(e.facts || [])].filter(Boolean).join(' + ');
  const label = String(e.label || '').trim();
  if (!label || !t || t.toLowerCase().indexOf(label.toLowerCase()) !== 0) return t;
  const rest = t.slice(label.length).replace(/^[\s,:\u00b7\u2014-]+/, '');
  return rest ? rest[0].toUpperCase() + rest.slice(1) : t;
}

// Вторая строка: объект · где · кому (SPEC 3.2); сколько ждёт — отдельным узлом справа
export function rowLine2(e, note, lapAll = false) {
  const who = note?.roles?.length ? toWhom(note.roles) : toWhom(e.who);
  const subject = e.subject && lapAll && e.cycle ? `${e.subject} (${e.cycle})` : e.subject;
  const where = compacted(e) ? (e.facts || []) : [e.where];
  return [subject, ...where, who].filter(Boolean).join(' · ');
}

// Справа: отсчёт до эскалации / кому эскалировано и когда следующая ступень / кто получил
function dueCell(note) {
  let state = null;
  if (note?.state === 'waiting') {
    state = h('span', { class: 'attn-due due-waiting', dataset: { due: String(note.dueMs), step: note.step || '' }, text: note.text });
  } else if (note?.state === 'escalated' && note.dueMs) {
    // «эскалировано: начальник смены; до начальника ОТК 9 мин 05 с» — секунды в своём узле
    state = h('span', { class: 'attn-due due-escalated' }, [note.text, '; ',
      h('span', { class: 'attn-next', dataset: { due: String(note.dueMs), step: note.step || '' }, text: note.next })]);
  } else if (note && note.state !== 'none') {
    state = h('span', { class: `attn-due due-${note.state}`, text: note.text });
  }
  return h('span', { class: 'attn-who', title: note?.top ? `Оповещены: ${note.to}. Отсчёт — до эскалации` : null }, [state]);
}

function rowEl(e, note, take, onTake, t0, lapAll) {
  const sev = SEVERITY[e.severity];
  const t = target(e);
  const items = e.items?.length > 1 ? `Детали: ${e.items.map(itemTitle).join(', ')}` : '';
  const at = e.at ? Date.parse(e.at) : NaN;
  return h('li', { class: `attn-row sev-${e.severity}`, dataset: { key: e.key } }, [
    h('span', { class: 'attn-sev' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: sev.icon }), e.label || sev.label]),
    h('span', { class: 'attn-main' }, [
      h('b', { class: 'attn-title', title: [e.detail, e.hint].filter(Boolean).join('\n') || null, text: rowLine1(e) }),
      e.count > 1 ? h('span', { class: 'attn-n', text: countMark(e.count) }) : null,
      h('span', { class: 'attn-detail', title: [detailText(e), items].filter(Boolean).join('\n'), text: rowLine2(e, note, lapAll) }),
    ]),
    dueCell(note),
    h('time', { class: 'attn-t', title: e.at ? `с ${fmtTime(e.at)}` : null, dataset: Number.isFinite(at) ? { at: String(at) } : {},
      text: Number.isFinite(at) ? ageText(t0 - at) : '' }),
    h('span', { class: 'attn-acts' }, [
      take ? h('button', { class: 'btn btn-small attn-take', type: 'button',
        title: 'Вы получили оповещение: эскалация остановится, в журнале запишется, кто и когда',
        text: 'Получил', onclick: (ev) => onTake(ev.currentTarget, take) }) : null,
      h('a', { class: 'btn btn-small attn-go', href: t.href, title: t.label, 'aria-label': t.label, text: '›' }),
    ]),
  ]);
}

export function attentionStrip(app) {
  const count = h('span', { class: 'count' });
  const list = h('ol', { class: 'attn-list' });
  const more = h('button', { class: 'btn btn-small attn-more', type: 'button', hidden: true });
  // раскрытый и прокрученный список не пересобирается под рукой: новые строки — плашкой сверху (К35)
  const bar = h('button', { class: 'fresh-bar', type: 'button', hidden: true, onclick: () => {
    sig = '';
    update(false, true);
    list.scrollTop = 0;
  } });
  let shownKeys = [];
  const rows = new Map(); // ключ строки → { el, sig }
  list.addEventListener('scroll', () => {
    if (!bar.hidden && !isHeld(list.scrollTop)) bar.click();
  });
  // «Ещё N» — в заголовке полосы: кнопка не отнимает строку у того, что требует действия
  // «Мне | Всем», «К сведению: N ▸» и значок-фильтр добавляет экран «Линия» (line.js, К38) через вид attention.js
  const el = h('section', { class: 'attn', 'aria-label': 'Требует действия' }, [
    h('h2', { class: 'panel-h attn-h' }, ['Требует действия ', count, more]), bar, list]);
  let expanded = false;
  let sig = '';
  let noteSig = '';
  let timer = 0;
  let pending = false; // у строк полосы есть неподтверждённые оповещения — нужен редкий опрос
  more.onclick = () => {
    expanded = !expanded;
    sig = '';
    update();
  };

  // список оповещений и когда его брать заново — notify.js (проверяется node --test)
  const feed = noteFeed({
    load: () => (typeof app.api?.notifications === 'function' ? app.api.notifications() : []),
    // список оповещений пришёл заново: подпись полосы включает то, что из него видно, — та же подпись, та же полоса
    onChange: () => update(false),
    gapMs: 2000,
    pollMs: NOTES_POLL_MS,
  });

  // «Получил» — по всем оповещениям строки сразу (по одному решению на источник)
  async function onTake(btn, take) {
    btn.disabled = true;
    const all = take.all?.length ? take.all : [take];
    let failed = '';
    for (const t of all) {
      const { http, result } = await app.api.decide(takeRequest(t.n, t.action), app.role, { idempotencyKey: idempotencyKey() });
      if (!decisionOk(http, result)) failed = failed || decisionMessage(http, result);
    }
    const done = all.length > 1 ? `Получение записано в журнал: оповещений — ${all.length}.` : 'Получение оповещения записано в журнал.';
    toast(failed || done, failed ? 'error' : 'ok');
    if (failed) btn.disabled = false;
    feed.refresh(true);
  }

  // Роль сменилась: оповещения и кнопки прежней роли убираются сразу, список берётся заново для новой роли —
  // и когда демо на паузе, сюжет окончен или живая линия молчит
  function roleChanged() {
    feed.roleChanged();
    noteSig = '';
    sig = '';
    update();
  }

  // секунды до эскалации и до следующей ступени — без перерисовки полосы (текст одного <span>); истёк срок — запрос
  // оповещений (ядро эскалирует); пока есть неподтверждённые оповещения — редкий опрос: эскалация по часам ядра и
  // «Получил» с другого рабочего места
  function tick() {
    if (!el.isConnected) {
      clearInterval(timer);
      timer = 0;
      offLive?.();
      return;
    }
    if (app.live?.paused?.()) return; // пауза показа: рабочая зона застыла, и секунды тоже
    const t = now(app);
    let expired = false;
    for (const x of el.querySelectorAll('.attn-due.due-waiting')) {
      const left = Number(x.dataset.due) - t;
      if (left <= 0) {
        expired = true;
        x.className = 'attn-due due-overdue';
      }
      setText(x, dueText('waiting', left, x.dataset.step || null));
    }
    for (const x of el.querySelectorAll('.attn-t[data-at]')) setText(x, ageText(t - Number(x.dataset.at)));
    for (const x of el.querySelectorAll('.attn-next[data-due]')) {
      const left = Number(x.dataset.due) - t;
      if (left <= 0) {
        expired = true; // ступень прошла — ядро эскалирует дальше или ступеней больше нет
        delete x.dataset.due;
      }
      setText(x, dueText('escalated', left, x.dataset.step || null));
    }
    if (expired) feed.refresh(true);
    else feed.poll(pending);
  }

  // Пауза показа (live.js): список оповещений пришёл заново — полоса догонит после продолжения
  let missed = false;
  const offLive = app.live?.onChange?.((live) => {
    if (!live.paused() && missed && el.isConnected) {
      missed = false;
      update(false);
    }
  });

  function update(fetch = true, force = false) {
    if (app.live?.paused?.() && !force) {
      missed = true;
      return;
    }
    const entries = attentionForView(app);
    // готовые решения оповещений — для роли: сменилась роль — список берётся заново
    const keys = `${app.role?.key || ''}|${entries.map((e) => [e.key, (e.sources || []).join(',')].join('~')).join('#')}`;
    if (fetch && keys !== noteSig) {
      noteSig = keys;
      feed.refresh();
    }
    const t = now(app);
    const view = entries.map((e) => {
      const notes = notificationsFor(e, feed.list);
      return { e, note: summarize(notes, t), take: takeReview(notes) };
    });
    pending = view.some((x) => x.note?.open.length);
    // полоса — колонкой слева во всю высоту (К38): строк до 7 (SPEC 3.2), сколько поместится по ~110 px
    const hh = globalThis.innerHeight || 900;
    const max = Math.min(7, Math.max(attentionRows(hh), Math.floor((hh - 200) / 110)));
    // подпись строк — без живых отсчётов (text у ожидания и эскалации без секунд, секунды пишет tick): отсчёт не
    // пересобирает полосу; есть ли у строки срок — входит (срок прошёл — строка меняется один раз)
    const next = `${expanded}|${max}|${app.lapFilter}|${view.map(rowSig).join('#')}`;
    if (!timer && el.isConnected) timer = setInterval(tick, 1000);
    if (next === sig) return;
    if (!force && expanded && isHeld(list.scrollTop)) {
      const n = freshKeys(view.map((x) => x.e.key), shownKeys).length;
      bar.hidden = !n;
      if (n && bar.textContent !== freshText(n)) bar.textContent = freshText(n);
      return;
    }
    bar.hidden = true;
    sig = next;
    el.classList.toggle('attn-none', !view.length);
    el.classList.toggle('attn-open', expanded);
    const total = view.length ? String(view.length) : '';
    if (count.textContent !== total) count.textContent = total;
    if (!view.length) {
      clear(list);
      rows.clear();
      list.append(h('li', { class: 'attn-row attn-empty' }, [h('span', { class: 'zic z-with_margin', 'aria-hidden': 'true', text: '✓' }),
        'Отклонений нет']));
      more.hidden = true;
      shownKeys = [];
      return;
    }
    const { shown, more: rest } = expanded ? { shown: view.length, more: 0 } : visibleRows(view.length, max);
    const visible = view.slice(0, shown);
    placeRows(visible);
    shownKeys = visible.map((x) => x.e.key);
    more.hidden = !rest && !expanded;
    more.textContent = expanded ? 'Свернуть' : `Ещё ${rest}`;
  }

  // Строки по ключу (К37): изменилась подпись строки — заменяется только она; ушедшая снимается; порядок —
  // перестановкой. Полоса целиком не пересобирается, кнопки под курсором у неизменившихся строк остаются
  function placeRows(shownView) {
    list.querySelector('.attn-empty')?.remove();
    const keep = new Set(shownView.map((x) => x.e.key));
    for (const [k, r] of rows) {
      if (!keep.has(k)) {
        r.el.remove();
        rows.delete(k);
      }
    }
    let prev = null;
    for (const x of shownView) {
      const rs = rowSig(x);
      let r = rows.get(x.e.key);
      if (!r || r.sig !== rs) {
        const node = rowEl(x.e, x.note, x.take, onTake, now(app), app.lapFilter === 'all');
        if (r) r.el.replaceWith(node);
        r = { el: node, sig: rs };
        rows.set(x.e.key, r);
      }
      const at = prev ? prev.nextSibling : list.firstChild;
      if (r.el !== at) list.insertBefore(r.el, at);
      prev = r.el;
    }
  }

  return { el, update, roleChanged };
}

// Подпись строки полосы — всё, что строка показывает, кроме живых отсчётов (их пишет тикер)
function rowSig({ e, note, take }) {
  return JSON.stringify([e.key, e.severity, e.label, e.count, e.title, e.hint, e.facts, e.subject, e.cycle, e.who,
    e.detail, e.where, e.at, e.items, e.item_id, e.station_id, e.line_id, noteRowSig(note), note?.roles,
    (take?.all || []).map((t) => t.n.notification_id)]);
}
