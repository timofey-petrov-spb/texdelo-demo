// #/otk — «Приёмка ОТК» (SPEC 3.7; К37, П5): слева очередь тремя группами — «Готовы к приёмке», «Мешает» (одна
// главная причина словом), «Ещё в пути ▸» и «Принято ОТК ▸» свёрнуты; над ней «Показать: Обе линии · Линия 1 ·
// Линия 2» с числами (по умолчанию — линия роли) и «Найти деталь». Справа — деталь (createProfile) и «3 из 12 ↑ ↓».
// Готовность строк — по сводке детали из снимка линии, без запроса профиля на строку; профиль — только у выбранной
// детали (тот же запрос, что делает сама страница детали): не разрешена — строка уходит в «Мешает» с причиной ядра.
// Строки по ключу: список не пересобирается, порядок в группе — как детали пришли к ОТК.

import { otkStacked } from './config.js';
import { clear, h, zoneIcon } from './dom.js';
import { findItemId, plural, zoneKey } from './format.js';
import { load, save } from './header.js';
import { sliceSig } from './hold.js';
import { createProfile } from './item.js';
import { itemParts, placeTitle } from './names.js';
import { lineCounts, lineName, neighbour, otkGroups, positionText, profileVerdict, roleLine, staleLap } from './otk_groups.js';

const PAINT_MS = 300;

// Страница детали берёт профиль сама; обёртка отдаёт его и очереди — без второго запроса
function tapProfile(app, onProfile) {
  const wrapped = new WeakMap();
  const wrap = (api) => {
    if (!api || typeof api !== 'object') return api;
    if (!wrapped.has(api)) {
      wrapped.set(api, new Proxy(api, {
        get(t, k) {
          const v = Reflect.get(t, k);
          if (k !== 'profile' || typeof v !== 'function') return typeof v === 'function' ? v.bind(t) : v;
          return async (id, ...rest) => {
            const p = await v.call(t, id, ...rest);
            onProfile(id, p);
            return p;
          };
        },
      }));
    }
    return wrapped.get(api);
  };
  return new Proxy(app, {
    get: (t, k) => (k === 'api' ? wrap(t.api) : Reflect.get(t, k)),
    set: (t, k, v) => Reflect.set(t, k, v),
  });
}

function stationName(app, it) {
  const st = app.state.lines.get(it.line_id)?.stations.get(it.station_id);
  return st?.title || placeTitle(it.station_id, it.location || '');
}

