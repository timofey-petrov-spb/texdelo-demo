// #/metrology — метрология (DOMAIN §17.1–17.2): индекс Cm = T / (2U) пары «средство × характеристика» с целевым
// значением из настройки (GET /v1/metrology/capability) и приборы под сомнением — окно от последней успешной поверки
// до выявления отклонения, пересчёт измерений с U + |Δ|, какие изделия затронуты, где они и что делать
// (GET /v1/instruments/{id}/suspect). Cm ниже цели — жёлтым контуром (запас снижен у средства), остальное — серым.

import { clear, h, zoneBadge } from './dom.js';
import { digitsOf, fmtNum, fmtPct, isNum } from './format.js';
import { clean } from './group.js';
import { splitBasis, warningTitle } from './plain.js';
import { activeWarnings } from './state.js';
import { failBox, formulaText, itemLink, loading, panel, recordNote, table, when } from './more_dom.js';
import { charTitle } from './names.js';
import { INSTRUMENT_TEXTS } from './texts.js';
import { cmVerdict, instrumentsOf, routeMissing } from './words.js';

// Прибор — словом справочника («микрометр»), номер прибора — в подсказке (SPEC 7.10)
const instr = (id) => INSTRUMENT_TEXTS[id] || id || '—';
const SUSPECT_NOTE = 'Отметка «прибор под сомнением» приходит из системы поверки: как только поверка найдёт отклонение, '
  + 'ядро пересчитает прежние измерения этим прибором и покажет затронутые детали здесь.';
const SUSPECT_BASIS = 'Сообщение метрологии reference.updated (справочник средств: когда выявлено, найденное отклонение, '
  + 'последняя успешная поверка), DOMAIN §17.2.';

function basisBlock(lines) {
  const list = lines.filter(Boolean);
  return list.length ? h('details', { class: 'ld-more' }, [h('summary', { text: 'Основание' }), ...list.map((x) => h('p', { class: 'ld-r', text: x }))]) : null;
}

// Номер несовершенства по ГОСТ в названии характеристики («(5011)») — в подсказке, не в строке
const firstUp = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const noCode = (t) => String(t || '').replace(/\s*\(\d{3,4}\)/g, '');

// Поверка истекла, скоро истекает, прибор под сомнением — из действующих предупреждений табло
const CAL_CODES = ['W_INSTRUMENT_CALIBRATION_EXPIRED', 'W_INSTRUMENT_SUSPECT', 'W_INSTRUMENT_CALIBRATION_DUE'];
function calibrationView(app) {
  const list = activeWarnings(app.state || { stationWarnings: new Map(), warnings: new Map(), resolved: new Set() })
    .filter((w) => CAL_CODES.includes(w.code)).sort((a, b) => CAL_CODES.indexOf(a.code) - CAL_CODES.indexOf(b.code));
  return list.map((w) => h('p', { class: `mt-cal tone-${w.code === 'W_INSTRUMENT_CALIBRATION_DUE' ? 'caution' : 'serious'}`, title: w.code }, [
    h('span', { class: 'zic', 'aria-hidden': 'true', text: w.code === 'W_INSTRUMENT_CALIBRATION_DUE' ? '◐' : '!' }),
    ` ${firstUp(clean(w.title || '') || warningTitle(w.code))}`]));
}

function capabilityView(rows) {
  if (!Array.isArray(rows) || !rows.length) return h('p', { class: 'muted', text: 'Пар «средство × характеристика» нет.' });
  const target = rows.map((r) => r.cm_target).find(isNum);
  return [
    table(['Характеристика', 'Средство измерения', 'Поле допуска T', 'Неопределённость U', 'Cm', 'Вывод'], rows.map((r) => {
      const v = cmVerdict(r);
      return h('tr', { class: v.key === 'low' ? 'mt-low tone-caution' : '' }, [
        h('th', { scope: 'row', title: r.characteristic_id, text: noCode(r.title || charTitle(r.characteristic_id, r.characteristic_id)) }),
        h('td', { title: r.instrument_id || '', text: instr(r.instrument_id) }),
        h('td', { class: 'num', text: isNum(r.tolerance) ? fmtNum(r.tolerance, 4) : '—' }),
        h('td', { class: 'num', text: isNum(r.expanded_uncertainty) ? fmtNum(r.expanded_uncertainty, 4) : '—' }),
        h('td', { class: 'num mt-cm', text: isNum(r.cm) ? fmtNum(r.cm, 2) : '—' }),
        // формула — в подсказке; строкой — только когда Cm не определён или ниже цели
        h('td', { title: formulaText(r.note || '') }, [v.key === 'low' ? h('span', { class: 'zic', 'aria-hidden': 'true', text: '◐' }) : null,
          ` ${v.label}`, r.note && v.key !== 'ok' ? h('small', { class: 'muted mt-note', text: formulaText(splitBasis(r.note).text) }) : null]),
      ]);
    }), 'mt-cap'),
    h('p', { class: 'hint', text: `Цель${isNum(target) ? ` Cm ≥ ${fmtNum(target, 1)}` : ''} — настройка технолога, не норма. `
      + 'Cm = T / (2U) — поле допуска к удвоенной неопределённости; зону и решение по детали Cm не меняет.' }),
    basisBlock(['Цель — config/margin.yaml.', 'Формула — JCGM 106:2012, формула 12, как зарубежная практика.']),
  ];
}

