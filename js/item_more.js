// Деталь, дополнения: лестница утечки по каждой карточке (DOMAIN §16.2), ворота по карточке — какой шаг нельзя начать,
// пока карточка открыта (§17.4), пакет доказательств zip (§16.3) — К33; строка «стоп» над шапкой, меню «⋯», факты
// шапки и плашка статуса — К39 (SPEC 3.4.1). Ответы кешируются на номер записи профиля.

import { isStopWarning, warningFact } from './attention.js';
import { CARD_STATUS, defaultCardName, nextStep, SEP } from './checklist.js';
import { basisBox, clear, h, toast } from './dom.js';
import { fmtDateTime, fmtPct, isAbnormal, isNum, itemTitle, plural, zoneKey } from './format.js';
import { gaugePos } from './geometry.js';
import { distanceText } from './margin.js';
import { clean } from './group.js';
import { ladderView } from './ladder.js';
import { failBox, loading } from './more_dom.js';
import * as NAMES from './names.js';
import { splitBasis } from './plain.js';
import { typeTitle } from './dossier.js';
import { roleTitle } from './texts.js';
import { gateStatus, hasConformity } from './words.js';

const { cardHint, cardLabel, cardRef, cpTitle } = NAMES;

const VERIFY_HINT = 'Проверка у себя, без сервера ТехДела: python verify/verify_pack.py <файл>';

// Промис → узел: пока ждём — «загружаю», потом данные или отказ ядра с кодом
function settle(promise, render, what) {
  const box = h('div', {}, loading());
  promise.then((x) => clear(box).append(...[].concat(render(x)).filter(Boolean)))
    .catch((e) => clear(box).append(failBox(e, what)));
  return box;
}

function gatesView(list) {
  if (!Array.isArray(list) || !list.length) return h('p', { class: 'muted', text: 'Ворот нет: карточек с шагом-воротами у изделия нет.' });
  return h('ul', { class: 'gt-list' }, list.map((g) => {
    const s = gateStatus(g.status);
    const moved = g.decided_by ? `ворота перенёс ${g.decided_by}${g.decided_at ? `, ${fmtDateTime(g.decided_at)}` : ''}` : '';
    const why = splitBasis(g.reason || ''); // «идея …, как зарубежная практика; DOMAIN §17.4» — в «Основание»
    return h('li', { class: `gt tone-${s.tone}` }, [
      h('span', { class: 'zic', 'aria-hidden': 'true', text: s.icon }),
      h('div', {}, [
        h('b', { title: g.step_id, text: g.title || g.step_id }),
        h('span', { class: 'gt-s', text: ` — ${s.label}` }),
        g.card_id ? h('small', { class: 'muted', title: cardHint(g.card_id), text: ` (карточка ${cardRef(g.card_id)})` }) : null,
        why.text ? h('p', { class: 'ld-r', text: clean(why.text) }) : null,
        moved ? h('p', { class: 'ld-r muted', text: moved }) : null,
        basisBox(why.basis),
      ]),
    ]);
  }));
}

function packBlock(app, itemId) {
  const note = h('p', { class: 'hint', text: VERIFY_HINT });
  const btn = h('button', { class: 'btn btn-small', type: 'button', text: 'Пакет доказательств (zip)',
    title: 'Записи цепочки изделия, подписи, чекпоинт, открытые ключи и выписка — одним файлом' });
  const out = h('div', { class: 'pk-out' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    clear(out).append(loading('Собираю пакет…'));
    try {
      const { blob, name, asOfSeq } = await app.api.evidencePackFile(itemId);
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      clear(out).append(h('p', { text: `Сохранён «${name}»${isNum(asOfSeq) ? `, на запись журнала № ${asOfSeq}` : ''}. `
        + `Проверка: python verify/verify_pack.py ${name}` }));
    } catch (e) {
      clear(out).append(failBox(e, 'пакет доказательств'));
    } finally {
      btn.disabled = false;
    }
  });
  return h('div', { class: 'pk' }, [btn, note, out]);
}

