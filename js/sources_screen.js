// #/sources — «Входные данные» (К46): контроль корректности входных данных по каждому источнику и знак в строке
// статуса, если есть настоящая тревога (отказ с кодом, карантин, записи без подписи, замолчало оборудование).
// Повторы, опоздания и пропуски нумерации — «к сведению»: приём с ними справляется, тревоги они не поднимают.
// С ядром — GET /v1/line (LineState.sources, у ядра кеш 5 с) и сводка приёма ядра, если у роли на неё есть право (там
// карантин и отказы по источнику). Сводка приёма читает весь журнал доставок, поэтому её ответ держится: на экране —
// 15 с, для знака в строке статуса — 60 с. В демо — запись ответа ядра живого стенда (demo/core/sources.json).

import { clear, h } from './dom.js';
import { fmtNum } from './format.js';
import { failBox, loading, panel, table } from './more_dom.js';
import { CASES, NEVER, sourceRows, sourcesSign, sourcesSummary } from './sources.js';
import { workplace } from './words.js';

const POLL_MS = 5000;
const SIGN_MS = 15000;
export const STATS_SCREEN_MS = 15000; // сводка приёма на экране «Входные данные»
export const STATS_SIGN_MS = 60000; // сводка приёма для знака в строке статуса

const denied = new Map(); // роль → отказ ядра в сводке приёма (403)
const kept = new Map(); // роль → { at, stats, error } — последний ответ сводки приёма

// Сводка приёма не чаще, чем раз в maxAgeMs (на роль); 403 — больше не спрашивать
export async function ingestStatsKept(app, maxAgeMs, now = Date.now()) {
  const key = app.role?.key || '';
  if (denied.has(key)) return { stats: null, error: denied.get(key) };
  const k = kept.get(key);
  if (k && now - k.at < maxAgeMs) return k;
  let got = { at: now, stats: null, error: null };
  try {
    got.stats = await app.api.ingestStats();
  } catch (e) {
    got = { at: now, stats: null, error: e };
    if (e?.status === 403) denied.set(key, e);
  }
  kept.set(key, got);
  return got;
}

// Данные экрана: { sources, stats, statsError, now, record }
export async function loadSources(app, statsMaxAgeMs = STATS_SCREEN_MS) {
  if (app.api?.sourcesRecord) {
    const r = await app.api.sourcesRecord();
    return { sources: r.sources || [], stats: r.stats || null, statsError: null, now: r.generated_at || null, record: r.meta || null };
  }
  const line = await app.api.line();
  const { stats, error } = app.api.ingestStats ? await ingestStatsKept(app, statsMaxAgeMs) : { stats: null, error: null };
  return { sources: line?.sources || [], stats, statsError: error, now: line?.generated_at || stats?.generated_at || null, record: null };
}

const TONE_ICON = { serious: '!', caution: '◐', ok: '✓', none: '○' };

function cell(v, tone = '') {
  return h('td', { class: `num${v ? ` ${tone}` : ' faint'}`.trim(), text: v ? fmtNum(v) : '—' });
}

function rowView(r) {
  const where = [r.place, r.line].filter(Boolean).join(', ');
  const sig = r.unsigned ? `без подписи ${fmtNum(r.unsigned)}` : r.signature === 'verified' ? 'проверена'
    : r.signature === 'mixed' ? 'не у всех' : r.signature === 'unsigned' ? 'без подписи' : r.accepted ? 'не проверялась' : '—';
  const sigBad = r.unsigned || r.signature === 'mixed' || r.signature === 'unsigned';
  const quarantine = r.quarantined === null ? 'нет данных' : r.quarantined ? fmtNum(r.quarantined) : '—';
  const said = [...r.alarms, ...r.notes].join('; ');
  return h('tr', { class: `src-r tone-${r.tone}${r.state === NEVER ? ' src-never' : ''}`, title: `${r.name} (${r.kind}), номер источника ${r.id}` }, [
    h('td', { class: 'src-name' }, [h('span', { class: `zic src-ic tone-${r.tone}`, 'aria-hidden': 'true', text: TONE_ICON[r.tone] }),
      h('b', { text: r.name })]),
    h('td', { class: 'src-where', text: where || '—' }),
    h('td', { class: `src-link link-${r.link.tone}`, text: r.link.text }),
    cell(r.accepted),
    cell(r.duplicates, 'src-info'), cell(r.late, 'src-info'), cell(r.missing || r.gaps, 'src-info'), cell(r.skew, 'src-info'),
    h('td', { class: `src-sig${sigBad ? ' src-bad' : ''}`, text: sig }),
    h('td', { class: `num${r.quarantined ? ' src-bad' : ''}`, text: quarantine }),
    h('td', { class: 'src-said', text: said || (r.state === NEVER ? r.link.text : 'всё в порядке') }),
  ]);
}

