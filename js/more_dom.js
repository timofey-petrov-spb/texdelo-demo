// Общие куски экранов К33: отказ ядра словами и с кодом, ссылка на деталь, пометка демо-записи, таблица,
// «загружаю». Цвет — только отклонению (ISA-101): отказ точки — серым, это не авария на линии.

import { clear, h } from './dom.js';
import { fmtDateTime, itemsInText, itemTitle } from './format.js';
import { humanText } from './names.js';
import { failure } from './words.js';

// Ответ ядра не получен: код и объяснение; «точка ядра недоступна» и «данных нет» — серым
export function failBox(e, what) {
  const f = failure(e, what);
  return h('div', { class: 'mo-fail', role: 'status' }, [
    h('b', { text: f.title }),
    f.text ? h('span', { class: 'muted', text: ` ${f.text}` }) : null,
  ]);
}

export function loading(text = 'Загружаю…') {
  return h('p', { class: 'muted mo-load', text });
}

// Деталь: с ядром — ссылка на профиль; в демо данные К33 — из записи ядра по другому сюжету, профиль той же
// детали в демо-табло другой — поэтому текстом с пояснением
export function itemLink(app, id) {
  if (!id) return '';
  if (app.mode === 'demo') {
    return h('span', { class: 'mo-item', title: `${id}: деталь из записи ядра (сюжет живой линии); в демо-табло её профиль другой`,
      text: itemTitle(id) });
  }
  return h('a', { href: `#/item/${encodeURIComponent(id)}`, title: id, text: itemTitle(id) });
}

// В демо — откуда эти числа: запись ответов настоящего ядра
export function recordNote(app, box) {
  if (app.mode !== 'demo' || !app.api.coreRecord) return;
  app.api.coreRecord().then((m) => {
    if (!m) return;
    // подробности прогона (файл сюжета, коды приборов) — в подсказке: на экране одна понятная фраза
    const detail = `Сюжет ${m.story}, событий ${m.events}, запись журнала № ${m.as_of_seq}`
      + `${m.decisions?.length ? `; решения в прогоне: ${m.decisions.join('; ')}` : ''}${m.extra?.length ? `; добавлено: ${m.extra.join('; ')}` : ''}`;
    clear(box).append(h('p', { class: 'mo-rec', title: detail }, [
      h('b', { text: 'Демо: ответы настоящего ядра, ' }),
      'записанные прогоном сюжета живой линии. Номера деталей — из того сюжета.',
    ]));
  }).catch(() => {});
}

export function table(head, rows, cls = '') {
  return h('div', { class: 'mo-tw' }, [h('table', { class: `mo-t ${cls}`.trim() }, [
    h('thead', {}, h('tr', {}, head.map((x) => h('th', { scope: 'col', text: x })))),
    h('tbody', {}, rows),
  ])]);
}

export function when(iso) {
  return iso ? fmtDateTime(iso) : '—';
}

// Панель экрана: заголовок, тело; body — узел или массив
export function panel(title, body, cls = '') {
  return h('section', { class: `panel ${cls}`.trim() }, [h('h2', { class: 'panel-h', text: title }), ...[].concat(body)]);
}

// Экран с загрузкой и отказом: load() → данные, render(data) → узлы; hint(e) — пояснение к отказу
export function loader(box, { load, render, what, hint }) {
  let token = 0;
  async function run() {
    const my = ++token;
    clear(box).append(loading());
    try {
      const data = await load();
      if (my !== token) return;
      clear(box).append(...[].concat(render(data)).filter(Boolean));
    } catch (e) {
      if (my !== token) return;
      clear(box).append(...[failBox(e, what), hint?.(e)].filter(Boolean));
    }
  }
  run();
  return { reload: run, stop: () => { token += 1; } };
}

// Текст ядра с формулой: «·» здесь — умножение (Cm = T / (2 · U)), его не превращать в запятую, как clean()
export function formulaText(s) {
  return humanText(itemsInText(String(s ?? '')));
}
