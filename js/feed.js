// Журнал — выдвижная панель из строки статуса (SPEC.md 3.10): время, знак уровня, одна фраза словами; цвет — только
// у отклонений (предупреждение, карточка, деталь вне нормы, отказ или сбой внешней системы). Фильтр «Решения /
// Предупреждения / Все»; повторы — «ещё N таких же»; прокрутил вниз — вид не сдвигается (К35); пакетом раз в 2 с.

import { worstReceipt } from './actions.js';
import { isStopWarning } from './attention.js';
import { clear, h } from './dom.js';
import { EVENT_TYPES, fmtTime, isAbnormal, itemTitle, levelMeta, ZONES, zoneKey } from './format.js';
import { groupFeed, groupText } from './group.js';
import { freshText, isHeld, topSeq } from './hold.js';
import { receiptStatus } from './texts.js';

// Цвет и знак строки: только для отклонений; обычные события — без цвета
export function feedTone(e) {
  if (e.type === 'warning') {
    const m = isStopWarning(e) ? levelMeta('stop') : levelMeta(e.level);
    return { tone: m.tone, icon: m.icon, tag: m.label };
  }
  if (e.type === 'card') return { tone: 'serious', icon: '!', tag: 'карточка' };
  if (Array.isArray(e.receipts) && e.receipts.length) {
    const w = worstReceipt(e.receipts);
    const st = receiptStatus(w?.status);
    return { tone: ['critical', 'serious'].includes(st.tone) ? st.tone : 'none', icon: st.icon, tag: 'квитанция' };
  }
  if (e.zone && isAbnormal(zoneKey(e.zone))) {
    const z = zoneKey(e.zone);
    return { tone: `zone z-${z}`, icon: ZONES[z].icon, tag: ZONES[z].label };
  }
  return { tone: 'none', icon: '', tag: EVENT_TYPES[e.event_type] || '' };
}

function row(app, g) {
  const t = feedTone(g);
  const odd = t.tone !== 'none';
  const text = groupText(g);
  const li = h('li', { class: `fe${odd ? ` fe-odd ${t.tone.startsWith('zone') ? t.tone.slice(5) : `tone-${t.tone}`}` : ''}${g.item_id ? ' fe-link' : ''}` }, [
    h('time', { class: 'fe-t', text: fmtTime(g.last_at || g.at) }),
    h('span', { class: 'fe-ic', 'aria-hidden': 'true', text: t.icon }),
    h('span', { class: 'fe-tx', text }),
    g.count > 1 ? h('span', { class: 'fe-n', title: `повторов: ${g.count}; первое в ${fmtTime(g.first_at)}`, text: sameText(g.count) }) : null,
  ]);
  const items = g.items?.length > 1 ? `детали: ${g.items.map(itemTitle).join(', ')}` : '';
  li.title = [t.tag, text, items].filter(Boolean).join('\n');
  if (g.item_id) {
    const open = () => app.go(`#/item/${encodeURIComponent(g.item_id)}`);
    li.tabIndex = 0;
    li.setAttribute('role', 'link');
    li.setAttribute('aria-label', `${text}: открыть профиль детали`);
    li.addEventListener('click', open);
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  }
  return li;
}