export function mountOtk(root, app, selectedId) {
  const lineKey = `otk.line.${app.role?.key || ''}`;
  let line = load(lineKey, roleLine(app.role));
  // стили .q-show — просьба к владельцу css (отчёт К37); до того — встроенно, чтобы кнопки не ломались в узкой очереди
  const picker = h('div', { class: 'linepick q-show', role: 'group', 'aria-label': 'какие линии показать',
    style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
  const input = h('input', { type: 'search', placeholder: '0114', 'aria-label': 'номер детали', autocomplete: 'off' });
  const form = h('form', { class: 'q-find', onsubmit: (e) => {
    e.preventDefault();
    // «0101», «БД-01-0101» или полный номер; у живого стенда номер с меткой прогона — ищется среди деталей линии
    const id = findItemId(input.value, app.state.items.keys());
    if (id) app.go(`#/otk/${encodeURIComponent(id)}`);
  } }, [input, h('button', { class: 'btn btn-small', type: 'submit', text: 'Открыть' })]);

  // группы: заголовок с числом + список по ключу; «в пути» и «принято» — свёрнуты
  const groups = {
    ready: group('Готовы к приёмке', false),
    blocked: group('Мешает', false),
    transit: group('Ещё в пути', true),
    accepted: group('Принято ОТК сегодня', true),
  };
  const held = h('button', { class: 'fresh-bar', type: 'button', hidden: true, onclick: () => paint(true) });
  const pos = h('span', { class: 'q-pos muted' });
  const up = h('button', { class: 'btn btn-small', type: 'button', title: 'Предыдущая деталь (клавиша ↑)', text: '↑', onclick: () => step(-1) });
  const down = h('button', { class: 'btn btn-small', type: 'button', title: 'Следующая деталь (клавиша ↓)', text: '↓', onclick: () => step(1) });
  const nav = h('div', { class: 'q-nav', style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '8px' } },
    [pos, up, down]);
  const box = h('div', { class: 'otk-item' });
  const pane = h('div', { class: 'otk-pane' }, [nav, box]);
  const view = h('section', { class: 'otkview' }, [
    h('aside', { class: 'panel otk-queue', 'aria-label': 'очередь приёмки' }, [
      h('div', { class: 'q-sub', text: 'Показать' }), picker,
      h('div', { class: 'q-sub', text: 'Найти деталь' }), form, held,
      groups.ready.el, groups.blocked.el, groups.transit.el, groups.accepted.el,
    ]),
    pane,
  ]);
  root.append(view);

  const verdicts = new Map(); // профиль выбранной детали → «разрешено ли», по номеру детали
  const arrival = new Map();
  const papp = tapProfile(app, (id, p) => {
    const v = profileVerdict(p);
    if (!v) return;
    if (sliceSig(verdicts.get(id)) !== sliceSig(v)) {
      verdicts.set(id, v);
      paintSoon();
    }
  });
  let current = null;
  let currentId = null;
  let order = []; // видимый порядок «Готовы» + «Мешает» — для ↑ ↓
  let pickerSig = '';
  let painted = false;
  let timer = 0;
  let gone = false;

  function group(title, folded) {
    const count = h('span', { class: 'q-count' });
    const list = h('ol', { class: 'q-list' });
    const head = [title, ' ', count];
    // свёрнутая группа («в пути», «принято») строки не держит в порядке — только число; раскрыли — дорисовалась
    const el = folded
      ? h('details', { class: 'q-group', ontoggle: () => el.open && paint(true) }, [h('summary', { class: 'q-sub' }, head), list])
      : h('section', { class: 'q-group' }, [h('h2', { class: 'q-sub' }, head), list]);
    return { el, count, list, rows: new Map(), folded };
  }

  function rowParts(kind, x) {
    const it = x.it;
    const parts = itemParts(it.item_id);
    const where = kind === 'transit' ? stationName(app, it) : '';
    const tail = kind === 'ready' ? (Number.isFinite(it.min_margin_pct) ? `запас ${Math.round(it.min_margin_pct)} %` : 'можно принять')
      : kind === 'blocked' ? x.reason.text : kind === 'accepted' ? 'принято ОТК' : x.checking ? 'идёт приёмочный контроль' : where;
    return { id: it.item_id, base: parts.base, cycle: app.lapFilter === 'all' ? parts.cycleText : staleLap(app.state, it.item_id), line: line === 'all' ? lineName(it.line_id) : '', tail, icon: kind === 'blocked' ? x.reason.icon : null,
      zone: zoneKey(it.zone), active: it.item_id === currentId, odd: kind === 'blocked', skip: x.reason?.key === 'skip' };
  }

  function rowEl(r) {
    const icon = r.icon ? h('span', { class: `zic${r.icon === '✕' ? ' zic-skip' : ''}`, 'aria-hidden': 'true', text: r.icon }) : zoneIcon(r.zone);
    const odd = r.skip ? ' q-skip' : r.odd ? ' z-near_limit q-odd-z' : '';
    return h('li', { dataset: { id: r.id } }, [h('a', { class: `q-item${r.active ? ' active' : ''}${odd}`,
      href: `#/otk/${encodeURIComponent(r.id)}`, 'aria-current': r.active ? 'true' : null, title: r.id }, [
      icon,
      h('span', { class: 'q-main' }, [
        h('span', {}, [h('b', { text: r.base }), r.line ? h('span', { class: 'muted', text: `, ${r.line}` }) : null,
          r.cycle ? h('small', { class: 'cyc', text: r.cycle }) : null]),
        r.tail ? h('span', { class: r.odd ? 'q-ready q-odd' : 'q-meta', text: r.tail }) : null,
      ]),
    ])]);
  }

  // Строки по ключу: новая — создаётся, изменившаяся — заменяется, ушедшая — снимается; порядок — перестановкой
  function paintGroup(g, kind, rows, empty) {
    const n = String(rows.length);
    if (g.count.textContent !== n) g.count.textContent = n;
    if (g.folded && !g.el.open) return;
    const want = rows.map((x) => rowParts(kind, x));
    const keep = new Set(want.map((r) => r.id));
    for (const [id, rec] of g.rows) {
      if (!keep.has(id)) {
        rec.el.remove();
        g.rows.delete(id);
      }
    }
    g.list.querySelector?.('.q-empty')?.remove();
    let prev = null;
    for (const r of want) {
      const sig = sliceSig(r);
      let rec = g.rows.get(r.id);
      if (!rec || rec.sig !== sig) {
        const el = rowEl(r);
        if (rec) rec.el.replaceWith(el);
        rec = { el, sig };
        g.rows.set(r.id, rec);
      }
      const at = prev ? prev.nextSibling : g.list.firstChild;
      if (rec.el !== at) g.list.insertBefore(rec.el, at);
      prev = rec.el;
    }
    if (!want.length && empty) g.list.append(h('li', { class: 'muted q-empty', text: empty }));
  }

  function paintPicker() {
    const counts = lineCounts(app.state, app.lapFilter);
    const ids = ['all', ...[...app.state.lines.keys()].filter((x) => x !== '—').sort()];
    if (line !== 'all' && !ids.includes(line) && app.state.lines.size) line = 'all';
    const sig = sliceSig([line, ids.map((id) => [id, counts[id] || 0])]);
    if (sig === pickerSig) return;
    pickerSig = sig;
    clear(picker);
    for (const id of ids) {
      const n = counts[id] || 0;
      picker.append(h('button', { type: 'button', class: line === id ? 'on' : '', 'aria-pressed': String(line === id), style: { whiteSpace: 'nowrap' },
        title: `У ОТК: ${n} ${plural(n, 'деталь', 'детали', 'деталей')}`, onclick: () => {
          line = id;
          save(lineKey, id);
          paint(true);
        } }, [id === 'all' ? 'Обе ' : `${lineName(id)} `, h('b', { text: String(n) })]));
    }
  }

  // Человек работает с деталью (открыто окно или форма решения, курсор в поле) — очередь не перестраивается под
  // рукой: сверху плашка «1 деталь готова к приёмке — показать» (SPEC 3.7); окно закрыто — очередь догоняет
  function busy() {
    const a = document.activeElement;
    return !!(document.querySelector?.('dialog[open]') || box.querySelector?.('.acc-reason:not([hidden])')
      || (a && box.contains?.(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')));
  }

  function paint(force = false) {
    if (gone) return;
    clearTimeout(timer);
    timer = 0;
    const g = otkGroups(app.state, { line, lap: app.lapFilter, verdicts, arrival });
    if (!force && painted && busy()) {
      const n = g.ready.filter((x) => !groups.ready.rows.has(x.it.item_id)).length;
      const text = `${n} ${plural(n, 'деталь готова', 'детали готовы', 'деталей готовы')} к приёмке — показать`;
      held.hidden = !n;
      if (n && held.textContent !== text) held.textContent = text;
      timer = setTimeout(paint, 1000); // окно закроют — очередь догонит без нового события
      return g;
    }
    painted = true;
    held.hidden = true;
    paintPicker();
    paintGroup(groups.ready, 'ready', g.ready, 'Сейчас принять нечего.');
    paintGroup(groups.blocked, 'blocked', g.blocked, '');
    paintGroup(groups.transit, 'transit', g.transit, '');
    paintGroup(groups.accepted, 'accepted', g.accepted, '');
    groups.blocked.el.hidden = !g.blocked.length;
    order = [...g.ready, ...g.blocked].map((x) => x.it.item_id);
    // ничего не выбрано (открыли, пока очередь была пуста, — начало сюжета, смена круга) — первая деталь очереди
    if (!currentId && order.length) {
      select(order[0]);
      const row = groups.ready.rows.get(currentId) || groups.blocked.rows.get(currentId);
      row?.el.querySelector?.('a')?.classList.add('active');
    }
    pos.textContent = currentId ? positionText(order, currentId) : '';
    up.disabled = order.indexOf(currentId) <= 0;
    down.disabled = !order.length || order.indexOf(currentId) === order.length - 1;
    return g;
  }

  function paintSoon() {
    if (!timer && !gone) timer = setTimeout(paint, PAINT_MS);
  }

  function select(id) {
    if (id === currentId && current) return;
    current?.destroy();
    currentId = id;
    clear(box);
    if (!id) {
      box.append(h('div', { class: 'panel otk-empty' }, [h('h2', { text: 'Выберите деталь в очереди' })]));
      current = null;
      return;
    }
    current = createProfile(box, papp, id, { back: false, onDecided: () => verdicts.delete(id) });
  }

  function step(d) {
    const id = neighbour(order, currentId, d);
    if (id && id !== currentId) app.go(`#/otk/${encodeURIComponent(id)}`);
  }

  // ↑ ↓ — соседняя деталь; не в поле ввода и не при открытом окне
  function onKey(e) {
    if (gone || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '') || t?.isContentEditable) return;
    if (document.querySelector?.('dialog[open]')) return;
    e.preventDefault();
    step(e.key === 'ArrowUp' ? -1 : 1);
  }
  globalThis.addEventListener?.('keydown', onKey);

  const first = paint();
  select(selectedId || first.ready[0]?.it.item_id || first.blocked[0]?.it.item_id || null);
  paint();

  return {
    select(id) {
      const g = id ? null : otkGroups(app.state, { line, lap: app.lapFilter, verdicts, arrival });
      select(id || g.ready[0]?.it.item_id || g.blocked[0]?.it.item_id || null);
      paint(true);
      // узкое окно: деталь под очередью — показать её, а не оставить человека в списке
      if (id && otkStacked(globalThis.innerWidth)) {
        pane.scrollIntoView({ block: 'start' });
        setTimeout(() => currentId === id && pane.scrollIntoView({ block: 'start' }), 450);
      }
    },
    update(ch) {
      if (ch.reset || ch.items.size || ch.removed.size || ch.lines.size) paintSoon();
      current?.update(ch);
    },
    unmount() {
      gone = true;
      clearTimeout(timer);
      globalThis.removeEventListener?.('keydown', onKey);
      current?.destroy();
    },
  };
}
