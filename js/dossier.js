// Дело изделия в профиле: матрица «составная часть × точка контроля», пакет документов, цепочка изделия,
// история (журнал по изделию, с квитанциями внешних систем), карточки с решениями и предупреждения.
// Норма — серым; цвет — отклонению (пустая обязательная точка, нет документа, цепочка не сходится).

import { decisionControls, receiptList } from './accept.js';
import { receiptsFor } from './actions.js';
import { skippedChecks } from './checklist.js';
import { qualitative, toleranceBand } from './band.js';
import { clear, h, zoneBadge, zoneIcon } from './dom.js';
import {
  CHAIN_CODES, DOC_KINDS, fmtDateTime, fmtPct, fmtTime, isAbnormal, isNum, levelMeta, METHODS, RESULTS, ZONES, zoneKey,
} from './format.js';
import { clean } from './group.js';
import { cardHint, cardLabel, cardRef, cpTitle, humanizeCodes, itemParts, placeTitle } from './names.js';
import { enumTitle, rememberDecisions } from './plain.js';
import { createSpark } from './spark.js';
import { ACTION_DONE } from './texts.js';

const up = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Подписи типов из справочника условного изделия (dataset/reference/item_types.yaml)
const TYPE_TITLES = {
  'BD-01': 'Блок датчиков', 'K-01': 'Корпус', 'KR-01': 'Кронштейн', 'DD-01': 'Датчик давления',
  'PE-01': 'Плата электроники', 'BLANK-K01': 'Пруток', 'PLATE-KR01': 'Пластина',
};

export function typeTitle(typeId) {
  return TYPE_TITLES[typeId] || typeId || '';
}

// Короткие подписи точек контроля маршрута (dataset/reference/route.yaml); неизвестные — по названию из профиля
const CP_SHORT = {
  'CP-IN': 'входной', 'CP-TURN': 'после токарной', 'CP-WELD': 'сварка', 'CP-FUNC': 'функцио­нирование',
  'CP-HIDDEN': 'скрытые работы', 'CP-QA': 'приёмочный', 'CP-ACCEPT': 'клеймо ОТК',
};

function rowHead(row, components, itemId, itemType) {
  const c = (components || []).find((x) => x.item_id === row);
  const title = row === itemId ? `${typeTitle(itemType) || 'Изделие'} в сборе` : c ? typeTitle(c.item_type_id) : row;
  const { base, cycleText } = itemParts(row);
  return [h('b', { text: title }), h('small', { title: row, text: base }), cycleText ? h('small', { class: 'cyc', text: cycleText }) : null];
}

function colTitle(col, checks) {
  if (CP_SHORT[col]) return CP_SHORT[col];
  const c = (checks || []).find((x) => x.control_point_id === col);
  return c?.title ? c.title.split(' ').slice(0, 2).join(' ') : col;
}

export function matrixTable(dossier, profile) {
  const m = dossier?.matrix;
  if (!m || !Array.isArray(m.rows) || !Array.isArray(m.columns)) {
    return h('p', { class: 'muted', text: 'Матрица прослеживаемости недоступна: дело изделия не получено.' });
  }
  const checks = profile?.checks || [];
  const comps = dossier.components || profile?.components || [];
  const head = h('tr', {}, [h('th', { scope: 'col', text: 'Составная часть' }),
    ...m.columns.map((c) => h('th', { scope: 'col', title: c }, [h('span', { text: colTitle(c, checks) })]))]);
  const body = m.rows.map((r) => h('tr', {}, [
    h('th', { scope: 'row' }, rowHead(r, comps, dossier.item_id, dossier.item_type_id)),
    ...m.columns.map((c) => cell(m.cells?.[r]?.[c], r, c)),
  ]));
  return h('div', { class: 'mx-wrap' }, [h('table', { class: 'mx' }, [h('thead', {}, head), h('tbody', {}, body)])]);
}

function cell(x, row, col) {
  if (!x) return h('td', { class: 'mx-na', title: 'точка к этой части не относится', text: '' });
  if (x.stamp) {
    return h('td', { class: 'mx-stamp', title: `${x.decision || 'клеймо ОТК'}` }, [h('span', { class: 'zic z-with_margin', text: '✓' }), h('small', { text: 'клеймо' })]);
  }
  if (x.empty) {
    return h('td', { class: 'mx-empty', title: `${row}, ${col}: обязательная точка без результата` }, [h('small', { text: 'пусто' })]);
  }
  const z = zoneKey(x.zone);
  const t = [ZONES[z].label, RESULTS[x.result] || x.result, isNum(x.min_margin_pct) ? `запас ${fmtPct(x.min_margin_pct)}` : '',
    x.reliable === false ? 'ненадёжно' : '', (x.card_ids || []).map((id) => `карточка ${cardRef(id)}`).join(', ')].filter(Boolean).join('; ');
  return h('td', { class: `mx-c${isAbnormal(z) ? ` z-${z} mx-odd` : ''}`, title: t }, [zoneIcon(z),
    isNum(x.min_margin_pct) ? h('small', { text: fmtPct(x.min_margin_pct) }) : null]);
}

