// Лестница утечки брака по карточке (DOMAIN §16.2, §17.3; GET /v1/cards/{nc_id}/escape): где обнаружено, какие
// точки дальше по маршруту обнаружили бы без сработавшей проверки, где проявился бы вне завода и во сколько раз
// дороже, точка пропуска по 8D. Коэффициенты внутри завода — оценка команды (config/cost.yaml), диапазоны вне
// завода — ориентир из зарубежной практики; ни то ни другое — не норма, так и написано. Лестница — «что было бы»,
// поэтому она серая; цвет — только у точки пропуска (проверка не сработала на самом деле).

import { clear, h } from './dom.js';
import { clean } from './group.js';
import { cardStatus, cpTitle } from './names.js';
import { splitBasis } from './plain.js';
import { METHOD_TEXTS } from './texts.js';
import { escapeKind, fmtFactor, gateStatus, isOutside, ladderSteps, preventedText } from './words.js';
import { isNum } from './format.js';
import { failBox, loading } from './more_dom.js';

function methods(list) {
  return (list || []).map((m) => METHOD_TEXTS[m] || m).join(', ');
}

function stepRow(s, { detected = false } = {}) {
  const mark = detected ? '●' : s.surface ? '→' : s.would_detect ? '✓' : '○';
  const verdict = detected ? 'обнаружено здесь' : s.surface ? (s.outside ? 'здесь проявился бы' : 'здесь нашли бы')
    : s.outside ? (s.would_detect ? 'проявится' : 'не проявится') : s.would_detect ? 'обнаружила бы' : 'не обнаружила бы';
  const title = s.control_point_id ? cpTitle(s.control_point_id, s.title) : s.title;
  return h('li', { class: `ld-s${detected ? ' ld-det' : ''}${s.surface ? ' ld-surf' : ''}${s.outside ? ' ld-out' : ''}` }, [
    h('span', { class: 'ld-mk', 'aria-hidden': 'true', text: mark }),
    h('div', { class: 'ld-b' }, [
      h('div', { class: 'ld-h' }, [h('b', { text: title, title: s.control_point_id || '' }), h('span', { class: 'ld-v', text: verdict }),
        s.cost ? h('span', { class: 'ld-c', text: s.cost }) : null]),
      s.methods?.length ? h('small', { class: 'muted', text: `методы: ${methods(s.methods)}` }) : null,
      s.reason ? h('p', { class: 'ld-r', text: clean(s.reason) }) : null,
    ]),
  ]);
}

// Точка пропуска: вид, точка, чем и когда; «нужна новая точка контроля» — если способной точки нет
function escapeBlock(l) {
  const ep = l.escape_point;
  if (!ep && !l.escape_note) return null;
  const k = escapeKind(ep?.kind);
  const facts = ep ? [ep.control_point_id ? cpTitle(ep.control_point_id, ep.control_point_id) : '',
    ep.analyzer_version ? `анализатор ${ep.analyzer_version}` : '', ep.instrument_id ? `средство ${ep.instrument_id}` : '',
    Number.isFinite(ep.seq) ? `запись журнала № ${ep.seq}` : ''].filter(Boolean).join(', ') : '';
  return h('div', { class: `ld-esc tone-${ep ? k.tone : 'none'}` }, [
    h('span', { class: 'zic', 'aria-hidden': 'true', text: ep ? k.icon : '?' }),
    h('div', {}, [
      h('b', { text: ep ? `Точка пропуска: ${k.label}` : 'Точка пропуска' }),
      facts ? h('span', { class: 'muted', text: ` — ${facts}` }) : null,
      ep?.reason ? h('p', { class: 'ld-r', text: clean(ep.reason) }) : null,
      l.escape_note ? h('p', { class: 'ld-r', text: clean(l.escape_note) }) : null,
    ]),
  ]);
}

