// #/station/<линия>/<участок> — «Участок» (уровень 2, SPEC.md 3.3): «Процесс на участке в режиме? Если нет — с какой
// детали это началось и кто действует?» Шапка объекта с четырьмя фактами; график запаса на 8 колонок (пороги —
// подписями у правого края, отметка «уход режима, критерий N»); справа «Что делать» — строки «Требует действия» этого
// участка; внизу — 10 деталей участка и «Ещё N ▸». Обновляется только при изменении участка, его деталей и станков.

import { decisionRequest, idempotencyKey } from './actions.js';
import { decisionMessage, decisionOk } from './api.js';
import { attentionRaw, compactRow, lapKeep, SEVERITY } from './attention.js';
import { rowLine2 } from './attn.js';
import { NOTES_POLL_MS } from './config.js';
import { clear, h, toast, zoneBadge } from './dom.js';
import { fmtPct, fmtTime, MACHINE, zoneKey, ZONES } from './format.js';
import { clean } from './group.js';
import { sliceSig } from './hold.js';
import { distanceText, itemMarginLine, pointMargin } from './margin.js';
import { charTitle, humanizeCodes, itemParts, placeTitle } from './names.js';
import { createSpark } from './spark.js';
import { noteFeed, notificationsFor, summarize, takeRequest, takeReview } from './notify.js';
import { itemsAt, stationKey } from './state.js';
import { chipEl, ensureLimits, stationWorst, worstBadge } from './tile.js';
import { lineWord, machineName } from './words.js';

const ITEMS_SHOWN = 10;
const SPC = { W_SPC_RULE1: 1, W_SPC_RULE2: 2, W_SPC_RULE3: 3, W_SPC_EWMA: 'сглаженное среднее', W_SPC_CUSUM: 'накопленная сумма' };
const rank = (code) => (typeof SPC[code] === 'number' ? SPC[code] : 0);

// Уход режима на участке: из st.drift ядра, а когда участок уже вернулся в режим — из действующего предупреждения
// W_SPC_* текущего круга (отметка на графике остаётся, пока предупреждение не снято). Отметка — у точки детали, с
// которой начался уход. { criterion, since_seq, at, what, phrase } или null
export function driftOf(app, lid, sid, st, pts, last = null) {
  const keep = lapKeep(app);
  const warns = (app.state?.stationWarnings?.get(`${lid}/${sid}`) || [])
    .filter((w) => w.code in SPC && (!w.item_id || !keep || keep(w.item_id)))
    .sort((a, b) => rank(b.code) - rank(a.code));
  const w = warns[0] || null;
  // последний непустой st.drift держится, пока по участку действует W_SPC_* (просьба К37): отметка — по его since_seq
  const sd = st.drift || (w ? last : null);
  if (!sd && !w) return null;
  const bySeq = (seq) => pts.find((p) => Number.isFinite(p.seq) && p.seq >= seq);
  const byItem = w?.item_id ? pts.find((p) => p.item_id === w.item_id) : null;
  const from = (Number.isFinite(sd?.since_seq) ? bySeq(sd.since_seq) : null) || byItem;
  if (!sd && !from) return null; // предупреждение о прошлом отрезке, которого на графике уже нет
  const cid = from?.characteristic_id || pts.at(-1)?.characteristic_id;
  return {
    criterion: sd?.criterion ?? SPC[w.code],
    since_seq: from?.seq ?? sd?.since_seq,
    at: from?.occurred_at || w?.raised_at || null,
    what: cid ? charTitle(cid, app.limits?.get(cid)?.title) : '',
    phrase: sd?.title || w?.title || '',
  };
}

// Четыре факта шапки: станок, в работе, запас последней, предупреждения
export function stationFacts({ machines = [], inWork = 0, last = null, warnings = 0 }) {
  // прочерк — с пояснением (QA В-26): на участках входного контроля и приёмки станка и замеров запаса нет
  const m = machines.length ? machines.map((x) => `${machineName(x.id)}, ${MACHINE[x.ms] || x.ms || 'нет данных'}`).join('; ') : 'нет — участок контроля';
  const lastText = last && Number.isFinite(last.pct) ? `${fmtPct(last.pct)}${last.dist ? ` (${last.dist})` : ''}` : 'замеров запаса нет';
  return [['Станок', m], ['В работе', String(inWork)], ['Запас последней', lastText], ['Предупреждения', String(warnings)]];
}