function reportView(app, r) {
  const rows = (r.affected || []).map((m) => h('tr', {}, [
    h('td', {}, itemLink(app, m.item_id)),
    h('td', { title: m.characteristic_id, text: charTitle(m.characteristic_id, m.characteristic_id) }),
    h('td', { class: 'num', text: isNum(m.value) ? fmtNum(m.value, 4) : '—' }),
    h('td', {}, [m.zone_before ? zoneBadge(m.zone_before) : '—', ' → ', m.zone_after ? zoneBadge(m.zone_after) : '—']),
    h('td', { class: 'num', text: isNum(m.margin_before_pct) ? fmtPct(m.margin_before_pct) : '—' }),
    h('td', { text: m.where ? clean(m.where) : '—' }),
    h('td', { class: m.action ? 'mt-act' : '', text: m.action || '—' }),
  ]));
  return h('div', { class: 'mt-rep tone-serious' }, [
    h('h3', { title: r.instrument_id || '' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: '!' }), ` ${instr(r.instrument_id)} под сомнением`,
      h('span', { class: 'muted', text: `${r.window_to ? ` с ${when(r.window_to)}` : ''}, затронуто деталей: ${(r.affected || []).length}` })]),
    h('p', { text: `Окно: ${when(r.window_from)} — ${when(r.window_to)}${r.window_basis ? ` (${clean(splitBasis(r.window_basis).text)})` : ''}; `
      + `найденное отклонение Δ = ${isNum(r.found_error) ? fmtNum(r.found_error, digitsOf(r.found_error)) : 'не передано'}.` }),
    h('p', { text: `Измерений в окне: ${r.measurements_total ?? 0}; вывод устойчив: ${r.unchanged ?? 0}; затронуто: ${(r.affected || []).length}.` }),
    rows.length ? table(['Деталь', 'Характеристика', 'Значение', 'Зона до → после', 'Запас до', 'Где сейчас', 'Что делать'], rows)
      : h('p', { class: 'muted', text: 'Затронутых изделий нет: выводы по всем измерениям устойчивы.' }),
    basisBlock([r.basis ? formulaText(r.basis) : '', r.window_basis ? String(r.window_basis) : '']),
  ]);
}

async function suspects(app, ids) {
  const out = [];
  for (const id of ids) {
    try {
      out.push({ id, report: await app.api.suspect(id) });
    } catch (e) {
      if (routeMissing(e)) throw e;
      out.push({ id, error: e });
    }
  }
  return out;
}

export function mountMetrology(root, app) {
  const note = h('div');
  const capBox = h('div', {}, loading());
  const susBox = h('div', {}, loading());
  const calBox = h('div');
  const markBox = h('div', { class: 'mt-markbox' });
  // ответ на главный вопрос экрана — первым блоком: просроченная поверка и приборы под сомнением (QA В-28, В-12)
  root.append(h('section', { class: 'mo-page' }, [
    h('header', { class: 'mo-head' }, [h('a', { class: 'back', href: '#/line', text: '← Линия' }), h('h1', { text: 'Средства измерений' }),
      h('p', { class: 'muted', text: 'Каким приборам сейчас нельзя верить и что они задели.' })]),
    note,
    panel('Каким приборам сейчас нельзя верить', [calBox, susBox, markBox]),
    panel('Индекс измерительной способности Cm', capBox),
  ]));
  recordNote(app, note);
  let token = 0;
  const showCal = () => clear(calBox).append(...calibrationView(app));
  async function load() {
    const my = ++token;
    showCal();
    let ids = Object.keys(INSTRUMENT_TEXTS).sort();
    clear(capBox).append(loading());
    clear(susBox).append(loading('Проверяю средства измерения…'));
    try {
      const rows = await app.api.capability();
      if (my !== token) return;
      clear(capBox).append(...[].concat(capabilityView(rows)));
      if (instrumentsOf(rows).length) ids = instrumentsOf(rows);
    } catch (e) {
      if (my !== token) return;
      clear(capBox).append(failBox(e, 'индекс Cm'));
    }
    try {
      const list = await suspects(app, ids);
      if (my !== token) return;
      const found = list.filter((x) => x.report);
      const errs = list.filter((x) => x.error && Number(x.error.status) !== 404);
      clear(susBox).append(
        found.length ? h('div', { class: 'mt-list' }, found.map((x) => reportView(app, x.report)))
          : h('p', { class: 'muted', text: `Под сомнением после поверки — ни одного прибора (проверено ${ids.length}).` }),
        ...errs.map((x) => h('div', {}, [h('b', { title: x.id, text: `${instr(x.id)}: ` }), failBox(x.error, 'прибор под сомнением')])),
      );
    } catch (e) {
      if (my !== token) return;
      clear(susBox).append(failBox(e, 'прибор под сомнением'));
    }
    clear(markBox).append(h('p', { class: 'hint', text: SUSPECT_NOTE }), basisBlock([SUSPECT_BASIS]));
  }
  if (!app.api.capability) clear(capBox).append(failBox({ status: 404, body: { detail: 'Not Found' } }, 'индекс Cm'));
  else load();
  document.title = 'Средства измерений — ТехДело';
  return { roleChanged: load, update(ch) { if (ch.warnings || ch.stations || ch.reset) showCal(); }, destroy() { token += 1; } };
}
