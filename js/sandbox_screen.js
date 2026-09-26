// #/sandbox — машина времени для правил (DOMAIN §16.1, POST /v1/sandbox/replay): технолог задаёт новые настройки
// (тело SandboxRequest контракта API v1.6), ядро прогоняет их по всей прошлой истории журнала на копии в памяти и
// сравнивает с действующими правилами: какие предупреждения появились и исчезли (деталь и запись журнала), на сколько
// деталей раньше или позже первое предупреждение по участку и характеристике, у каких деталей поменялась зона.

import { clear, h, zoneBadge } from './dom.js';
import { DEFAULT_THRESHOLDS, fmtDateTime, fmtNum, isNum } from './format.js';
import { clean } from './group.js';
import { failBox, itemLink, panel, recordNote, table } from './more_dom.js';
import { charTitle, placeTitle } from './names.js';
import { warningTitle } from './plain.js';
import { sortedLines } from './state.js';
import {
  buildRequest, DETECTOR_FIELDS, DETECTOR_WORDS, formValues, INCOMING_FIELDS, leadText, NUMBER_FIELDS, reportView,
} from './sandbox_form.js';
import { CHAR_TEXTS } from './texts.js';

const SHOW = 60;

// Названия детекторов в подписях вариантов ядра — словами (SPEC 3.9: «EWMA» → «сглаженное среднее»)
function detectorWords(s) {
  return String(s || '').replace(/\bEWMA\b/g, 'сглаженное среднее').replace(/\bCUSUM\b/g, 'накопленная сумма');
}

function current(app) {
  const t = sortedLines(app.state).map((l) => l.thresholds).find(Boolean) || {};
  return { ...DEFAULT_THRESHOLDS, ...Object.fromEntries(Object.entries(t).filter(([, v]) => isNum(v))) };
}

function input(f, values, now) {
  const el = h('input', { type: 'text', inputmode: 'decimal', id: `sb-${f.key}`, value: values[f.key] || '',
    placeholder: isNum(now?.[f.key]) ? `сейчас ${fmtNum(now[f.key], f.step < 1 ? 2 : 0)}` : 'не менять' });
  el.addEventListener('input', () => { values[f.key] = el.value; });
  return h('label', { class: 'sb-f', for: `sb-${f.key}` }, [h('span', { text: f.label }), el]);
}

function check(key, text, values) {
  const el = h('input', { type: 'checkbox', checked: !!values[key] });
  el.addEventListener('change', () => { values[key] = el.checked; });
  return h('label', { class: 'sb-chk' }, [el, text]);
}

function limitRow(values, i) {
  const row = values.control_limits[i];
  const cell = (k, ph, list) => {
    const el = h('input', { type: 'text', value: row[k] || '', placeholder: ph, list: list || null, 'aria-label': ph });
    el.addEventListener('input', () => { row[k] = el.value; });
    return el;
  };
  return h('div', { class: 'sb-limit' }, [cell('key', 'характеристика или станок:параметр', 'sb-keys'), cell('center_line', 'центральная линия'), cell('sigma', 'σ')]);
}

// «L-1» → «линия 1» (SPEC 7.15); линии нет — прочерк
const lineWord = (id) => (/^L-(\d+)$/.test(String(id || '')) ? `линия ${String(id).slice(2)}` : id || '—');

function warnRows(app, list) {
  return list.slice(0, SHOW).map((w) => h('tr', {}, [
    h('td', { title: w.code || '', text: clean(w.title || '') || warningTitle(w.code) }),
    h('td', {}, itemLink(app, w.item_id) || '—'),
    h('td', { text: lineWord(w.line_id) }),
    h('td', { text: w.station_id ? placeTitle(w.station_id, w.station_id) : '—' }),
    h('td', { class: 'num', title: 'номер записи журнала ядра', text: isNum(w.seq) ? `№ ${w.seq}` : '—' }),
    h('td', { class: 'muted', text: w.occurred_at ? fmtDateTime(w.occurred_at) : '' }),
  ]));
}

function more(list) {
  return list.length > SHOW ? h('p', { class: 'muted', text: `Показаны первые ${SHOW} из ${list.length}.` }) : null;
}