export function documentsList(docs) {
  if (!Array.isArray(docs) || !docs.length) return h('p', { class: 'muted', text: 'Пакет документов не передан.' });
  return h('ul', { class: 'docs' }, docs.map((d) => {
    const missing = !d.present;
    const req = d.required !== false;
    return h('li', { class: missing && req ? 'doc-miss sev-critical' : missing ? 'doc-opt' : 'doc-ok' }, [
      h('span', { class: 'doc-ic', 'aria-hidden': 'true', text: missing ? '✕' : '✓' }),
      h('span', { class: 'doc-t', title: DOC_KINDS[d.kind] || '' }, clean(d.title || '') || up(DOC_KINDS[d.kind] || 'документ')),
      h('small', { class: 'muted', text: missing ? (req ? 'нет, обязательный' : 'нет') : `есть${d.reference ? `, ${clean(d.reference)}` : ''}` }),
    ]);
  }));
}

export function chainBlock(chain, onVerify) {
  const box = h('div', { class: 'chain' });
  function render(c, busy) {
    clear(box);
    if (!c) {
      box.append(h('p', { class: 'muted', text: 'Проверка цепочки ещё не выполнялась.' }));
    } else {
      const ok = c.code === 'OK';
      box.append(h('div', { class: `chain-code${ok ? '' : ' sev-critical bad'}` }, [
        h('span', { class: ok ? 'zic z-with_margin' : 'zic', 'aria-hidden': 'true', text: ok ? '✓' : '✕' }),
        h('b', { text: CHAIN_CODES[c.code] || c.code }),
        isNum(c.blocks) ? h('span', { class: 'muted', text: `, звеньев: ${c.blocks}` }) : null,
        !ok && isNum(c.seq) ? h('span', { text: `, на записи № ${c.seq}` }) : null,
      ]));
      if (c.detail) box.append(h('p', { class: 'chain-d', text: c.detail }));
      if (Array.isArray(c.signers) && c.signers.length) {
        box.append(h('p', { class: 'signers' }, [h('span', { class: 'muted', text: 'Подписали: ' }), c.signers.join(', ')]));
      }
    }
    if (onVerify) {
      box.append(h('button', { class: 'btn btn-small', type: 'button', disabled: busy, text: busy ? 'Проверяю…' : 'Проверить цепочку заново',
        onclick: async () => {
          render(c, true);
          const next = await onVerify().catch(() => null);
          render(next || c, false);
        } }));
    }
  }
  render(chain, false);
  return box;
}

// Карточка: сводка; по открытой — решения, которые ядро разрешает этой роли (Card.allowed_actions),
// и прошлые решения с квитанциями внешних систем
function cardRow(app, c, { onDecided, onClose, open: opened = new Set() } = {}) {
  const open = !['closed', 'not_confirmed'].includes(c.status);
  const body = h('div', { class: 'card-body' });
  const li = h('li', { class: open ? 'card-open sev-serious' : 'card-closed' }, [
    h('div', {}, [h('b', { text: cardLabel(c, { item: false }), title: cardHint(c.nc_id) }), `: ${c.status_title || enumTitle(c.status)}`,
      c.stage ? h('span', { class: 'muted', text: `, этап: ${enumTitle(c.stage)}` }) : null]),
    body,
  ]);
  if (open && app.api.card) {
    const btn = h('button', { class: 'btn btn-small', type: 'button', text: 'Решения по карточке', onclick: async () => {
      btn.disabled = true;
      opened.add(c.nc_id); // раскрытое остаётся раскрытым после перерисовки профиля
      try {
        const card = await app.api.card(c.nc_id);
        clear(body);
        const decs = Array.isArray(card?.decisions) ? card.decisions : [];
        for (const d of decs.slice(-3).reverse()) {
          body.append(h('p', { class: 'card-dec', text: `${ACTION_DONE[d.action] || d.action}${d.author_id ? `, ${d.author_id}` : ''}${d.decided_at ? `, ${fmtTime(d.decided_at)}` : ''}` }),
            receiptList(receiptsFor(d.event_id, { decisions: decs })) || '');
          rememberDecisions([d]);
        }
        // «Удержать» — одна кнопка на страницу, в шапке детали (SPEC 4.1 п. 4): у карточки её нет
        const acts = (card?.allowed_actions || []).filter((a) => !String(a).startsWith('hold:'));
        if (acts.length) {
          body.append(decisionControls(app, { actions: acts, target: { kind: 'nonconformance', id: c.nc_id },
            basedOnSeq: card.based_on_seq, onDecided, onClose }));
        } else {
          body.append(h('p', { class: 'muted', text: 'Для этой роли решений по карточке нет.' }));
        }
      } catch (e) {
        clear(body).append(h('p', { class: 'muted', text: `Карточка не получена: ${e.detail || e.message || e}` }));
        btn.disabled = false;
      }
    } });
    body.append(btn);
    if (opened.has(c.nc_id)) btn.click();
  }
  return li;
}

