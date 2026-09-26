// #/escape — «Что остановили» (бывшее «От чего уберегли»; SPEC.md 3.8, DOMAIN §16.2, §17.3). Главный вопрос: сколько
// несоответствий остановили, на каком этапе и во что бы они обошлись дальше. Главное число крупно; полоса этапов
// «где остановили → где всплыло бы» (GET /v1/escape/summary); лестницы по карточкам (GET /v1/cards/{nc_id}/escape) —
// первая раскрыта, остальные строкой; где контроль пропустил бы (GET /v1/escape/points и пропуски контроля деталей
// текущего круга). Пока решений нет — «Ждут решения: N» и лестница первой открытой карточки: никаких «0 … 0 усл. ед.».
// Карточки — только текущего круга сюжета (inView, К37). Источники оценок — только в «Как считаем ▸».

import './card_panel.js'; // панель карточки: регистрирует app.openCard (SPEC 3.6)
import { clear, h } from './dom.js';
import { isNum, lineTitle } from './format.js';
import { howWeCount, ladderLineBlock, shortCost } from './ladder.js';
import { cabinetUrl, cardHint, cardLabel, cardStatus, cpTitle, rememberCards } from './names.js';
import { failBox, loader, panel, recordNote } from './more_dom.js';
import { inView } from './state.js';
import { METHOD_TEXTS } from './texts.js';

const LIMIT = 30;
const MIN_UPDATE_MS = 5000;

// Этапы сводки — коротко; вне завода — без приписки «вне завода:» (она у всей правой части)
const STAGE_SHORT = [
  [/участке изготовления детали/i, 'На участке детали'], [/сборке блока/i, 'Сборка, до закрытия крышки'],
  [/приёмочном контроле/i, 'Приёмочный контроль'], [/установке блока/i, 'Установка в изделие'],
  [/испытаниях изделия/i, 'Испытания изделия'], [/эксплуатации/i, 'В эксплуатации'],
];
const OUTSIDE = /^вне завода:\s*/i;
const PART_STAGE = /участке изготовления детали/i;
// Точка контроля на участке изготовления детали → где остановили («ОТК сварки» → «Сварка»)
const CP_STAGE = { 'CP-IN': 'Входной контроль', 'CP-TURN': 'Токарная обработка', 'CP-WELD': 'Сварка' };
// Карточка остановлена — подтверждена и дальше (сигнал, рассмотрение и «не подтверждено» — нет)
const NOT_STOPPED = new Set(['signal', 'under_review', 'extra_control', 'not_confirmed']);
const WAITING = new Set(['signal', 'under_review', 'extra_control']);