function resultView(app, rep) {
  const v = reportView(rep);
  const head = [rep.label ? `Вариант «${rep.label}»` : 'Вариант без названия', `появилось ${v.added.length}, исчезло ${v.removed.length} предупреждений`,
    `прогнано событий журнала: ${v.events}`].filter(Boolean).join('; ');
  // коды предупреждений — словами (SPEC 7.12); неизвестный код на экран не выводится
  const codes = (list) => list.map(([c, n]) => `${warningTitle(c)}: ${n}`).join(', ');
  const det = v.leads.some((l) => l.detector); // детекторы EWMA и CUSUM — с ядром API v1.6 (DOMAIN §17.6)
  return [
    h('p', { class: 'sb-head', text: head }),
    v.summary.length ? h('ul', { class: 'sb-sum' }, v.summary.map((s) => h('li', { text: clean(s) }))) : null,
    panel(`Где первое предупреждение пришло бы раньше или позже: ${v.leads.length}`, v.leads.length
      ? table(['Участок', 'Характеристика', ...(det ? ['Детектор'] : []), 'Сдвиг', 'Подробно'], v.leads.map((l) => h('tr', {}, [
        h('td', { text: placeTitle(l.station_id, l.station_id || '—') }),
        h('td', { title: l.key, text: charTitle(l.key, l.key) }),
        det ? h('td', { text: DETECTOR_WORDS[l.detector] || l.detector || '—' }) : null,
        h('td', { class: Number(l.items_earlier) > 0 ? 'sb-early' : '', text: leadText(l) || '—' }),
        h('td', { class: 'muted', text: clean(l.summary || '') }),
      ])))
      : h('p', { class: 'muted', text: 'Сдвигов нет: первые предупреждения пришли бы там же.' })),
    panel(`Появились бы предупреждения: ${v.added.length}`, v.added.length
      ? [h('p', { class: 'muted', text: codes(v.addedCodes) }), table(['Предупреждение', 'Деталь', 'Линия', 'Участок', 'Запись', 'Когда'], warnRows(app, v.added)), more(v.added)]
      : h('p', { class: 'muted', text: 'Новых предупреждений нет.' })),
    panel(`Исчезли бы предупреждения: ${v.removed.length}`, v.removed.length
      ? [h('p', { class: 'muted', text: codes(v.removedCodes) }), table(['Предупреждение', 'Деталь', 'Линия', 'Участок', 'Запись', 'Когда'], warnRows(app, v.removed)), more(v.removed)]
      : h('p', { class: 'muted', text: 'Ни одно действующее предупреждение не исчезло.' })),
    panel(`Поменялась бы зона или допуск к приёмке: ${v.changes.length}`, v.changes.length
      ? [table(['Деталь', 'Что', 'Было', 'Стало', 'Почему'], v.changes.slice(0, SHOW).map((c) => h('tr', {}, [
        h('td', {}, itemLink(app, c.item_id)),
        h('td', { text: c.what === 'acceptance' ? 'допуск к приёмке' : 'зона' }),
        h('td', {}, c.what === 'zone' ? zoneBadge(c.before) : c.before || '—'),
        h('td', {}, c.what === 'zone' ? zoneBadge(c.after) : c.after || '—'),
        h('td', { class: 'muted', text: clean(c.reason || '') }),
      ]))), more(v.changes)]
      : h('p', { class: 'muted', text: 'Зоны деталей и допуск к приёмке — те же.' })),
  ];
}