export function createItemExtras(app, itemId) {
  let seq = null;
  let ladders = new Map();
  let gates = null;
  const fresh = (p) => {
    const s = p?.as_of_seq ?? null;
    if (s !== seq) {
      seq = s;
      ladders = new Map();
      gates = null;
    }
  };
  const ladder = (nc) => {
    if (!ladders.has(nc)) {
      const card = (app.api.card ? app.api.card(nc) : Promise.resolve(null)).catch(() => null);
      ladders.set(nc, Promise.all([app.api.escapeLadder(nc), card]));
      ladders.get(nc).catch(() => {});
    }
    return ladders.get(nc);
  };
  return {
    // Лестница утечки: по каждой карточке детали — где обнаружено и что было бы без этой проверки
    ladderPanel(p) {
      fresh(p);
      const cards = Array.isArray(p?.cards) ? p.cards : [];
      if (!cards.length || !app.api.escapeLadder) return null;
      return h('div', { class: 'panel' }, [h('h2', { class: 'panel-h', text: 'Лестница утечки: где нашли и что было бы без этой проверки' }),
        ...cards.map((c) => h('div', { class: 'ld-card' }, [
          h('h3', { class: 'ld-t' }, [h('span', { title: cardHint(c.nc_id), text: cardLabel(c, { item: false }) }),
            c.control_point_id ? h('span', { class: 'muted', text: `, ${cpTitle(c.control_point_id, c.control_point_id)}` }) : null]),
          settle(ladder(c.nc_id), ([l, card]) => ladderView(l, card), 'лестница утечки'),
        ]))]);
    },
    // ворота бывают только у карточек: у детали без карточек панели нет и ядро не спрашивается
    gatesPanel(p) {
      fresh(p);
      if (!app.api.gates || !(p?.cards || []).length) return null;
      if (!gates) {
        gates = app.api.gates(itemId);
        gates.catch(() => {});
      }
      return h('div', { class: 'panel' }, [h('h2', { class: 'panel-h', text: 'Ворота по карточке' }), settle(gates, gatesView, 'ворота по карточке')]);
    },
    packPanel() {
      if (!app.api.evidencePackFile) return null;
      return h('div', { class: 'panel' }, [h('h2', { class: 'panel-h', text: 'Пакет доказательств' }), packBlock(app, itemId)]);
    },
  };
}

// У измерений нет полей вероятности соответствия (ядро без API v1.6) — одна тихая строка вместо пустоты
export function conformityNote(p) {
  const numeric = (p?.checks || []).some((c) => (c.margins || []).some((m) => isNum(m.value)));
  if (!numeric || hasConformity(p)) return null;
  return h('p', { class: 'hint', title: 'поля Margin.p_conform контракта API v1.6, DOMAIN §17.1',
    text: 'Вероятность соответствия по характеристикам ядро не прислало.' });
}

// ---------- шапка объектной страницы (К39, SPEC 3.4.1) ----------

// Кому — в дательном (SPEC 7.11)
const DATIVE = {
  controller: 'инженеру ОТК', qc_head: 'начальнику ОТК', foreman: 'мастеру участка', technologist: 'технологу',
  shift_supervisor: 'начальнику смены', metrologist: 'метрологу', design_authority: 'держателю КД',
  customer_rep: 'представителю заказчика', manager: 'руководителю производства', admin: 'администратору',
};
// Пакет доказательств — только ролям с правом (config/roles.yaml, item.evidence_pack; заказчику — при приёмке заказчика)
export const PACK_ROLES = new Set(['controller', 'qc_head', 'admin', 'customer_rep']);
export const CABINET = 'http://127.0.0.1:8601';

function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  return m < 1 ? 'только что' : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

// «✕ Стоп: пропуск контроля · мастеру участка, инженеру ОТК · 2 мин» — над шапкой, пока по детали есть «стоп».
// Обновляет свой узел на месте (окно решения и страницу не трогает); тот же текст — узел не меняется
export function paintStop(el, warnings, now = Date.now()) {
  const list = (warnings || []).filter(isStopWarning).map((w) => warningFact(w, null))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  if (!list.length) {
    if (!el.hidden) el.hidden = true;
    return;
  }
  const top = list[0];
  const titles = [...new Set(list.map((f) => f.title[0].toLowerCase() + f.title.slice(1)))].join(', ');
  const who = [...new Set(list.flatMap((f) => f.who))].map((r) => DATIVE[r] || roleTitle(r)).filter(Boolean).join(', ');
  const text = [`Стоп: ${titles}`, who, ago(top.at, now)].filter(Boolean).join(SEP);
  if (el.dataset.t !== text) {
    el.dataset.t = text;
    clear(el).append(h('span', { class: 'stop-mk', 'aria-hidden': 'true', text: '✕' }), h('span', { text }));
  }
  if (el.hidden) el.hidden = false;
}

