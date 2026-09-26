// Чек-лист «Можно ли принять» (К39, П4б; SPEC 3.4.3). Вердикт всегда даёт ядро (acceptance.allowed,
// acceptance.stamp); чек-лист только объясняет его — шесть условий в постоянном порядке, каждая невыполненная
// строка говорит, что мешает, что сделать и кто делает. Строки строятся ТОЛЬКО из полей профиля (coverage, checks,
// cards, item.on_hold, documents, components, chain) — тексты ядра (acceptance.blockers) не разбираются: их
// переписывает Codex, и они целиком уходят в «Подробно от системы ▸».
// Честность: allowed = true — все шесть выполнены (что по полям «у границы» — тихой строкой ◐); allowed = false, а
// по полям всё выполнено — строки «Ещё условие: <текст ядра>», ничего не прячем и не выдумываем.
// diffRows хранит снятые строки 5 с зачёркнутыми — «5 → 3» читается как «два условия выполнены».
// Без DOM — проверяется node --test на всех демо-профилях.

import { DOC_KINDS } from './format.js';
import { clean } from './group.js';
import { itemParts } from './names.js';
import { CP_TEXTS, DEFECT_TEXTS, PLACE_WHERE } from './texts.js';

export const TOTAL = 6;
// Разделитель частей одной строки по SPEC 3.4 («ждёт людей: 1 · ещё в пути: 1»); кодом — правило test_k16 про «·»
// писалось до SPEC (просьба К37 в отчёте К39)
export const SEP = ' \u00b7 ';
export const GONE_MS = 5000;

// title — выполненное условие («Выполнено: ✓ Не удержана»), head — заголовок невыполненного («Удержание: ✕ …»)
export const CONDITIONS = [
  { key: 'route', title: 'Маршрут', head: 'Маршрут' },
  { key: 'checks', title: 'Проверки', head: 'Проверки' },
  { key: 'cards', title: 'Карточки закрыты', head: 'Карточки' },
  { key: 'hold', title: 'Не удержана', head: 'Удержание' },
  { key: 'docs', title: 'Документы и составные части', head: 'Документы и составные части' },
  { key: 'chain', title: 'Записи сходятся', head: 'Записи детали' },
];

// Статус карточки в строке (SPEC 7.2, столбец «В строке»)
export const CARD_STATUS = {
  signal: 'ждёт рассмотрения', under_review: 'на рассмотрении', extra_control: 'нужен дополнительный контроль',
  confirmed: 'ждёт решения по несоответствию', not_confirmed: 'не подтверждено', awaiting_approval: 'ждёт согласования',
  approved: 'согласовано', reverification: 'повторное предъявление', isolation: 'в изоляторе',
  claim: 'рекламация поставщику', closed: 'закрыта',
};
const CLOSED = new Set(['closed', 'not_confirmed']);

// Покупные экземпляры: статус входного контроля (SPEC 7.4); собственные части в сборе (in_work) — не условие
const PURCHASED = {
  received: 'получено, не проверено', verifying: 'на проверке', nonconforming_isolated: 'несоответствующее, в изоляторе',
  claim: 'рекламация поставщику',
};
const PART_TITLES = { 'K-01': 'Корпус', 'KR-01': 'Кронштейн', 'DD-01': 'Датчик давления', 'PE-01': 'Плата электроники' };

const ROLES = {
  controller: 'инженер ОТК', qc_head: 'начальник ОТК', foreman: 'мастер участка', technologist: 'технолог',
  shift_supervisor: 'начальник смены', design_authority: 'держатель КД', customer_rep: 'представитель заказчика',
  admin: 'администратор', manager: 'руководитель производства', metrologist: 'метролог',
};