// Лестница целиком; card — карточка (Card), если есть: её шаг-ворота (API v1.6, gate_step)
export function ladderView(l, card = null) {
  // во сколько раз дороже — коротко (×3, ×1,3…6 к заводу); источники оценок — в «Основание и оговорки»
  const steps = ladderSteps(l).map((s) => ({ ...s, cost: shortCost(s) }));
  const det = l.detected_at ? { ...l.detected_at, cost: shortCost(l.detected_at) } : null;
  const prevented = preventedText(l).replace(/\s*\([^)]*\)$/, '');
  const gate = card?.gate_step;
  const gateOpen = !['closed', 'not_confirmed'].includes(card?.status); // закрытая карточка ворота не держит
  return h('div', { class: 'ld' }, [
    h('p', { class: 'ld-sum' }, [
      h('b', { text: l.would_surface_at ? `Без этой проверки: ${clean(l.would_surface_at)}` : 'Где проявился бы — не оценить' }),
      prevented ? h('span', { class: 'ld-c', text: ` — ${prevented}` }) : null,
    ]),
    h('p', { class: 'll-note muted', text: 'Во сколько раз дороже — оценка команды, не норма.' }),
    h('ol', { class: 'ld-list' }, [det ? stepRow(det, { detected: true }) : null, ...steps.map((s) => stepRow(s))]),
    escapeBlock(l),
    gate ? h('p', { class: `ld-gate${gateOpen ? ' ld-gate-open' : ''}` }, [h('b', { text: `Ворота: «${gate.title || gate.step_id}» — ${gateStatus(gateOpen ? 'open' : 'passed').label}. ` }),
      gate.basis ? h('span', { class: 'muted', text: clean(splitBasis(gate.basis).text) }) : null]) : null,
    h('details', { class: 'ld-more' }, [
      h('summary', { text: 'Основание и оговорки' }),
      ...ladderBasis(l).map((a) => h('p', { class: 'ld-r', text: a })),
    ]),
  ]);
}

// ---------- короткая лестница: одна строка этапов (панель карточки, «Что остановили») ----------
const OUTSIDE = /^вне завода:\s*/i;

// Во сколько раз дороже на этапе — коротко: «×3» внутри завода, «×1,3…6» вне завода (подробно — «Как считаем ▸»)
export function shortCost(s) {
  if (!s) return '';
  if (isNum(s.cost_factor)) return `×${fmtFactor(s.cost_factor)}`;
  if (isNum(s.cost_low) && isNum(s.cost_high)) {
    const span = s.cost_low === s.cost_high ? fmtFactor(s.cost_low) : `${fmtFactor(s.cost_low)}…${fmtFactor(s.cost_high)}`;
    return isOutside(s) || OUTSIDE.test(String(s.stage || '')) ? `×${span} к заводу` : `×${span}`;
  }
  return '';
}

