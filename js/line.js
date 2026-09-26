// #/line — «Линия» (уровень 1 по ISA-101, SPEC.md 3.2): «Где сейчас нужен человек и какой участок уходит от режима?»
// Слева — «Требует действия» (строка на объект, «Мне | Всем», «К сведению: N ▸»); справа — плитки участков двумя
// подписанными рядами «Линия 1», «Линия 2», названия участков один раз над столбцами; под плитками — одна тихая
// строка чисел раз в 5 с. Журнал событий — выдвижной панелью из строки статуса («≡»). Анимаций сдвига нет.

import {
  attentionStats, lapKeep, resetAttentionView, setAttentionView, SEVERITY,
} from './attention.js';
import { attentionStrip } from './attn.js';
import { clear, h } from './dom.js';
import { fmtNum } from './format.js';
import { itemLineId, sortedLines, stationKey, sumTotals } from './state.js';
import { chipEl, chipOdd, stationTile, updateChip } from './tile.js';
import { isAcceptance, lineWord, shortStation, workplace } from './words.js';

export function visibleLines(app) {
  return sortedLines(app.state); // на «Линии» обе линии видны всегда; фильтр линии — в «Приёмке ОТК»
}

// Итоги линий для тихой строки: в работе, у ОТК, принято ОТК, удержано. Итоги ядра считают все круги сюжета — при
// фильтре «текущий круг» числа берутся по деталям этого круга
export function lineCounters(app) {
  const keep = lapKeep(app);
  if (!keep) return sumTotals(visibleLines(app));
  const out = { in_work: 0, at_otk: 0, accepted: 0, on_hold: 0 };
  for (const it of app.state.items.values()) {
    if (!keep(it.item_id)) continue;
    if (it.accepted) out.accepted += 1;
    else if (isAcceptance(it.station_id) || it.status === 'under_inspection') out.at_otk += 1;
    else out.in_work += 1;
    if (it.on_hold && !it.accepted) out.on_hold += 1;
  }
  return out;
}

const QUIET = [['in_work', 'В работе'], ['at_otk', 'У ОТК'], ['accepted', 'Принято ОТК'], ['on_hold', 'Удержано']];
const KIND_WORDS = { stop: ['✕', 'Стоп', 'critical'], decision: ['!', 'Решение', 'serious'], drift: ['◐', 'Уход режима', 'caution'] };

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// Тихая строка чисел: «В работе 27 · У ОТК 21 · Принято ОТК 2 · Удержано 0 · Журнал ▸»
function quietRow(app, openJournal) {
  const vals = {};
  const el = h('div', { class: 'lv-quiet', role: 'group', 'aria-label': 'итоги линий' }, [
    ...QUIET.map(([k, label]) => {
      vals[k] = h('b', { text: '—' });
      return h(k === 'at_otk' ? 'a' : 'span', { class: 'q-i', href: k === 'at_otk' ? '#/otk' : null }, [`${label} `, vals[k]]);
    }),
    h('button', { class: 'q-i q-log', type: 'button', title: 'Журнал: что происходило, по порядку', onclick: openJournal }, ['Журнал ▸']),
  ]);
  return {
    el,
    update() {
      const t = lineCounters(app);
      for (const [k] of QUIET) setText(vals[k], Number.isFinite(t[k]) ? fmtNum(t[k], 0) : '—');
    },
  };
}

// «Требует действия»: полосу рисует attn.js (К37); экран «Линия» задаёт, что в ней видно, и добавляет «Мне | Всем»,
// значок-фильтр из строки статуса и «К сведению: N ▸»
function strip(app) {
  const attn = attentionStrip(app);
  const role = () => app.role?.id;
  let mine = !app.attnKind && workplace(role()).attn === 'mine';
  let showInfo = false;
  const seg = h('div', { class: 'segs attn-seg', role: 'group', 'aria-label': 'чьё' });
  const kindChip = h('button', { class: 'attn-kind', type: 'button', hidden: true, title: 'Показать весь список' });
  const note = h('button', { class: 'attn-note', type: 'button', hidden: true });
  const info = h('button', { class: 'attn-info', type: 'button', hidden: true, title: 'Записи уровня «к сведению»: действий не требуют' });
  const foot = h('div', { class: 'attn-foot' });
  const head = attn.el.querySelector('.attn-h');
  const more = attn.el.querySelector('.attn-more');
  head?.append(seg);
  attn.el.insertBefore(kindChip, attn.el.querySelector('.attn-list'));
  foot.append(...[more, info].filter(Boolean));
  attn.el.append(note, foot);

  function apply() {
    setAttentionView({ lineAll: true, keep: lapKeep(app), hideInfo: !showInfo, mine: mine ? role() : null, kind: app.attnKind || null,
      oldest: workplace(role()).order === 'oldest' });
  }
  function paintSeg() {
    clear(seg).append(...[[true, 'Мне', 'Только то, что адресовано вашей роли'], [false, 'Всем', 'Всё, что ждёт людей на линии']]
      .map(([v, label, title]) => h('button', { type: 'button', class: v === mine ? 'on' : '', 'aria-pressed': String(v === mine), title,
        text: label, onclick: () => {
          mine = v;
          paintSeg();
          update();
        } })));
  }
  function paintExtras() {
    const st = attentionStats();
    const k = app.attnKind && KIND_WORDS[app.attnKind];
    kindChip.hidden = !k;
    if (k) {
      kindChip.className = `attn-kind sev-${k[2]}`;
      setText(kindChip, `Только «${k[1]}» ×`);
      kindChip.onclick = () => filterKind(null);
    }
    const hiddenByMine = mine && st.shown === 0 && st.all > 0;
    attn.el.classList.toggle('attn-mine-empty', hiddenByMine);
    note.hidden = !hiddenByMine;
    if (hiddenByMine) {
      setText(note, `Вам — ничего. Всем: ${st.all} — показать`);
      note.onclick = () => {
        mine = false;
        paintSeg();
        update();
      };
    }
    info.hidden = !st.info;
    setText(info, showInfo ? `${SEVERITY.advisory.label}: ${st.info} — свернуть` : `${SEVERITY.advisory.label}: ${st.info} ▸`);
    info.onclick = () => {
      showInfo = !showInfo;
      update();
    };
  }
  function update() {
    apply();
    attn.update();
    paintExtras();
  }
  function filterKind(kind) {
    app.attnKind = kind;
    if (kind) mine = false; // значок строки статуса считает всех — список показывает то же
    paintSeg();
    update();
  }
  paintSeg();
  return {
    el: attn.el, update, filterKind,
    roleChanged() {
      mine = workplace(role()).attn === 'mine';
      paintSeg();
      apply();
      attn.roleChanged();
      paintExtras();
    },
  };
}