export function mountSandbox(root, app) {
  const now = current(app);
  let values = formValues({});
  const note = h('div');
  const form = h('form', { class: 'sb-form', autocomplete: 'off' });
  const status = h('div', { class: 'sb-status', role: 'status', 'aria-live': 'polite' });
  const result = h('div', { class: 'sb-result' });
  const presets = h('div', { class: 'sb-presets' });
  root.append(h('section', { class: 'mo-page' }, [
    h('header', { class: 'mo-head' }, [h('a', { class: 'back', href: '#/line', text: '← Линия' }),
      h('h1', { text: 'Прогон по истории' }),
      h('p', { class: 'muted', text: 'Что изменится, если поменять настройки: прогон по всей прошлой истории журнала и сравнение с действующими правилами.' })]),
    h('p', { class: 'sb-safe' }, [h('b', { text: 'Журнал и решения не меняются' }),
      ' — прогон идёт на копии в памяти, экраны линии не меняются. Нормы ГОСТ при прогоне не меняются: допуск по чертежу, '
      + 'погрешность и поверка средства измерения, правило решения — не настройка. Запуск записывается в журнал критических действий.']),
    note, presets, form, status, result,
  ]));
  recordNote(app, note);

  function render() {
    const group = (title, nodes) => h('fieldset', { class: 'sb-g' }, [h('legend', { text: title }), ...nodes]);
    clear(form).append(
      h('label', { class: 'sb-f sb-label' }, [h('span', { text: 'Название варианта' }),
        Object.assign(h('input', { type: 'text', maxlength: '120', value: values.label || '', placeholder: 'например, «порог 30 %»' }),
          { oninput: (e) => { values.label = e.target.value; } })]),
      // «Что меняем» — шесть главных полей; остальное — в «Ещё настройки ▸» (SPEC 3.9)
      group('Что меняем', [...NUMBER_FIELDS.map((f) => input(f, values, now)),
        check('ewma', ' Сглаженное среднее — ловит малый сдвиг режима', values),
        check('cusum', ' Накопленная сумма — ловит малый сдвиг режима', values)]),
      h('details', { class: 'sb-more' }, [h('summary', { text: 'Ещё настройки' }), h('div', { class: 'sb-grid' }, [
        group('Центральная линия и σ контрольной карты', [
          ...values.control_limits.map((_, i) => limitRow(values, i)),
          h('button', { class: 'btn btn-small', type: 'button', text: 'Добавить условие', onclick: () => {
            values.control_limits.push({ key: '', center_line: '', sigma: '' });
            render();
          } }),
          h('datalist', { id: 'sb-keys' }, Object.entries(CHAR_TEXTS).map(([k, t]) => h('option', { value: k, label: t }))),
        ]),
        group('Малый сдвиг режима: параметры', DETECTOR_FIELDS.map((f) => input(f, values, null))),
        group('Входной контроль: переключение ступеней', INCOMING_FIELDS.map((f) => input(f, values, null))),
        group('Сколько истории', [input({ key: 'as_of_seq', label: 'До записи журнала № (пусто — вся)', step: 1 }, values, null)]),
      ])]),
      h('div', { class: 'acc-row' }, [
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'Прогнать по истории' }),
        h('button', { class: 'btn', type: 'button', text: 'Сбросить', onclick: () => { values = formValues({}); render(); } }),
      ]),
    );
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { body, errors } = buildRequest(values, now);
    clear(status);
    if (errors.length) {
      status.append(h('ul', { class: 'sb-err' }, errors.map((x) => h('li', { text: x }))));
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.append(h('p', { class: 'muted', text: 'Прогоняю историю журнала…' }));
    try {
      const rep = await app.api.sandbox(body);
      clear(status);
      clear(result).append(...resultView(app, rep).filter(Boolean));
    } catch (err) {
      clear(status).append(failBox(err, 'прогон по истории'));
    } finally {
      btn.disabled = false;
    }
  });

  if (app.api.sandboxPresets) {
    app.api.sandboxPresets().then((list) => {
      if (!list?.length) return;
      const sel = h('select', { 'aria-label': 'записанный вариант' }, [h('option', { value: '', text: 'выберите вариант…' }),
        ...list.map((b, i) => h('option', { value: String(i), text: detectorWords(b.label) || `вариант ${i + 1}` }))]);
      sel.addEventListener('change', () => {
        if (sel.value === '') return;
        values = formValues(list[Number(sel.value)]);
        render();
      });
      clear(presets).append(h('label', { class: 'sb-f' }, [h('span', { text: 'Демо: варианты, которые прогнало ядро' }), sel]));
    }).catch(() => {});
  }
  render();
  document.title = 'Прогон по истории — ТехДело';
  return { roleChanged: () => clear(result), destroy() {} };
}