// «⋯» в шапке: пакет доказательств (ролям с правом), «Полностью в кабинете ↗», «Проверить цепочку заново»
export function moreMenu(app, itemId, { onVerify } = {}) {
  const items = [];
  if (app.api?.evidencePackFile && PACK_ROLES.has(app.role?.id)) {
    const b = h('button', { type: 'button', class: 'mn-i', text: 'Пакет доказательств (zip)', title: VERIFY_HINT });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const { blob, name } = await app.api.evidencePackFile(itemId);
        const a = h('a', { href: URL.createObjectURL(blob), download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast(`Пакет доказательств сохранён: ${name}`, 'ok');
      } catch (e) {
        toast(`Пакет доказательств не получен: ${e?.detail || e?.message || e}`, 'error');
      } finally {
        b.disabled = false;
      }
    });
    items.push(b);
  }
  items.push(h('a', { class: 'mn-i', href: `${app.cabinetUrl || CABINET}/?item=${encodeURIComponent(itemId)}`, target: '_blank', rel: 'noopener',
    text: 'Полностью в кабинете ↗' }));
  if (onVerify) items.push(h('button', { type: 'button', class: 'mn-i', text: 'Проверить цепочку заново', onclick: onVerify }));
  return h('details', { class: 'pf-more' }, [h('summary', { 'aria-label': 'Ещё действия', title: 'Ещё действия', text: '⋯' }),
    h('div', { class: 'mn' }, items)]);
}

// ---------- факты шапки и плашка (К39) — без DOM ----------

export function coverageOf(p) {
  const checks = (p.checks || []).filter((c) => c.mandatory !== false);
  const nc = checks.filter((c) => zoneKey(c.zone) === 'not_checked');
  const c = p.coverage || p.item?.coverage || {};
  const skippedD = nc.filter((x) => x.seq != null || x.event_id).length;
  return {
    required: c.required ?? checks.length,
    reliable: c.reliable ?? checks.filter((x) => zoneKey(x.zone) !== 'not_checked' && x.reliable !== false).length,
    unreliable: c.unreliable ?? checks.filter((x) => zoneKey(x.zone) !== 'not_checked' && x.reliable === false).length,
    skipped: c.skipped ?? skippedD,
    pending: c.pending ?? nc.length - skippedD,
    missing: c.missing || [],
  };
}

// «Блок датчиков БД-01»; тип без названия в справочнике — только обозначение, без повтора
export function typeLabel(typeId) {
  if (!typeId) return '';
  const t = typeTitle(typeId);
  return t && t !== typeId ? `${t} ${itemTitle(typeId)}` : itemTitle(typeId);
}

// Имя карточки для чек-листа: от К40 (cardTitle, «Подрез шва · БД-01-0114» — без детали, она в шапке), иначе по дефекту
export function cardNameOf(c) {
  const t = typeof NAMES.cardTitle === 'function' ? String(NAMES.cardTitle(c) || '') : '';
  if (!t || /NC-|[0-9a-f]{8}/.test(t)) return '';
  return t.split(SEP)[0];
}

// «Следующий шаг делает» — от К40 (names.js cardNextStep: «инженер ОТК — рассмотреть сигнал»), иначе по SPEC 3.6
export function stepOf(c) {
  if (typeof NAMES.cardNextStep !== 'function') return nextStep(c);
  const t = String(NAMES.cardNextStep(c?.status, c?.defect_category) || '');
  if (!t) return nextStep(c);
  const i = t.indexOf(' — ');
  const who = i > 0 ? t.slice(0, i) : t;
  return { who: /^никто/.test(who) ? '' : who, what: i > 0 ? t.slice(i + 3) : '' };
}

// Последнее удержание детали (из решений): причина, кто, когда — для строки «Удержана: …»
export function holdInfo(decisions) {
  const d = (decisions || []).find((x) => x.action === 'hold' || x.action === 'release');
  if (!d || d.action !== 'hold') return null;
  return { reason: d.reason || '', who: roleTitle(d.role) || d.author_id || '', at: d.decided_at || null };
}

// Плашка статуса (SPEC 3.4.1) — одно-два слова
export function pillOf(p, cl) {
  const it = p.item || {};
  if (cl.verdict === 'accepted') return { cls: 'pl-done', text: `✓ Принято ОТК ${cl.head.match(/\d\d:\d\d/)?.[0] || ''}`.trim() };
  if (it.on_hold) return { cls: 'pl-hold', text: '⏸ Удержана' };
  if (cl.verdict === 'allowed') return { cls: 'pl-ok', text: '● Можно принять' };
  if (!cl.people && cl.onWay) return { cls: 'pl-way', text: '○ Ещё в пути' };
  return { cls: 'pl-bad', text: '! Не готова к приёмке' };
}

function fact(label, value, cls = '') {
  return h('div', { class: `fx ${cls}`.trim() }, [h('dt', { text: label }), h('dd', {}, value)]);
}

const up = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const OPEN_OFF = new Set(['closed', 'not_confirmed']);