function stepTitle(s) {
  const t = s.control_point_id ? cpTitle(s.control_point_id, s.title) : String(s.title || '').replace(OUTSIDE, '');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

// Этапы «где нашли → где нашли бы → где всплыло бы» без проверок, которые этот вид не видят (кроме вне завода)
export function ladderChain(l) {
  if (!l) return [];
  const out = [];
  if (l.detected_at) out.push({ title: stepTitle(l.detected_at), verdict: 'нашли здесь', mark: '✓', cost: shortCost(l.detected_at), detected: true });
  for (const s of ladderSteps(l)) {
    if (!s.would_detect && !s.outside) continue;
    out.push({ title: stepTitle(s), verdict: s.surface ? (s.outside ? 'всплыло бы здесь' : 'нашли бы здесь') : '', mark: s.surface ? '→' : '○',
      cost: shortCost(s), outside: s.outside, surface: s.surface });
  }
  return out;
}

// Основание оценок для «Как считаем ▸»: исходные строки ядра (там источники и файлы настроек — это справка)
export function ladderBasis(l) {
  return [l?.basis, ...(l?.assumptions || [])].filter(Boolean).map((x) => String(x));
}

// Одна строка этапов и главное «во сколько раз дороже»; оговорка — одна на блок
// brief — без оговорки и «Как считаем»: они уже есть на экране один раз
export function ladderLine(l, { brief = false } = {}) {
  const chain = ladderChain(l);
  const prevented = preventedText(l);
  return h('div', { class: 'll' }, [
    chain.length ? h('ol', { class: 'll-chain' }, chain.map((s) => h('li', { class: `ll-s${s.detected ? ' ll-det' : ''}${s.surface ? ' ll-surf' : ''}${s.outside ? ' ll-out' : ''}` }, [
      h('span', { class: 'll-t' }, [h('span', { class: 'll-mk', 'aria-hidden': 'true', text: s.mark }), s.title]),
      s.verdict ? h('span', { class: 'll-v', text: s.verdict }) : null,
      s.cost ? h('span', { class: 'll-c', text: s.cost }) : null,
    ]))) : h('p', { class: 'muted', text: 'Этапов после обнаружения нет.' }),
    l?.would_surface_at || prevented ? h('p', { class: 'll-sum' }, [
      l?.would_surface_at ? h('b', { text: `Без этой проверки: ${clean(l.would_surface_at)}` }) : null,
      prevented ? h('span', { text: `${l?.would_surface_at ? ' — ' : ''}${prevented.replace(/\s*\([^)]*\)$/, '')}` }) : null]) : null,
    brief ? null : h('p', { class: 'll-note muted', text: 'Во сколько раз дороже — оценка команды, не норма.' }),
    brief ? null : howWeCount(ladderBasis(l)),
  ]);
}

// «Как считаем ▸» — все источники оценок одним свёрнутым блоком (SPEC.md 3.8)
export function howWeCount(lines) {
  if (!lines.length) return null;
  return h('details', { class: 'll-how' }, [h('summary', { text: 'Как считаем' }),
    h('ul', {}, lines.map((x) => h('li', { text: x })))]);
}

// Ворота одной строкой для панели карточки: «Закрытие крышки» нельзя начинать, пока карточка открыта: <почему>;
// ссылки на документы — в основание
export function gateLine(card) {
  const g = card?.gate_step;
  if (!g || !(g.title || g.step_id)) return '';
  const open = !cardStatus(card.status).closed;
  const name = g.title ? `«${g.title}»` : 'следующий шаг';
  // ядро повторяет название шага в основании: «после шага «Закрытие крышки» …» → «после этого шага …»
  const why = g.basis ? clean(splitBasis(g.basis).text).replace(`после шага ${name}`, 'после этого шага') : '';
  if (!open) return `Шаг ${name} можно начинать: карточка закрыта.`;
  // честно: ворота сегодня — «стоп» в момент начала шага, а запрет MES — только по удержанию человеком
  return `Шаг ${name} нельзя начинать, пока карточка открыта${why ? `: ${why}` : ''}`.replace(/\.$/, '')
    + '. Если начнут — система поднимет «стоп» мастеру и ОТК; чтобы MES не пустил деталь, удержите её.';
}

// Короткая лестница по карточке: грузит лестницу, отказ ядра — строкой с кодом ответа
export function ladderLineBlock(app, nc, opts = {}) {
  const box = h('div', { class: 'll-box' }, loading('Считаю, где бы это всплыло…'));
  if (typeof app.api?.escapeLadder !== 'function') {
    clear(box).append(h('p', { class: 'muted', text: 'Лестницу утечки ядро не отдаёт.' }));
    return box;
  }
  app.api.escapeLadder(nc).then((l) => clear(box).append(ladderLine(l, opts)))
    .catch((e) => clear(box).append(failBox(e, 'лестница утечки')));
  return box;
}

// Блок «Лестница утечки» по карточке: грузит лестницу (и карточку — ради ворот), показывает отказ ядра с кодом
export function ladderBlock(app, nc, { card = null } = {}) {
  const box = h('div', { class: 'ld-box' }, loading('Считаю лестницу утечки…'));
  const getCard = card ? Promise.resolve(card) : (app.api.coreCard || app.api.card)?.(nc)?.catch(() => null);
  Promise.all([app.api.escapeLadder(nc), getCard || null]).then(([l, c]) => {
    clear(box).append(ladderView(l, c));
  }).catch((e) => {
    clear(box).append(failBox(e, 'лестница утечки'));
  });
  return box;
}