// «Следующий шаг делает» по статусу и категории карточки (SPEC 3.6)
export function nextStep(card) {
  const st = card?.status;
  const minor = card?.defect_category === 'minor';
  switch (st) {
    case 'signal': return { who: 'инженер ОТК', what: 'рассмотреть сигнал' };
    case 'under_review':
    case 'extra_control': return { who: 'инженер ОТК', what: 'подтвердить или не подтвердить' };
    case 'confirmed': return { who: minor ? 'инженер ОТК' : 'начальник ОТК', what: 'решение по несоответствию' };
    case 'reverification': return { who: 'мастер участка', what: 'переделка, затем инженер ОТК — повторная проверка' };
    case 'awaiting_approval': return { who: 'держатель КД', what: 'согласовать' };
    case 'approved': return { who: minor ? 'инженер ОТК' : 'начальник ОТК', what: 'выпустить по разрешению на отклонение' };
    case 'isolation': return { who: 'мастер участка', what: 'перенести деталь в изолятор' };
    case 'claim': return { who: 'инженер ОТК', what: 'оформить возврат поставщику' };
    case 'closed':
    case 'not_confirmed': return { who: '', what: 'карточка закрыта' };
    default: return { who: 'инженер ОТК', what: 'рассмотреть карточку' };
  }
}

const up = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Имя карточки по дефекту, пока К40 не дал cardTitle: «Подрез», «Пора»; без вида — «Карточка несоответствия»
const WELD = new Set(['undercut', 'pore', 'crack', 'lack_of_fusion', 'incomplete_penetration', 'burn_through', 'excess_weld_metal']);

export function defaultCardName(card) {
  const d = card?.defect_type;
  if (!d || !DEFECT_TEXTS[d]) return 'Карточка несоответствия';
  const word = up(DEFECT_TEXTS[d].replace(/\s*\(\d+\)$/, ''));
  return WELD.has(d) && card.control_point_id === 'CP-WELD' ? `${word} шва` : word;
}

function cpWord(cp) {
  return CP_TEXTS[cp] || 'точка контроля';
}

// «4 мин», «1 ч 5 мин»; меньше минуты — «только что»
export function waitText(fromIso, now) {
  const t = Date.parse(fromIso || '');
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return mm ? `${hh} ч ${mm} мин` : `${hh} ч`;
}