// Четыре факта шапки (SPEC 3.4.1): где сейчас, наименьший запас с мини-шкалой, проверки, карточки
export function factsOf(app, p, cl) {
  const it = p.item || {};
  const route = app.state.lines.get(it.line_id)?.route || [];
  const idx = route.indexOf(it.station_id);
  const where = cl.verdict === 'accepted'
    ? `Принято ОТК, ${/склад/i.test(it.location || '') || it.station_id === 'STORE' ? 'передано на склад' : it.station_id === 'ST-QA' ? 'ждёт передачи на склад' : NAMES.placeTitle(it.station_id, 'на месте')}`
    : `${up(NAMES.placeTitle(it.station_id, it.location || '—'))}${idx >= 0 ? `, ${idx + 1} из ${route.length}` : ''}`;
  const mm = p.min_margin;
  const z = zoneKey(mm?.zone);
  const margin = mm && isNum(mm.margin_pct) ? [h('b', { class: 'fx-n', text: fmtPct(mm.margin_pct) }), h('span', { class: 'fx-s', text: distanceText(mm) }),
    h('span', { class: 'fx-gauge', 'aria-hidden': 'true' }, [h('span', { class: `fx-mark${isAbnormal(z) ? ` z-${z}` : ''}`, style: { left: `${gaugePos(mm.margin_pct)}%` } })])]
    : [h('b', { class: 'fx-n', text: '—' }), h('span', { class: 'fx-s', text: 'числа нет' })];
  const cov = coverageOf(p);
  const covText = [`${cov.reliable} из ${cov.required} надёжно`, cov.skipped ? `${cov.skipped} ${plural(cov.skipped, 'пропущена', 'пропущены', 'пропущено')}` : '',
    cov.pending ? `впереди ${cov.pending}` : ''].filter(Boolean).join(', ');
  const open = (p.cards || []).filter((c) => !OPEN_OFF.has(c.status)).length;
  return [
    fact('Где сейчас', where),
    fact('Наименьший запас', margin, isAbnormal(z) ? `z-${z} fx-odd` : ''),
    fact('Проверки', covText, cov.skipped ? 'sev-critical fx-odd' : ''),
    fact('Карточки', open ? `${open} ${plural(open, 'открыта', 'открыты', 'открыто')}` : 'нет', open ? 'sev-serious fx-odd' : ''),
  ];
}

// «Пока вы писали: карточка «Подрез шва» перешла в «на рассмотрении»» — что изменилось в детали под окном решения
export function changesText(before, after, cardName = () => '') {
  if (!before || !after) return '';
  const out = [];
  const old = new Map((before.cards || []).map((c) => [c.nc_id, c]));
  for (const c of after.cards || []) {
    const name = cardName(c) || defaultCardName(c);
    const was = old.get(c.nc_id);
    if (!was) out.push(`открыта карточка «${name}»`);
    else if (was.status !== c.status) out.push(`карточка «${name}» перешла в «${CARD_STATUS[c.status] || 'другой статус'}»`);
  }
  if (!!before.item?.on_hold !== !!after.item?.on_hold) out.push(after.item?.on_hold ? 'деталь удержана' : 'удержание снято');
  if (!before.acceptance?.stamp && after.acceptance?.stamp) out.push('клеймо ОТК поставлено');
  if (before.acceptance?.allowed !== after.acceptance?.allowed) out.push(after.acceptance?.allowed ? 'приёмка стала возможна' : 'приёмка стала невозможна');
  if (!out.length && before.item?.station_id !== after.item?.station_id) out.push(`деталь перешла: ${NAMES.placeTitle(after.item?.station_id, 'дальше по маршруту')}`);
  return out.join('; ') || 'появились новые записи по детали';
}

// Перейти к строке (из нижней панели, «Открыть проверку»): прокрутка и подсветка фона на 2 с, без движения (SPEC 5.1)
export function showHere(el) {
  if (!el) return;
  el.scrollIntoView?.({ block: 'center' });
  el.classList?.add('flash');
  setTimeout(() => el.classList?.remove('flash'), 2000);
}

// Откуда пришли на деталь: «← Приёмка ОТК» / «← Линия» / «← Участок» (открыли по ссылке — по стартовому экрану роли)
let cameFrom = '';
globalThis.addEventListener?.('hashchange', (e) => {
  const old = String(e.oldURL || '').replace(/^[^#]*/, '');
  if (old && !old.startsWith('#/item/')) cameFrom = old;
});
const BACK = [[/^#\/otk/, '← Приёмка ОТК'], [/^#\/station\//, '← Участок'], [/^#\/escape/, '← Что остановили'], [/^#\/line|^#?\/?$/, '← Линия']];

export function backLink(start = '', from = cameFrom) {
  for (const src of [from, start]) {
    const hit = src && BACK.find(([re]) => re.test(src));
    if (hit) return [src, hit[1]];
  }
  return ['#/line', '← Линия'];
}
