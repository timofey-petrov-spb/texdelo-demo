// #/suppliers — входной контроль с переключением строгости (DOMAIN §17.5): ступень (сплошной, выборочный, пропуск) по
// паре «поставщик × тип изделия» — почему такая и когда переключится (GET /v1/suppliers/quality); требование к каждой
// партии на момент регистрации и расхождение с заявленной проверкой (GET /v1/lots/{lot_id}/incoming); активные
// предупреждения W_INCOMING_STAGE_WEAKER. Ступень — серым (это не отклонение), цвет — только расхождению.

import { clear, h } from './dom.js';
import { typeTitle } from './dossier.js';
import { levelMeta } from './format.js';
import { clean } from './group.js';
import { splitBasis } from './plain.js';
import { failBox, itemLink, loading, panel, recordNote, table } from './more_dom.js';
import { activeWarnings } from './state.js';
import { LOT_OUTCOMES, stageMeta, switchText, weaker } from './words.js';

const WEAKER = 'W_INCOMING_STAGE_WEAKER';
const LOTS_MAX = 40;
// Откуда исход партии (qc/domain/incoming_facts.py) — словами
const LOT_SOURCES = { incoming_control: 'входной контроль', card: 'карточка несоответствия', complaint: 'рекламация' };

// Ступень — словом в рамке, без знаков «◑ ●»: их нет в легенде, на проекторе «◑» не отличить от «◐» (QA В-21)
function stageBadge(stage) {
  const m = stageMeta(stage);
  return h('span', { class: 'sp-stage', title: m.hint, text: m.label });
}

// Поставщик словом: «SUP-A» → «поставщик А» (код — в подсказке); тип изделия — словом справочника
const RU_LETTER = { A: 'А', B: 'Б', C: 'В', D: 'Г', E: 'Д', F: 'Е' };
export function supplierTitle(id) {
  const m = /^SUP-([A-Z])$/.exec(String(id || ''));
  return m ? `поставщик ${RU_LETTER[m[1]] || m[1]}` : String(id || '—');
}

// Партия с пояснением (SPEC 7.13): «DD-L8» → «партия датчиков DD-L8», «PE-L23» → «партия плат PE-L23»
const LOT_KIND = { DD: 'партия датчиков', PE: 'партия плат', K: 'партия заготовок корпуса', KR: 'партия кронштейнов' };
export function lotTitle(id) {
  const m = /^([A-Z]+)-L\d+$/.exec(String(id || ''));
  return m && LOT_KIND[m[1]] ? `${LOT_KIND[m[1]]} ${id}` : String(id || '—');
}

function typeWord(id) {
  const t = typeTitle(id);
  return t && t !== id ? t.toLowerCase() : String(id || '—');
}

function pairTitle(q) {
  const s = supplierTitle(q.supplier_id);
  return `${s[0].toUpperCase()}${s.slice(1)} — ${typeWord(q.item_type_id)}`;
}

function pairView(q) {
  const hist = Array.isArray(q.history) ? q.history : [];
  return h('article', { class: 'sp-pair' }, [
    h('header', { class: 'sp-h' }, [h('b', { title: `${q.supplier_id} × ${q.item_type_id}`, text: pairTitle(q) }), stageBadge(q.stage),
    ]),
    q.basis ? h('p', { class: 'sp-why' }, [h('span', { class: 'muted', text: 'Почему: ' }), clean(splitBasis(q.basis).text)]) : null,
    h('p', { class: 'sp-next' }, [h('span', { class: 'muted', text: 'Когда переключится: ' }), switchText(q)]),
    hist.length ? h('details', { class: 'ld-more' }, [h('summary', { text: `История партий: ${hist.length}` }),
      table(['Партия', 'Исход', 'Запись', 'Откуда'], hist.map((x) => h('tr', { class: x.outcome === 'rejected' ? 'tone-serious sp-bad' : '' }, [
        h('td', { text: lotTitle(x.lot_id) }), h('td', { text: LOT_OUTCOMES[x.outcome] || x.outcome || '—' }),
        h('td', { class: 'num', text: Number.isFinite(x.seq) ? `№ ${x.seq}` : '—' }), h('td', { class: 'muted', title: x.source || '', text: LOT_SOURCES[x.source] || (x.source ? 'другое' : '') }),
      ])))]) : null,
    q.rules_version ? h('small', { class: 'muted', text: `Правила технолога, версия ${String(q.rules_version).replace(/^[^0-9]*/, '') || q.rules_version} — настройка, не норма.` }) : null,
    h('details', { class: 'ld-more' }, [h('summary', { text: 'Основание' }),
      h('p', { class: 'ld-r', text: `Правила переключения — config/incoming.yaml${q.rules_version ? ` (${q.rules_version})` : ''}; ступень с записи журнала № ${q.since_seq ?? '—'}.` }),
      q.basis ? h('p', { class: 'ld-r', text: String(q.basis) }) : null]),
  ]);
}