export function stageShort(stage, stoppedAt = []) {
  const s = String(stage || '');
  if (PART_STAGE.test(s) && stoppedAt.length) {
    return stoppedAt.length === 1 ? stoppedAt[0] : `На участке детали: ${stoppedAt.join(', ').toLowerCase()}`;
  }
  const hit = STAGE_SHORT.find(([re]) => re.test(s));
  const t = hit ? hit[1] : s.replace(OUTSIDE, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '—';
}

// Где остановили на участке детали — по точкам контроля остановленных карточек текущего круга
export function stoppedAt(cards) {
  const cps = new Set([...(cards || [])].filter((c) => c && !NOT_STOPPED.has(c.status)).map((c) => c.control_point_id));
  return [...cps].map((cp) => CP_STAGE[cp]).filter(Boolean);
}

// Полоса этапов: слева — где остановили (завод), справа серым — где всплыло бы (вне завода); у каждого этапа —
// во сколько раз дороже, колонка не бывает пустой
export function stageStrip(sum, at = []) {
  return (sum?.by_stage || []).map((s) => ({
    title: stageShort(s.stage, at), outside: OUTSIDE.test(String(s.stage || '')),
    stopped: isNum(s.stopped) ? s.stopped : 0, surface: isNum(s.would_surface) ? s.would_surface : 0,
    cost: shortCost(s) || 'нет оценки',
  }));
}

// Ждут решения — сигналы, которые ещё не подтвердили и не отклонили (подтверждённая уже остановлена); visible — круг
export function waitingCards(cards, line = 'all', visible = () => true) {
  return [...(cards || [])].filter((c) => c?.nc_id && WAITING.has(c.status) && visible(c.item_id)
    && (line === 'all' || !c.line_id || c.line_id === line))
    .sort((a, b) => String(a.opened_at || '').localeCompare(String(b.opened_at || '')));
}

// Главное: число остановленных или, пока их нет, число ждущих решения; нет ни того ни другого — без крупного нуля
export function headline(sum, waiting) {
  const stopped = Number(sum?.cards) || 0;
  if (stopped > 0) return { label: 'Остановлено до выхода с завода', value: stopped, zero: false };
  if (waiting > 0) return { label: 'Ждут решения', value: waiting, zero: true };
  return { label: 'Несоответствий пока нет', value: null, zero: true };
}

// «Как считаем ▸»: источники оценок и оговорки ядра; строку ядра о ждущих решения заменяет наш счёт — тот же, что
// крупно на экране (текущий круг)
export function sumBasis(sum, waiting = null) {
  const src = [...new Set((sum?.by_stage || []).map((s) => s.cost_source).filter(Boolean))];
  const notes = (sum?.notes || []).map((n) => String(n).replace(/[.;]?\s*Всего карточек[^.]*ждут решения[^.]*(\.|$)/i, '.'));
  const mine = waiting === null ? [] : [`Ждут решения — сигналы текущего круга сюжета, которые ещё не подтвердили и не отклонили: ${waiting}.`];
  return [...notes, ...mine, ...src].map(String);
}

// Пропуски контроля у деталей текущего круга (покрытие из снимка линии): точка — сколько деталей ушло без проверки
export function skippedPoints(items, visible = () => true) {
  const by = new Map();
  for (const it of items || []) {
    const cov = it?.coverage;
    const n = Number(cov?.skipped) || 0;
    if (!n || !visible(it.item_id)) continue;
    for (const cp of (cov.missing || []).slice(0, n)) by.set(cp, (by.get(cp) || 0) + 1);
  }
  return [...by].map(([cp, count]) => ({ cp, count }));
}

function stripView(sum, at) {
  const cells = stageStrip(sum, at);
  if (!cells.length) return h('p', { class: 'muted', text: 'Этапов в сводке нет.' });
  const cell = (c) => h('li', { class: `es-st${c.outside ? ' es-out' : ''}${c.stopped ? ' es-hit' : ''}` }, [
    h('span', { class: 'es-st-t', text: c.title }),
    c.outside ? h('b', { class: 'es-st-n', text: c.surface ? `всплыло бы: ${c.surface}` : '—' })
      : h('b', { class: 'es-st-n', text: String(c.stopped) }),
    !c.outside && c.surface ? h('span', { class: 'es-st-s', text: `всплыло бы здесь: ${c.surface}` }) : null,
    h('span', { class: 'es-st-c', text: c.cost }),
  ]);
  return h('div', { class: 'es-strip' }, [
    h('ol', { class: 'es-in' }, cells.filter((c) => !c.outside).map(cell)),
    h('ol', { class: 'es-outs' }, cells.filter((c) => c.outside).map(cell)),
    h('p', { class: 'es-legend muted' }, [h('span', { text: 'где остановили на заводе; ×… — к участку детали' }),
      h('span', { text: 'где всплыло бы без ТехДела; ×… — к заводу в целом, другая шкала' })]),
  ]);
}

function cardButton(app, c, opts = {}) {
  const text = cardLabel(c, opts);
  if (typeof app.openCard !== 'function') return h('b', { title: cardHint(c.nc_id), text });
  return h('button', { class: 'es-open', type: 'button', title: `Открыть карточку (${cardHint(c.nc_id)})`, text,
    onclick: (ev) => { ev.stopPropagation(); ev.preventDefault(); app.openCard(c.nc_id, { card: c }); } });
}

function heroView(app, sum, waiting, line) {
  const top = headline(sum, waiting.length);
  const box = h('div', { class: 'es-hero' }, [
    h('p', { class: 'es-hero-l', text: top.label }),
    top.value === null ? null : h('p', { class: `es-hero-n${top.zero ? ' es-zero' : ''}`, text: String(top.value) }),
    !top.zero && waiting.length ? h('p', { class: 'es-hero-w', text: `Ждут решения: ${waiting.length}` }) : null,
    line !== 'all' ? h('p', { class: 'muted', text: lineTitle(line) }) : null,
  ]);
  if (top.zero && waiting.length) {
    const first = waiting[0];
    box.append(h('p', { class: 'es-hero-q', text: 'Вот что будет, если их пропустить:' }),
      h('p', { class: 'es-hero-c' }, [cardButton(app, first)]), ladderLineBlock(app, first.nc_id, { brief: true }));
  } else if (top.zero) {
    box.append(h('p', { class: 'muted', text: 'Как только контроль даст сигнал, здесь появится, где его остановили и во что бы он обошёлся дальше.' }));
  }
  return box;
}

// Карточки экрана: из списка ядра и из потока табло, только текущий круг
function screenCards(app, cards) {
  const byId = new Map((Array.isArray(cards) ? cards : []).map((c) => [c.nc_id, c]));
  for (const c of app.state?.cards?.values?.() || []) byId.set(c.nc_id, { ...byId.get(c.nc_id), ...c });
  return [...byId.values()].filter((c) => c?.nc_id && inView(app, c.item_id));
}

// record — карточки записи ядра в демо: сводка оттуда же, этап «где остановили» — по ним
function summaryView(app, sum, line, cards = [], record = null) {
  const mine = screenCards(app, cards);
  const waiting = waitingCards(mine, line);
  const stopped = Number(sum?.cards) > 0;
  // пока ничего не остановлено, полоса этапов — одни нули: её нет, главное — «Ждут решения» и лестница
  return [heroView(app, sum, waiting, line), stopped ? stripView(sum, stoppedAt(record || mine)) : null,
    h('p', { class: 'll-note muted', text: 'Во сколько раз дороже — оценка команды, не норма.' }),
    howWeCount(sumBasis(sum, waiting.length))];
}

const SKIP_WORDS = { 'CP-HIDDEN': 'крышку закрыли без проверки' };
const up = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Где контроль пропустил бы: пропуски контроля деталей текущего круга и точки с пропусками по журналу ядра
function pointsView(app, rows) {
  const skips = skippedPoints(app.state?.items?.values?.(), (id) => inView(app, id));
  const bad = (Array.isArray(rows) ? rows : []).filter((r) => (r.missed || 0) + (r.not_assessable || 0) + (r.skipped || 0) > 0);
  if (!bad.length && !skips.length) return h('p', { class: 'muted', text: 'Пропусков контроля нет.' });
  return h('ul', { class: 'es-pts' }, [
    ...skips.map((s) => h('li', {}, [h('b', { title: s.cp, text: `${up(cpTitle(s.cp, s.cp))}: ${s.count}` }),
      h('span', { text: ` — ${SKIP_WORDS[s.cp] || 'деталь ушла дальше без проверки'}` })])),
    ...bad.map((r) => {
      const parts = [r.missed ? `пропустила: ${r.missed}` : '', r.not_assessable ? `оценка невозможна: ${r.not_assessable}` : '',
        r.skipped ? `нет результата: ${r.skipped}` : ''].filter(Boolean).join(', ');
      return h('li', {}, [h('b', { title: r.control_point_id, text: cpTitle(r.control_point_id, r.title || '') }),
        h('span', { text: ` — ${parts}` }), r.method ? h('span', { class: 'muted', text: `; метод: ${METHOD_TEXTS[r.method] || r.method}` }) : null]);
    }),
  ]);
}

// openFirst — раскрыть первую лестницу; при нуле остановленных она уже в главном блоке — список строками
function cardsView(app, cards, { openFirst = true } = {}) {
  const list = screenCards(app, cards).sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
  if (!list.length) return h('p', { class: 'muted', text: 'Карточек несоответствий нет.' });
  if (app.mode !== 'demo') rememberCards(list); // в демо карточки записи ядра — из другого сюжета
  const shown = list.slice(0, LIMIT);
  return [
    ...shown.map((c, i) => {
      const body = h('div', { class: 'es-lad' });
      const d = h('details', { class: 'es-card', open: openFirst && i === 0 }, [
        h('summary', {}, [cardButton(app, c), h('span', { class: 'muted', text: ` — ${cardStatus(c.status).badge}` })]),
        body,
      ]);
      const open = () => {
        if (!body.firstChild) body.append(ladderLineBlock(app, c.nc_id, { brief: true }));
      };
      d.addEventListener('toggle', () => d.open && open());
      if (openFirst && i === 0) open();
      return d;
    }),
    list.length > LIMIT ? h('p', { class: 'muted', text: `Показаны последние ${LIMIT} из ${list.length}.` }) : null,
  ];
}

function kpiHint(e) {
  if (Number(e?.status) !== 403) return null;
  return h('p', { class: 'hint', text: 'Сводку ядро отдаёт тем, кто читает карточки несоответствий. Лестницы по карточкам ниже — '
    + 'по праву карточки.' });
}

function cardsSig(app) {
  return [...(app.state?.cards?.values?.() || [])].map((c) => `${c.nc_id}:${c.status}`).sort().join(',');
}

export function mountEscape(root, app) {
  const note = h('div');
  const sumBox = h('div', { class: 'es-sum' });
  const ptsBox = h('div');
  const cardBox = h('div');
  const line = app.lineFilter || 'all';
  const params = line !== 'all' ? { line_id: line } : {};
  root.append(h('section', { class: 'mo-page es-page' }, [
    h('header', { class: 'mo-head' }, [h('a', { class: 'back', href: '#/line', text: '← Линия' }),
      h('h1', { class: 'mo-h1', text: 'Что остановили и где бы это всплыло' })]),
    note,
    sumBox,
    h('div', { class: 'es-cols' }, [
      panel('Лестница по каждой карточке', cardBox),
      panel('Где контроль пропустил бы', h('div', {}, [ptsBox,
        h('p', {}, [h('a', { href: cabinetUrl('').replace(/card\?nc=$/, ''), target: '_blank', rel: 'noopener',
          text: 'Показатели смены в кабинете ↗' })])])),
    ]),
  ]));
  recordNote(app, note);
  const loaders = [];
  let last = 0;
  let timer = 0;
  function start() {
    last = Date.now();
    for (const l of loaders.splice(0)) l.stop();
    // сводка и карточки спрашиваются один раз и нужны обоим блокам; отказ каждый блок покажет сам
    const cards = (app.api.escapeCards || app.api.cards)();
    const sum = app.api.escapeSummary(params);
    cards.catch(() => null);
    sum.catch(() => null);
    const own = (cs) => (app.mode === 'demo' ? [] : cs);
    loaders.push(loader(sumBox, { what: 'сводка «что остановили»', hint: kpiHint,
      load: () => Promise.all([sum, cards.catch(() => [])]), render: ([s, cs]) => summaryView(app, s, line, own(cs), app.mode === 'demo' ? cs : null) }));
    loaders.push(loader(ptsBox, { what: 'точки пропуска', load: () => app.api.escapePoints(params), render: (r) => pointsView(app, r),
      hint: kpiHint }));
    loaders.push(loader(cardBox, { what: 'карточки', load: () => Promise.all([cards, sum.catch(() => null)]),
      render: ([cs, s]) => cardsView(app, cs, { openFirst: !s || Number(s.cards) > 0 }) }));
  }
  if (!app.api.escapeSummary) clear(sumBox).append(failBox({ status: 404, body: { detail: 'Not Found' } }, 'сводка «что остановили»'));
  else start();
  document.title = 'Что остановили — ТехДело';
  let sig = cardsSig(app);
  return {
    roleChanged: start,
    // новая карточка или решение по ней — сводка и лестницы заново, но не чаще раза в 5 с
    update(ch) {
      if (app.mode === 'demo' || !(ch.cards || ch.reset) || !app.api.escapeSummary) return;
      const now = cardsSig(app);
      if (now === sig) return;
      sig = now;
      clearTimeout(timer);
      timer = setTimeout(start, Math.max(0, MIN_UPDATE_MS - (Date.now() - last)));
    },
    destroy() {
      clearTimeout(timer);
      for (const l of loaders) l.stop();
    },
  };
}