export function cardsBlock(app, cards, opts = {}) {
  if (!Array.isArray(cards) || !cards.length) return null;
  return h('ul', { class: 'cards' }, cards.map((c) => cardRow(app, c, opts)));
}

export function warningsList(ws) {
  if (!Array.isArray(ws) || !ws.length) return null;
  return h('ul', { class: 'wlist' }, ws.map((w) => {
    const m = levelMeta(w.level);
    return h('li', { class: `tone-${m.tone}` }, [h('span', { class: 'lvl' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: m.icon }), m.label]),
      ` ${clean(w.title)}`]);
  }));
}

// ---------- разделы объектной страницы: «Проверки» и «Карточки» (К39, SPEC 3.4.4, 3.4.5) ----------

// Тренд одной характеристики: точки без characteristic_id считаются точками этой же характеристики
export function trendOf(trend, characteristicId) {
  return (Array.isArray(trend) ? trend : []).filter((t) => !characteristicId || !t.characteristic_id || t.characteristic_id === characteristicId);
}

// Пропуск проверки: запись пропуска у точки или точка из пропущенных по покрытию профиля (checklist.js)
export function isSkipped(check, skips = null) {
  return zoneKey(check.zone) === 'not_checked' && (check.seq != null || !!check.event_id || !!skips?.has(check));
}

function stationTitle(app, lineId, stId) {
  const line = app.state.lines.get(lineId);
  return humanizeCodes(line?.stations.get(stId)?.title || [...app.state.lines.values()].map((l) => l.stations.get(stId)?.title).find(Boolean)
    || placeTitle(stId));
}

function sparkBox(p, list, height, cls, app, sparks, go = false) {
  const box = h('div', { class: cls, title: 'Та же характеристика у предыдущих деталей' });
  queueMicrotask(() => {
    if (!box.isConnected) return;
    const sp = createSpark(box, { height, slots: Math.max(10, list.length), onPoint: go ? (id) => app.go(`#/item/${encodeURIComponent(id)}`) : undefined });
    sp.update(list, { thresholds: p.thresholds, highlight: p.item?.item_id });
    sparks.push(sp);
  });
  return box;
}

// Для фильтра «Проверки»: вне допуска и пропуски / близко к границе / остальное
export function checkFilter(c, skips = null) {
  const z = zoneKey(c.zone);
  if (isSkipped(c, skips) || z === 'beyond_limit') return 'out';
  return z === 'near_limit' || z === 'margin_reduced' ? 'near' : 'ok';
}

function checkRow(app, p, c, sparks, skips) {
  const z = zoneKey(c.zone);
  const skipped = isSkipped(c, skips);
  const odd = isAbnormal(z) || skipped;
  const meta = [stationTitle(app, p.item?.line_id, c.station_id), METHODS[c.inspection_method] || c.inspection_method,
    c.occurred_at ? fmtDateTime(c.occurred_at) : ''].filter(Boolean).join(', ');
  const zz = skipped ? 'beyond_limit' : z;
  const reason = z === 'not_checked' ? (skipped ? `Пропуск проверки. ${clean(c.reason || '')}` : 'Впереди — деталь до этой точки ещё не дошла.')
    : clean(c.reason || '');
  const el = h('section', { class: `chk${odd ? ` chk-odd z-${zz}` : ''}${z === 'not_checked' && !skipped ? ' chk-ahead' : ''}`,
    dataset: { cp: c.control_point_id || '', f: checkFilter(c, skips) } }, [
    h('header', { class: 'chk-h' }, [
      h('span', { class: `zic z-${skipped ? 'not_checked' : z}`, 'aria-hidden': 'true', text: ZONES[z].icon }),
      h('h3', { text: clean(c.title || '') || cpTitle(c.control_point_id) }),
      skipped ? h('span', { class: 'zbadge sev-critical', text: 'пропуск проверки' }) : odd ? zoneBadge(z) : null,
      h('span', { class: 'chk-meta', title: c.control_point_id, text: meta }),
    ]),
    reason ? h('p', { class: 'chk-reason', text: reason }) : null,
  ]);
  for (const m of c.margins || []) {
    const tr = (p.trend || []).some((t) => t.characteristic_id === m.characteristic_id) ? trendOf(p.trend, m.characteristic_id) : [];
    el.append(toleranceBand(m, p.thresholds, tr.length > 1 ? sparkBox(p, tr, 30, 'tb-trend', app, sparks) : null));
  }
  const qual = !(c.margins || []).length || isNum(c.confidence) || c.reliable === false
    || ['defect_signs_detected', 'assessment_impossible'].includes(c.inspection_result);
  if (z !== 'not_checked' && qual) el.append(qualitative(c, p.thresholds));
  if ((c.card_ids || []).length) el.append(h('p', { class: 'chk-cards', text: `Карточки: ${c.card_ids.map(cardRef).join(', ')}` }));
  return el;
}