export function hhmm(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function zoneOf(c) {
  return String(c?.zone || '').toLowerCase();
}

// Пропущенные обязательные проверки: точка «не проверено» с записью пропуска (seq, event_id) — или, если ядро
// записи не приложило (живой стенд), столько первых по маршруту точек из coverage.missing, сколько в
// coverage.skipped; при pending = 0 пропущены все непроверенные
export function skippedChecks(p) {
  const all = (p?.checks || []).filter((c) => c.mandatory !== false && zoneOf(c) === 'not_checked');
  const out = new Set(all.filter((c) => c.seq != null || !!c.event_id));
  const cov = p?.coverage || p?.item?.coverage || {};
  let need = (Number(cov.skipped) || 0) - out.size;
  if (need <= 0) return out;
  const missing = new Set(cov.missing || []);
  const rest = all.filter((c) => !out.has(c) && (!missing.size || missing.has(c.control_point_id)))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  if (!(Number(cov.pending) > 0)) need = rest.length;
  for (const c of rest.slice(0, need)) out.add(c);
  return out;
}

function openCardsOn(cards, check) {
  return cards.filter((k) => !CLOSED.has(k.status)
    && ((check.card_ids || []).includes(k.nc_id) || (k.control_point_id && k.control_point_id === check.control_point_id)));
}

function subOf(check, used) {
  const base = check.control_point_id || 'cp';
  let sub = base;
  if (used.has(sub)) sub = `${base}#${check.event_id || check.seq || used.size}`;
  used.add(sub);
  return sub;
}

// Где сейчас деталь — словами из полей: «на сборочном участке» (station_id), иначе location строчными
function whereNow(item) {
  if (PLACE_WHERE[item?.station_id]) return `на ${PLACE_WHERE[item.station_id]}`;
  const loc = String(item?.location || '').trim();
  if (loc && !/[A-Z]{2,}-|_/.test(loc)) return loc[0].toLowerCase() + loc.slice(1);
  return 'на линии';
}

function routeRow(p) {
  const cov = p.coverage || p.item?.coverage || {};
  const n = Number(cov.pending) || 0;
  if (n <= 0) return [];
  return [{ sub: 'pending', mark: '●', text: `Ещё в пути: сейчас ${whereNow(p.item)}, впереди точек контроля: ${n}. Снимется само, когда деталь дойдёт`, who: '', action: null, wait: true }];
}

function checksRow(p, cards, cardName) {
  const lines = [];
  const used = new Set();
  const mandatory = (p.checks || []).filter((c) => c.mandatory !== false);
  let skipped = 0;
  let unreliable = 0;
  const skips = skippedChecks(p);
  for (const c of mandatory) {
    const z = zoneOf(c);
    const cp = cpWord(c.control_point_id);
    const act = { label: 'Открыть проверку', kind: 'check', target: c.control_point_id || null };
    if (skips.has(c)) {
      skipped += 1;
      lines.push({ sub: subOf(c, used), mark: '✕', text: `Пропущена проверка: ${cp} — вернуть деталь на точку или удержать`, who: 'мастер участка и инженер ОТК', action: act });
      continue;
    }
    if (z === 'not_checked') continue; // впереди по маршруту — это условие «Маршрут»
    if (c.reliable === false || z === 'not_assessable') {
      unreliable += 1;
      lines.push({ sub: subOf(c, used), mark: '✕', text: `Оценка невозможна: ${cp} — нужна повторная проверка`, who: 'инженер ОТК', action: act });
      continue;
    }
    if (z === 'near_limit' || z === 'beyond_limit') {
      const word = z === 'near_limit' ? 'у границы' : c.inspection_method === 'measurement' ? 'вне допуска' : 'признаки несоответствия';
      const open = openCardsOn(cards, c);
      if (open.length) {
        lines.push({ sub: subOf(c, used), mark: '◐', text: `${up(cp)}: ${word} — решается карточкой «${cardName(open[0])}»`, who: '', action: null, info: true });
      } else {
        lines.push({ sub: subOf(c, used), mark: '✕', text: `${up(cp)}: ${word} — нужна повторная проверка или карточка`, who: 'инженер ОТК', action: act });
      }
    }
  }
  const cov = p.coverage || p.item?.coverage || {};
  // покрытие знает о пропуске, а строки проверки нет (ядро не прислало точку) — всё равно не молчим
  if ((Number(cov.skipped) || 0) > skipped) {
    lines.push({ sub: 'skipped', mark: '✕', text: 'Пропущена обязательная проверка — вернуть деталь на точку или удержать', who: 'мастер участка и инженер ОТК', action: null });
  }
  if ((Number(cov.unreliable) || 0) > unreliable) {
    lines.push({ sub: 'unreliable', mark: '✕', text: 'Оценка невозможна по обязательной проверке — нужна повторная проверка', who: 'инженер ОТК', action: null });
  }
  return lines;
}

function cardsRow(p, cards, { cardName, next, now }) {
  const lines = [];
  for (const c of cards) {
    if (CLOSED.has(c.status)) continue;
    const step = next(c) || {};
    const where = c.control_point_id && CP_TEXTS[c.control_point_id] ? ` (${CP_TEXTS[c.control_point_id]})` : '';
    const wait = waitText(c.opened_at, now);
    lines.push({ sub: c.nc_id || `card${lines.length}`, mark: '✕',
      text: `${cardName(c)}${where}: ${CARD_STATUS[c.status] || 'открыта'}${wait ? `${SEP}${wait}` : ''}`,
      who: step.who || '', action: { label: 'Открыть карточку', kind: 'card', target: c.nc_id || null } });
  }
  for (const k of p.components || []) {
    if (!(Number(k.open_cards) > 0)) continue;
    lines.push({ sub: `part:${k.item_id}`, mark: '✕', text: `Составная часть ${partName(k)}: открыта карточка`, who: 'инженер ОТК',
      action: null });
  }
  return lines;
}

function partName(k) {
  const title = PART_TITLES[k.item_type_id] || 'составная часть';
  return `${title.toLowerCase()} ${itemParts(k.item_id).base}`;
}

function holdRow(p, acts, hold) {
  const it = p.item || {};
  const lines = [];
  if (it.status === 'scrapped') {
    lines.push({ sub: 'scrapped', mark: '✕', text: 'Переведена в отходы — приёмка невозможна', who: 'инженер ОТК', action: null });
  } else if (it.on_hold) {
    const reason = hold?.reason ? String(hold.reason).trim() : '';
    const tail = [hold?.who, hold?.at ? hhmm(hold.at) : ''].filter(Boolean).join(', ');
    const text = reason ? `Удержана: ${reason}${tail ? ` (${tail})` : ''}` : `Удержана${tail ? ` (${tail})` : ''} — снять удержание может инженер ОТК`;
    lines.push({ sub: 'hold', mark: '✕', text, who: 'инженер ОТК',
      action: acts.includes('hold:release') ? { label: 'Снять удержание…', kind: 'release', target: it.item_id || null } : null });
  }
  return lines;
}

function docsRow(p) {
  const lines = [];
  const seen = new Set();
  for (const d of p.documents || []) {
    if (d.present || d.required === false) continue;
    const kind = DOC_KINDS[d.kind] || 'документ';
    let sub = `doc:${d.kind || 'doc'}`;
    while (seen.has(sub)) sub += '+';
    seen.add(sub);
    lines.push({ sub, mark: '✕', text: `Нет документа: ${kind}`, who: 'мастер участка прикладывает, инженер ОТК проверяет',
      action: { label: 'Открыть документы', kind: 'docs', target: null } });
  }
  for (const k of p.components || []) {
    const st = PURCHASED[k.status];
    if (!st) continue;
    lines.push({ sub: `comp:${k.item_id}`, mark: '✕', text: `${up(partName(k))} не принята на входном контроле: ${st}`, who: 'инженер ОТК',
      action: { label: 'Открыть документы', kind: 'docs', target: null } });
  }
  return lines;
}

function chainRow(p) {
  const code = p.chain?.code;
  if (!code || code === 'OK') return [];
  return [{ sub: 'chain', mark: '✕', text: 'Записи детали не сходятся — нужна проверка журнала', who: 'администратор',
    action: { label: 'Проверить цепочку заново', kind: 'chain', target: null } }];
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Чек-лист по профилю детали. opts: cardName(card) → имя карточки (К40 cardTitle), nextStep(card) → { who, what },
// hold → { reason, who, at } последнего удержания (из решений по детали), now — мс
export function checklist(profile, opts = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const acc = p.acceptance || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const cardName = typeof opts.cardName === 'function' ? (c) => opts.cardName(c) || defaultCardName(c) : defaultCardName;
  const next = typeof opts.nextStep === 'function' ? opts.nextStep : nextStep;
  const cards = Array.isArray(p.cards) ? p.cards : [];
  const acts = Array.isArray(acc.allowed_actions) ? acc.allowed_actions : [];
  const verdict = acc.stamp ? 'accepted' : acc.allowed === true ? 'allowed' : 'blocked';

  const byKey = {
    route: routeRow(p),
    checks: checksRow(p, cards, cardName),
    cards: cardsRow(p, cards, { cardName, next, now }),
    hold: holdRow(p, acts, opts.hold),
    docs: docsRow(p),
    chain: chainRow(p),
  };
  const rows = CONDITIONS.map(({ key, title, head: name }) => {
    let lines = byKey[key];
    if (verdict !== 'blocked') {
      // ядро разрешило (или клеймо уже стоит): условие выполнено; то, что по полям у границы, — тихой строкой
      const why = key === 'checks' || key === 'cards' ? 'решено по карточке' : 'приёмке не мешает';
      lines = lines.filter((l) => l.info || l.mark === '✕')
        .map((l) => (l.info ? l : { ...l, mark: '◐', text: `${l.text.replace(/ — .*$/, '')} — ${why}`, who: '', action: null, info: true }));
    }
    const fail = lines.some((l) => l.mark === '✕');
    const wait = !fail && lines.some((l) => l.mark === '●');
    const state = fail ? 'fail' : wait ? 'wait' : lines.length ? 'info' : 'ok';
    return { key, title, head: name, state, lines: lines.map(({ sub, mark, text, who, action }) => ({ sub, mark, text, who: who || '', action: action || null })) };
  });

  const blockers = (Array.isArray(acc.blockers) ? acc.blockers : []).filter(Boolean).map((b) => clean(b)).filter(Boolean);
  const people = rows.reduce((n, r) => n + r.lines.filter((l) => l.mark === '✕').length, 0);
  const onWay = rows.reduce((n, r) => n + r.lines.filter((l) => l.mark === '●').length, 0);
  const extra = verdict === 'blocked' && !people && !onWay
    ? (blockers.length ? blockers.map((b) => `Ещё условие: ${b}`) : ['Ещё условие: система не разрешает приёмку и не назвала причину'])
    : [];
  const done = rows.filter((r) => r.state === 'ok' || r.state === 'info').length;

  let head;
  if (verdict === 'accepted') {
    const at = hhmm(acc.stamp?.decided_at);
    head = `✓ Принято ОТК${at ? ` ${at}` : ''} — клеймо поставлено`;
  } else if (verdict === 'allowed') {
    head = `✓ Можно принять — все ${TOTAL} условий выполнены`;
  } else {
    const parts = [people ? `ждёт людей: ${people}` : '', onWay ? `ещё в пути: ${onWay}` : '',
      !people && !onWay ? `${plural(extra.length, 'ещё условие', 'ещё условия', 'ещё условий')}: ${extra.length}` : ''].filter(Boolean);
    head = `! Принять нельзя — ${parts.join(SEP)}`;
  }
  const notes = (Array.isArray(acc.notes) ? acc.notes : []).filter(Boolean).map((n) => clean(n)).filter(Boolean)
    .filter((n) => !(verdict === 'accepted' && /^изделие уже принято/i.test(n))).map((n) => `Не мешает приёмке: ${n}`);

  return { verdict, head, done, total: TOTAL, people, onWay, rows, extra, notes, details: blockers };
}

// Строки, которые мешали приёмке (✕ и ●) — по ключу «условие:строка»
function openLines(list) {
  const out = new Map();
  for (const r of list?.rows || []) {
    for (const l of r.lines || []) if (l.mark === '✕' || l.mark === '●') out.set(`${r.key}:${l.sub}`, { key: r.key, sub: l.sub, text: l.text });
  }
  return out;
}

// Снятые строки: были в prev (✕ или ●), нет в next — остаются зачёркнутыми 5 с с отметкой времени, потом уходят.
// prev.gone переносится, пока не истекло; строка, которая вернулась, из снятых убирается
export function diffRows(prev, next, now = Date.now()) {
  const before = openLines(prev);
  const after = openLines(next);
  const gone = [];
  const seen = new Set();
  for (const g of prev?.gone || []) {
    const id = `${g.key}:${g.sub}`;
    if (now - g.at < GONE_MS && !after.has(id) && !seen.has(id)) {
      gone.push(g);
      seen.add(id);
    }
  }
  for (const [id, l] of before) {
    if (!after.has(id) && !seen.has(id)) {
      gone.push({ ...l, at: now });
      seen.add(id);
    }
  }
  return { next: { ...next, gone }, gone };
}

// «снято 11:43»
export function goneText(g) {
  const d = new Date(g?.at);
  if (!Number.isFinite(d.getTime())) return 'снято';
  return `снято ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