export function mountStation(root, app, lineParam, stationId) {
  const head = h('header', { class: 'sv-head' });
  const facts = h('dl', { class: 'sv-facts' });
  const chartBox = h('div', { class: 'sv-chart' });
  const note = h('p', { class: 'sv-note' });
  const todo = h('ul', { class: 'sv-todo' });
  const items = h('div', { class: 'sv-items' });
  const view = h('section', { class: 'stationview' }, [
    head, facts,
    h('div', { class: 'sv-main' }, [
      h('div', { class: 'panel sv-plot' }, [h('h2', { class: 'panel-h', text: 'Запас до границы, последние 30 деталей' }), chartBox, note]),
      h('div', { class: 'panel sv-do' }, [h('h2', { class: 'panel-h', text: 'Что делать' }), todo]),
    ]),
    h('div', { class: 'panel sv-bottom' }, [h('h2', { class: 'panel-h', text: 'Детали на участке' }), items]),
  ]);
  root.append(view);
  const spark = createSpark(chartBox, { big: true, height: 280, label: 'запас до границы на участке',
    onPoint: (id) => app.go(`#/item/${encodeURIComponent(id)}`) });
  let allItems = false;

  function lineId() {
    if (lineParam && app.state.lines.has(lineParam)) return lineParam;
    for (const l of app.state.lines.values()) if (l.stations.has(stationId)) return l.line_id;
    return lineParam;
  }

  // «Снять „стоп“ по процессу» (SPEC.md 3.3, containment:release по предупреждению об уходе режима) — технологу;
  // причина обязательна; удержания деталей остаются — их снимает инженер ОТК
  let releasing = null;
  const canRelease = () => ['technologist', 'token'].includes(app.role?.id);

  function releaseForm(e, btn) {
    releasing = e.key;
    const reason = h('input', { class: 'sv-rel-in', type: 'text', placeholder: 'Причина: что восстановили в режиме',
      'aria-label': 'причина снятия «стопа»' });
    const sign = h('button', { class: 'btn btn-primary btn-small', type: 'button', text: 'Подписать', disabled: true });
    const close = () => {
      releasing = null;
      parts.delete('todo');
      render(true);
    };
    reason.oninput = () => { sign.disabled = !reason.value.trim(); };
    sign.onclick = async () => {
      sign.disabled = true;
      let ok = true;
      let msg = '';
      for (const id of e.sources) {
        const req = decisionRequest({ kind: 'containment', action: 'release' }, { kind: 'warning', id }, { reason: reason.value });
        const { http, result } = await app.api.decide(req, app.role, { idempotencyKey: idempotencyKey() });
        if (!decisionOk(http, result)) {
          ok = false;
          msg = decisionMessage(http, result);
          break;
        }
      }
      toast(ok ? '«Стоп» по процессу снят — решение записано в журнал. Удержания деталей остались.' : msg, ok ? 'ok' : 'error');
      if (ok) close();
      else sign.disabled = false;
    };
    btn.replaceWith(h('div', { class: 'sv-rel' }, [reason, h('div', { class: 'acc-row' }, [sign,
      h('button', { class: 'btn btn-small', type: 'button', text: 'Отмена', onclick: close })])]));
    reason.focus();

  }

  // оповещения по строкам «Что делать»: «Получил» — как на «Линии» (review:take_review), список — notify.js К37
  const notes = noteFeed({ load: () => (typeof app.api?.notifications === 'function' ? app.api.notifications() : []),
    onChange: () => { parts.delete('todo'); render(true); }, gapMs: 2000, pollMs: NOTES_POLL_MS });
  async function onTake(btn, take) {
    btn.disabled = true;
    const { http, result } = await app.api.decide(takeRequest(take.n, take.action), app.role, { idempotencyKey: idempotencyKey() });
    const ok = decisionOk(http, result);
    toast(ok ? 'Получение оповещения записано в журнал.' : decisionMessage(http, result), ok ? 'ok' : 'error');
    if (!ok) btn.disabled = false;
    notes.refresh(true);
  }

  function paintTodo(rows) {
    clear(todo);
    if (!rows.length) todo.append(h('li', { class: 'sv-todo-none', text: 'Ничего не ждёт — участок в режиме.' }));
    for (const e of rows) {
      const sev = SEVERITY[e.severity];
      const mine = notificationsFor(e, notes.list);
      const note = summarize(mine, Date.now());
      const take = takeReview(mine);
      const href = e.item_id ? `#/item/${encodeURIComponent(e.item_id)}` : null;
      const li = h('li', { class: `sv-todo-row sev-${e.severity}` }, [
        h('span', { class: 'sv-todo-t' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: sev.icon }),
          // «Уход режима: Уход режима, критерий 3» — слово уровня не повторяется
          e.title.toLowerCase().startsWith(e.label.toLowerCase()) ? null : h('b', { text: `${e.label} · ` }), e.title]),
        h('span', { class: 'sv-todo-s', title: e.hint || '', text: rowLine2(e, note) }),
        note && ['escalated', 'overdue', 'acknowledged'].includes(note.state) && note.text ? h('span', { class: `sv-todo-due attn-due due-${note.state}`, text: note.text }) : null,
        h('span', { class: 'sv-todo-acts' }, [
          take ? h('button', { class: 'btn btn-small attn-take', type: 'button', text: 'Получил',
            title: 'Вы получили оповещение: эскалация остановится, в журнале запишется, кто и когда',
            onclick: (ev) => onTake(ev.currentTarget, take) }) : null,
          href ? h('a', { class: 'btn btn-small', href, text: 'Открыть деталь' }) : null,
        ]),
      ]);
      if (e.kind === 'drift' && e.sources?.length && canRelease()) {
        const btn = h('button', { class: 'btn btn-small', type: 'button', text: 'Снять «стоп» по процессу',
          title: 'Режим восстановлен: удержания деталей останутся, их снимает инженер ОТК', onclick: () => releaseForm(e, btn) });
        li.append(btn);
      }
      todo.append(li);
    }
  }

  let lastDrift = null; // последний непустой уход режима участка
  let sig = '';
  const parts = new Map(); // подпись каждой части экрана: часть перерисовывается, только если её подпись сменилась
  function render(force = false) {
    const lid = lineId();
    const line = app.state.lines.get(lid);
    const st = line?.stations.get(stationId) || { station_id: stationId };
    const keep = lapKeep(app);
    const here = itemsAt(app.state, lid, stationId).filter((it) => !keep || keep(it.item_id));
    const title = (l, s) => humanizeCodes(app.state.lines.get(l)?.stations.get(s)?.title || placeTitle(s));
    const rows = attentionRaw(app.state, lid, keep, title)
      .filter((e) => e.station_id === stationId && e.line_id === lid && e.severity !== 'advisory').map((e) => compactRow(e, title));
    const machines = (st.equipment_ids || []).map((e) => ({ id: e, ms: line?.equipment.get(e)?.machine_state || '' }));
    // экран участка — только когда изменились участок, его детали, станки, строки «Что делать» или границы (К35)
    const pts = st.recent || [];
    if (st.drift) lastDrift = st.drift;
    const drift = driftOf(app, lid, stationId, st, pts, lastDrift);
    const z = zoneKey(st.zone);
    const worst = stationWorst(app, lid, stationId, { ...st, drift: st.drift || drift });
    // что видно на экране (QA В-36): живые поля участка без новой точки и без новой строки экран не трогают
    const seen = here.map((it) => [it.item_id, it.status_title, it.zone, it.min_margin_pct, it.on_hold, it.open_cards, it.coverage?.skipped]);
    const rowSig = sliceSig(rows.map((r) => [r.key, r.title, r.who, r.facts, r.sources]));
    const next = sliceSig([st.title, z, pts.at(-1)?.seq, pts.length, seen, machines, rowSig, drift, worst?.tone, line?.thresholds,
      app.limits?.size || 0, allItems]);
    if (!force && next === sig) return;
    sig = next;
    const part = (name, value) => {
      const v = sliceSig(value);
      if (parts.get(name) === v) return false; // часть перерисовывается, только если её подпись сменилась или её сбросили
      parts.set(name, v);
      return true;
    };
    if (part('rows', rowSig)) notes.refresh(); // строки сменились — оповещения по ним (не чаще раза в 2 с)
    if (part('head', [st.title, lid, worst?.tone, z])) clear(head).append(
      h('a', { class: 'back', href: '#/line', text: '← Линия' }),
      h('div', { class: 'sv-title' }, [h('h1', {}, [st.title || placeTitle(stationId), h('span', { class: 'sv-line', text: lineWord(lid).toLowerCase() })]),
        worst ? worstBadge(worst, { label: true, cls: 'sv-badge' }) : zoneBadge(z, { cls: 'sv-badge' })]),
    );
    if (part('chart', [pts.at(-1)?.seq, pts.length, drift?.since_seq, drift?.criterion, line?.thresholds])) spark.update(pts, { drift: drift && { ...(st.drift || {}), criterion: drift.criterion, since_seq: drift.since_seq },
      thresholds: line?.thresholds });
    ensureLimits(app, pts, () => render(true));
    const lp = pts.at(-1);
    const m = lp ? pointMargin(lp, app.limits) : null;
    const f = stationFacts({ machines, inWork: here.length, last: lp ? { pct: lp.margin_pct, dist: distanceText(m) } : null, warnings: rows.length });
    if (part('facts', f)) clear(facts).append(...f.flatMap(([k, v]) => [h('div', { class: 'sv-fact' }, [h('dt', { text: k }), h('dd', { text: v })])]));
    // отметка ухода режима одной строкой: критерий · характеристика · с какого времени; фраза ядра — в подсказке
    const noteText = drift
      ? [`◐ Уход режима, критерий ${drift.criterion}`, drift.what, drift.at ? `с ${fmtTime(drift.at).slice(0, 5)}` : ''].filter(Boolean).join(' · ')
      : !pts.some((p) => Number.isFinite(p.margin_pct)) ? 'Замеров запаса на этом участке нет: здесь контроль по признакам и документам, без измерений до границы допуска'
      : lp ? `${/^(BD|БД)-/.test(itemParts(lp.item_id).base) ? 'Последняя деталь' : 'Последний замер'} ${itemParts(lp.item_id).base}: запас ${fmtPct(lp.margin_pct)}${distanceText(m) ? `, ${distanceText(m)}` : ''}` : '';
    const noteTip = drift ? [humanizeCodes(clean(drift.phrase || '')),
      'Основание: контрольная карта по ГОСТ Р ИСО 7870-2-2015, пороги — настройка технолога'].filter(Boolean).join('\n') : '';
    if (part('note', [noteText, noteTip, !!drift])) {
      note.textContent = noteText;
      note.className = `sv-note${drift ? ' sv-note-drift' : ''}`;
      note.title = noteTip;
    }
    // открыта форма «Снять „стоп“» — список «Что делать» под рукой не перестраивается (SPEC.md 5.1, правило 3)
    if (!releasing && part('todo', [rowSig, notes.list.length])) paintTodo(rows);
    if (!part('items', [seen, allItems, app.limits?.size || 0])) {
      document.title = `${st.title || stationId}, ${lineWord(lid).toLowerCase()}: ${worst ? worst.label.toLowerCase() : ZONES[z].label} — ТехДело`;
      return;
    }
    clear(items);
    if (!here.length) items.append(h('p', { class: 'muted', text: 'Деталей на участке нет.' }));
    const shown = allItems ? here : here.slice(0, ITEMS_SHOWN);
    for (const it of shown) {
      // номер — полностью, как в «Требует действия» и в фактах (QA В-26: «0128» рядом с «БД-01-0120»)
      const chip = chipEl(app, it);
      chip.lastChild.textContent = itemParts(it.item_id).base;
      items.append(h('div', { class: 'sv-item' }, [chip,
        h('span', { class: 'muted', text: [it.status_title || '', itemMarginLine(it, app.limits)].filter(Boolean).join(', ') })]));
    }
    if (here.length > ITEMS_SHOWN) {
      items.append(h('button', { class: 'sv-more', type: 'button', text: allItems ? 'Свернуть' : `Ещё ${here.length - ITEMS_SHOWN} ▸`,
        onclick: () => {
          allItems = !allItems;
          render(true);
        } }));
    }
    document.title = `${st.title || stationId}, ${lineWord(lid).toLowerCase()}: ${worst ? worst.label.toLowerCase() : ZONES[z].label} — ТехДело`;
  }

  render();
  notes.refresh(true);
  return {
    update(ch) {
      const key = stationKey(lineId(), stationId);
      if (ch.reset || ch.stations.has(key) || ch.items.size || ch.removed.size || ch.warnings || ch.cards) render();
    },
    unmount() {
      spark.destroy();
    },
  };
}