// «Проверки»: фильтр «Все / Близко к границе / Вне допуска», 10 строк и «Показать все» (SPEC 3.4.4)
const CHECK_FILTERS = [['all', 'Все'], ['near', 'Близко к границе'], ['out', 'Вне допуска и пропуски']];

export function checksList(app, p, sparks, state = { filter: 'all', all: false }) {
  const checks = [...(p.checks || [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const skips = skippedChecks(p);
  const box = h('div', { class: 'checks' });
  const bar = h('div', { class: 'chk-filter', role: 'group', 'aria-label': 'Показать проверки' });
  const more = h('button', { type: 'button', class: 'btn btn-small chk-all' });
  function paint() {
    clear(box);
    const list = checks.filter((c) => state.filter === 'all' || checkFilter(c, skips) === state.filter
      || (state.filter === 'near' && checkFilter(c, skips) === 'out'));
    const shown = state.all ? list : list.slice(0, 10);
    for (const c of shown) box.append(checkRow(app, p, c, sparks, skips));
    if (!shown.length) box.append(h('p', { class: 'muted', text: 'Таких проверок нет.' }));
    more.hidden = list.length <= 10 || state.all;
    more.textContent = `Показать все (${list.length})`;
    for (const b of bar.children) b.setAttribute('aria-pressed', String(b.dataset.f === state.filter));
  }
  for (const [f, t] of CHECK_FILTERS) {
    bar.append(h('button', { type: 'button', class: 'chip', dataset: { f }, text: t, onclick: () => { state.filter = f; paint(); } }));
  }
  more.addEventListener('click', () => { state.all = true; paint(); });
  paint();
  return h('div', { class: 'chk-wrap' }, [bar, box, more]);
}

// «Карточки»: имя (дефект и деталь), статус словами, «следующий шаг делает», «Открыть карточку» (SPEC 3.4.5).
// Пока панели карточки нет (app.openCard от К40) — решения по карточке здесь же, прежней формой
export function cardsSection(app, cards, { cardName, nextStep, statusWord, onDecided, onClose, open } = {}) {
  if (!Array.isArray(cards) || !cards.length) return h('p', { class: 'muted', text: 'Карточек несоответствия по детали нет.' });
  const panel = typeof app.openCard === 'function';
  return h('ul', { class: 'cards' }, cards.map((c) => {
    const closed = ['closed', 'not_confirmed'].includes(c.status);
    const step = nextStep?.(c) || {};
    const li = h('li', { class: closed ? 'card-closed' : 'card-open sev-serious', dataset: { nc: c.nc_id || '' } }, [
      h('div', { class: 'card-l' }, [h('b', { text: cardName?.(c) || cardLabel(c, { item: false }), title: cardHint(c.nc_id) }),
        h('span', { text: `: ${statusWord?.(c) || enumTitle(c.status)}` }),
        c.control_point_id ? h('span', { class: 'muted', text: `, ${cpTitle(c.control_point_id)}` }) : null]),
      !closed && step.who ? h('p', { class: 'card-next', text: `Следующий шаг делает: ${step.who} — ${step.what}` }) : null,
    ]);
    if (panel) {
      li.append(h('button', { type: 'button', class: 'btn btn-small', text: 'Открыть карточку', onclick: () => app.openCard(c.nc_id) }));
    } else if (!closed) {
      li.append(cardRow(app, c, { onDecided, onClose, open }).querySelector('.card-body'));
    }
    return li;
  }));
}