function lotRow(x) {
  if (x.error) return h('tr', {}, [h('td', { text: x.lot }), h('td', { colspan: '5' }, failBox(x.error, 'требование к партии'))]);
  const l = x.lot_view;
  const bad = l.mismatch || weaker(l.declared_verification, l.required_stage);
  return h('tr', { class: bad ? 'tone-serious sp-bad' : '' }, [
    h('th', { scope: 'row', text: lotTitle(l.lot_id) }),
    h('td', { title: `${l.supplier_id || ''} ${l.item_type_id || ''}`, text: `${supplierTitle(l.supplier_id)} — ${typeWord(l.item_type_id)}` }),
    h('td', {}, stageBadge(l.required_stage)),
    h('td', {}, l.declared_verification ? stageBadge(l.declared_verification) : h('span', { class: 'muted', text: 'не передана' })),
    h('td', {}, bad ? [h('span', { class: 'zic', 'aria-hidden': 'true', text: '!' }), ' заявлено слабее требуемого'] : h('span', { class: 'muted', text: 'нет' })),
    h('td', { class: 'muted', title: l.basis || '', text: clean(splitBasis(l.basis || '').text) }),
  ]);
}

function warningsView(app) {
  const list = activeWarnings(app.state).filter((w) => w.code === WEAKER);
  if (!list.length) return h('p', { class: 'muted', text: 'Сейчас нет партий, у которых входной контроль слабее требуемого.' });
  return h('ul', { class: 'wlist' }, list.map((w) => {
    const m = levelMeta(w.level);
    return h('li', { class: `tone-${m.tone}` }, [h('span', { class: 'lvl' }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: m.icon }), m.label]),
      ` ${clean(w.title)} `, w.item_id ? itemLink(app, w.item_id) : null]);
  }));
}

export function mountSuppliers(root, app) {
  const note = h('div');
  const warnBox = h('div');
  const pairBox = h('div', {}, loading());
  const lotBox = h('div', {}, loading());
  root.append(h('section', { class: 'mo-page' }, [
    h('header', { class: 'mo-head' }, [h('a', { class: 'back', href: '#/line', text: '← Линия' }), h('h1', { text: 'Входной контроль' }),
      h('p', { class: 'muted', text: 'Какую ступень контроля ждёт следующая партия и почему.' })]),
    note,
    panel('Входной контроль партии слабее требуемого', warnBox),
    panel('Ступени по парам', pairBox),
    panel('Партии: требование на момент регистрации', lotBox),
  ]));
  recordNote(app, note);
  let token = 0;
  async function load() {
    const my = ++token;
    clear(warnBox).append(warningsView(app));
    clear(pairBox).append(loading());
    clear(lotBox).append(loading());
    let pairs = [];
    try {
      pairs = await app.api.suppliers();
      if (my !== token) return;
      clear(pairBox).append(...(pairs.length ? pairs.map(pairView) : [h('p', { class: 'muted', text: 'Партий в журнале нет.' })]));
    } catch (e) {
      if (my !== token) return;
      clear(pairBox).append(failBox(e, 'ступень входного контроля'));
      clear(lotBox).append(h('p', { class: 'muted', text: 'Партии берутся из истории пар — пар нет.' }));
      return;
    }
    const lots = [...new Set(pairs.flatMap((q) => (q.history || []).map((x) => x.lot_id)).filter(Boolean))].sort().slice(0, LOTS_MAX);
    const rows = [];
    for (const lot of lots) {
      try {
        rows.push({ lot, lot_view: await app.api.lotIncoming(lot) });
      } catch (e) {
        rows.push({ lot, error: e });
      }
    }
    if (my !== token) return;
    clear(lotBox).append(rows.length ? table(['Партия', 'Поставщик и изделие', 'Требуется', 'Заявлено', 'Расхождение', 'Основание'], rows.map(lotRow))
      : h('p', { class: 'muted', text: 'Партий нет.' }));
  }
  if (!app.api.suppliers) clear(pairBox).append(failBox({ status: 404, body: { detail: 'Not Found' } }, 'ступень входного контроля'));
  else load();
  document.title = 'Входной контроль — ТехДело';
  return {
    roleChanged: load,
    update(ch) {
      if (ch.warnings || ch.reset) clear(warnBox).append(warningsView(app));
    },
    destroy() { token += 1; },
  };
}