function summaryView(s, statsError) {
  const facts = [
    ['На связи', s.online, ''], ['Повторов отсеяно', s.duplicates, 'info'], ['Опозданий', s.late, 'info'],
    ['Пропусков нумерации', s.gaps, 'info'], ['Ждём досылку', s.missing, 'info'], ['Расхождений часов', s.skew, 'info'],
    ['Без подписи', s.unsigned, 'bad'], ['В карантине', s.quarantined, 'bad'], ['Отказано', s.rejected, 'bad'],
  ];
  const quiet = [s.never ? `Есть в реестре, ещё не присылали данных: ${fmtNum(s.never)} (список — под таблицей)` : '',
    s.byEvent ? `Присылают по событию: ${fmtNum(s.byEvent)} (учётные системы и квитанции — их молчание нормально)` : ''].filter(Boolean);
  return h('div', { class: 'src-sum' }, [
    h('p', { class: 'src-sum-t', text: s.text }),
    h('ul', { class: 'src-facts' }, facts.map(([label, v, kind]) => h('li', {
      class: `src-f${v === null ? ' src-f-na' : v && kind === 'bad' ? ' src-f-bad' : v && kind === 'info' ? ' src-f-info' : ''}`,
    }, [`${label}: `, h('b', { text: v === null ? 'нет данных' : fmtNum(v) })]))),
    s.alarms.length
      ? h('p', { class: 'src-alarm', role: 'status' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: '!' }),
        ` Требует внимания: ${s.alarms.map((r) => `${r.name} — ${r.alarms.join(', ')}`).join('; ')}`])
      : h('p', { class: 'src-ok' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: '✓' }), ` ${s.okText}`]),
    quiet.length ? h('p', { class: 'muted src-quiet', text: quiet.join('. ') + '.' }) : null,
    statsError ? h('p', { class: 'muted src-quiet', text: `Карантин и отказы: ${statsError.status === 403 ? 'у этой роли нет права на сводку приёма — её видят ОТК, мастер, технолог, руководитель' : 'сводка приёма ядра не получена'}.` }) : null,
  ]);
}

// Ни разу не присылавшие данных — одной свёрнутой строкой под таблицей: причину ядро не знает, её не пишем
export function neverWhere(r) {
  const where = [r.place, r.line].filter(Boolean).join(', ');
  return where ? ` — ${where}` : '';
}
function neverView(rows) {
  if (!rows.length) return null;
  return h('details', { class: 'src-nev' }, [
    h('summary', { text: `В реестре, ещё не присылали данных: ${fmtNum(rows.length)}` }),
    h('ul', { class: 'src-nev-l' }, rows.map((r) => h('li', { title: `номер источника ${r.id}` }, [h('b', { text: r.name }), neverWhere(r)]))),
  ]);
}

function casesView() {
  return h('dl', { class: 'src-cases' }, CASES.flatMap(([t, d]) => [h('dt', { text: t }), h('dd', { text: d })]));
}

export function mountSources(root, app) {
  const note = h('div');
  const sumBox = h('div', {}, loading());
  const tableBox = h('div');
  root.append(h('section', { class: 'mo-page src-page' }, [
    h('header', { class: 'mo-head' }, [h('a', { class: 'back', href: '#/line', text: '← Линия' }), h('h1', { text: 'Входные данные' }),
      h('p', { class: 'muted', text: 'Что присылает каждый источник и что приём сделал с каждым случаем.' })]),
    note,
    h('div', { class: 'src-top' }, [panel('Сводка', sumBox, 'src-sum-p'), panel('Что система делает с каждым случаем', casesView(), 'src-cases-p')]),
    panel('Источники', tableBox),
  ]));
  let token = 0;
  let sig = '';
  async function run(first) {
    const my = ++token;
    try {
      const d = await loadSources(app);
      if (my !== token) return;
      const rows = sourceRows(d.sources, d.stats, d.now);
      const next = JSON.stringify([rows, !!d.statsError]);
      if (next === sig) return;
      sig = next;
      if (d.record) {
        clear(note).append(h('p', { class: 'mo-rec', title: d.record.detail || '' }, [h('b', { text: 'Демо: ответ настоящего ядра, ' }),
          d.record.text || 'записанный на живом стенде.']));
      }
      if (!rows.length) {
        clear(sumBox).append(h('p', { class: 'muted', text: 'Ядро не прислало список источников.' }));
        clear(tableBox);
        return;
      }
      clear(sumBox).append(summaryView(sourcesSummary(rows), d.statsError));
      const seen = rows.filter((r) => r.state !== NEVER);
      clear(tableBox).append(table(['Источник', 'Где', 'Связь', 'Принято', 'Повторы отсеяны', 'Опоздали', 'Пропуски номеров',
        'Часы расходятся', 'Подпись', 'Карантин', 'Что с ним'], seen.map(rowView), 'src-t'));
      const nev = neverView(rows.filter((r) => r.state === NEVER));
      if (nev) tableBox.append(nev);
    } catch (e) {
      if (my !== token || !first) return;
      clear(sumBox).append(failBox(e, 'источники на линии'));
    }
  }
  run(true);
  const timer = app.mode === 'demo' ? null : setInterval(() => run(false), POLL_MS);
  return {
    update() {},
    roleChanged() {
      sig = '';
      run(true);
    },
    unmount() {
      token += 1;
      if (timer) clearInterval(timer);
    },
  };
}

// Знак в строке статуса «! Данные: N» — только при настоящей тревоге; ссылка на экран. Один опрос на всё табло;
// у ролей-кабинетов (линию они не читают) ничего не спрашиваем
let signTimer = null;
export function watchSources(app) {
  if (signTimer) return;
  const paint = async () => {
    const el = document.getElementById('src-sign');
    if (!el || !app.api) return;
    if (workplace(app.role?.id).cabinet) {
      el.hidden = true;
      return;
    }
    let sign = null;
    try {
      const d = await loadSources(app, STATS_SIGN_MS);
      sign = sourcesSign(sourceRows(d.sources, d.stats, d.now));
    } catch {
      sign = null; // нет ответа ядра — об этом говорит значок связи, а не этот знак
    }
    el.hidden = !sign;
    if (sign) {
      if (el.textContent !== sign.text) el.textContent = sign.text;
      el.title = sign.title;
      el.setAttribute('aria-label', sign.title);
    }
  };
  signTimer = setInterval(paint, SIGN_MS);
  setTimeout(paint, 1500);
}