export function mountLine(root, app, { openJournal } = {}) {
  const attn = strip(app);
  const grid = h('div', { class: 'lv-grid' });
  const quiet = quietRow(app, () => openJournal?.());
  const view = h('section', { class: 'lineview' }, [
    h('aside', { class: 'lv-left' }, [attn.el]),
    h('div', { class: 'lv-right' }, [grid, quiet.el]),
  ]);
  root.append(view);
  const tiles = new Map();
  const chips = new Map();
  let signature = '';

  const sig = () => visibleLines(app).map((l) => `${l.line_id}:${l.route.join(',')}`).join('|');
  const refreshTiles = () => {
    for (const t of tiles.values()) t.update();
  };

  function build() {
    for (const t of tiles.values()) t.destroy();
    tiles.clear();
    chips.clear();
    clear(grid);
    const lines = visibleLines(app);
    signature = sig();
    if (!lines.length) {
      grid.append(h('div', { class: 'placeholder', text: 'Ждём снимок линии из потока…' }));
      return;
    }
    const routes = lines.map((l) => (l.route.length ? l.route : [...l.stations.keys()]));
    const n = Math.max(...routes.map((r) => r.length));
    grid.style.setProperty('--n', String(n));
    // названия участков — один раз над столбцами (по первой линии: у обеих линий тот же маршрут)
    const first = lines[0];
    grid.append(h('span', { class: 'lv-corner' }), ...routes[0].map((sid) => h('span', { class: 'lv-col', title: first.stations.get(sid)?.title || sid,
      text: shortStation(first.stations.get(sid)?.title || sid) })));
    lines.forEach((line, i) => {
      grid.append(h('span', { class: 'lv-label', text: lineWord(line.line_id) }));
      for (const st of routes[i]) {
        const t = stationTile(app, line.line_id, st, refreshTiles);
        tiles.set(stationKey(line.line_id, st), t);
        grid.append(t.el);
        t.update();
      }
      for (let k = routes[i].length; k < n; k += 1) grid.append(h('span', { class: 'lv-gap' }));
    });
    placeItems();
  }

  // На плитке — только метки отклонившихся деталей текущего круга: удержанные, с пропуском, у границы, с карточкой
  function placeItems() {
    const keep = lapKeep(app);
    const seen = new Set();
    for (const it of app.state.items.values()) {
      if (it.accepted || !chipOdd(it) || (keep && !keep(it.item_id))) continue;
      const lane = tiles.get(stationKey(itemLineId(app.state, it), it.station_id))?.lane;
      if (!lane) continue;
      seen.add(it.item_id);
      let el = chips.get(it.item_id);
      if (!el) {
        el = chipEl(app, it);
        chips.set(it.item_id, el);
      } else {
        updateChip(el, it, app.limits);
      }
      if (el.parentNode !== lane) lane.append(el);
    }
    for (const [id, el] of chips) {
      if (!seen.has(id)) {
        el.remove();
        chips.delete(id);
      }
    }
  }

  function everything() {
    attn.update();
    quiet.update();
  }

  build();
  everything();
  const onResize = () => attn.update();
  addEventListener('resize', onResize);
  // тихая строка — раз в 5 с (5.4); на паузе показа рабочая зона застыла — и она тоже
  const quietTimer = setInterval(() => !app.live?.paused?.() && quiet.update(), 5000);

  return {
    update(ch) {
      if (ch.reset || sig() !== signature) {
        build();
        everything();
        return;
      }
      for (const key of ch.stations) tiles.get(key)?.update();
      if (ch.items.size || ch.removed.size) {
        placeItems();
        refreshTiles(); // статус плитки — худшее по деталям участка: плитка сама сверит подпись
      }
      if (ch.warnings || ch.cards || ch.items.size || ch.removed.size || ch.stations.size) attn.update();
    },
    filterKind(kind) {
      attn.filterKind(kind);
    },
    // смена роли: полоса «Требует действия» берёт оповещения и готовые решения новой роли
    roleChanged() {
      attn.roleChanged();
    },
    unmount() {
      removeEventListener('resize', onResize);
      clearInterval(quietTimer);
      for (const t of tiles.values()) t.destroy();
      resetAttentionView();
    },
  };
}