// Распределение по зонам последних 30 деталей участка: по последней точке каждой детали из recent (новые — в конце).
// Точек с зоной нет — null (тогда берутся zone_counts ядра). На экране участка не показывается — дублирует график.
export function recentZoneCounts(points, limit = 30) {
  const seen = new Set();
  const out = {};
  for (let i = (points || []).length - 1; i >= 0 && seen.size < limit; i -= 1) {
    const p = points[i];
    const key = p?.item_id ?? `#${i}`;
    if (!p?.zone || seen.has(key)) continue;
    seen.add(key);
    const z = zoneKey(p.zone);
    out[z] = (out[z] || 0) + 1;
  }
  return seen.size ? out : null;
}

// Предупреждения участка: одинаковые уровень и текст — одна группа с числом, первым и последним временем
export function groupWarnings(warnings) {
  const groups = new Map();
  for (const w of warnings || []) {
    if (!w) continue;
    const key = `${w.level}|${clean(w.title || '')}`;
    let g = groups.get(key);
    if (!g) {
      g = { level: w.level, title: w.title, count: 0, first_at: null, last_at: null };
      groups.set(key, g);
    }
    g.count += 1;
    const t = w.raised_at || null;
    if (t && (!g.first_at || t < g.first_at)) g.first_at = t;
    if (t && (!g.last_at || t > g.last_at)) g.last_at = t;
  }
  return [...groups.values()];
}