// Прокрутил ленту вниз — новые события её не сдвигают: сверху плашка «новых записей: N — показать» (К35)
export function feedPanel(app, { limit = 50, title = 'События', all = false, pick = null } = {}) {
  const list = h('ol', { class: 'feed-list', 'aria-live': 'off' });
  const bar = h('button', { class: 'fresh-bar', type: 'button', hidden: true, onclick: () => release() });
  const el = h('div', { class: 'feed', 'aria-label': 'журнал' }, [title ? h('h2', { class: 'panel-h', text: title }) : null, bar, list]);
  const show = (e) => (all || !e.line_id || app.lineFilter === 'all' || e.line_id === app.lineFilter) && (!pick || pick(e));
  let sig = '';
  let seen = null; // самая новая запись, которую человек видит
  let rows = new Map(); // строка ленты по подписи группы: неизменившиеся строки не пересоздаются
  function release() {
    bar.hidden = true;
    sig = null; // сменился фильтр или «показать»: список строится заново, и пустой тоже (QA В-08)
    render(true);
    list.scrollTop = 0;
  }
  list.addEventListener('scroll', () => {
    if (!bar.hidden && !isHeld(list.scrollTop)) release();
  });
  function render(force = false) {
    const all = app.state.feed.filter(show);
    if (!force && isHeld(list.scrollTop) && seen !== null) {
      const fresh = all.filter((e) => (e.seq ?? 0) > seen).length;
      bar.hidden = !fresh;
      if (fresh && bar.textContent !== freshText(fresh)) bar.textContent = freshText(fresh);
      return;
    }
    bar.hidden = true;
    seen = topSeq(all);
    const groups = groupFeed(all, limit);
    const keys = groups.map((g) => `${g.group}#${g.count}#${g.last_at}`);
    const next = groups.length ? keys.join('\n') : '(пусто)';
    if (next === sig) return;
    sig = next;
    if (!groups.length) {
      rows = new Map();
      clear(list).append(h('li', { class: 'fe fe-empty', text: 'Событий пока нет.' }));
      return;
    }
    // новое событие — одна новая строка сверху, а не пересборка всей ленты
    const fresh = new Map();
    const els = groups.map((g, i) => {
      const li = rows.get(keys[i]) || row(app, g);
      fresh.set(keys[i], li);
      return li;
    });
    for (const c of [...list.children]) if (!els.includes(c)) c.remove();
    els.forEach((li, i) => {
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    rows = fresh;
  }
  return { el, full: () => render(), add: () => render(), refresh: () => release() };
}

// «×3» → «ещё 2 таких же»: число повторов словами
export function sameText(n) {
  return n > 1 ? `ещё ${n - 1} таких же` : '';
}

// Что показывает фильтр журнала: решения людей и карточки, предупреждения или всё
export const JOURNAL_FILTERS = [['decisions', 'Решения'], ['warnings', 'Предупреждения'], ['all', 'Все']];

export function journalPick(filter) {
  if (filter === 'decisions') return (e) => e.type === 'decision' || e.type === 'card';
  if (filter === 'warnings') return (e) => e.type === 'warning';
  return null;
}

// Журнал — выдвижная панель справа (420 px) поверх экрана; «≡» или Esc — закрыть. Пока закрыт — не рисуется;
// открыт — дочитывает новые записи пакетом раз в 2 с
export function journal(app) {
  let filter = 'all';
  let panel = null;
  let timer = 0;
  const drawer = () => document.getElementById('drawer');
  const button = () => document.getElementById('journal');
  function build() {
    const d = drawer();
    const tabs = h('div', { class: 'segs', role: 'group', 'aria-label': 'что показать' });
    const paintTabs = () => clear(tabs).append(...JOURNAL_FILTERS.map(([k, label]) => h('button', { type: 'button',
      class: k === filter ? 'on' : '', 'aria-pressed': String(k === filter), text: label, onclick: () => {
        filter = k;
        paintTabs();
        panel.refresh();
      } })));
    paintTabs();
    panel = feedPanel(app, { limit: 80, title: '', all: true, pick: (e) => (journalPick(filter) ? journalPick(filter)(e) : true) });
    clear(d).append(h('div', { class: 'dr-h' }, [h('h2', { text: 'Журнал' }), tabs,
      h('button', { class: 'icon-btn dr-x', type: 'button', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть журнал', text: '×',
        onclick: () => toggle(false) })]), panel.el);
  }
  function open() {
    return !!drawer() && !drawer().hidden;
  }
  function toggle(force) {
    const d = drawer();
    if (!d) return;
    const next = force ?? d.hidden;
    if (next && !panel) build();
    d.hidden = !next;
    button()?.setAttribute('aria-pressed', String(next));
    if (next) panel.full();
  }
  return {
    open, toggle,
    update() {
      if (!open() || timer) return;
      timer = setTimeout(() => {
        timer = 0;
        if (open()) panel.add();
      }, 2000);
    },
  };
}
