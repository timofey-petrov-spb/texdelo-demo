// Запас до границы допуска не только в процентах, но и в единицах характеристики (мм, мА, Н·м):
// «запас 41 %, 0,0037 мм до нижней границы». Формулы — DOMAIN §11.1. Без DOM — проверяется node --test.

import { digitsOf, fmtNum, fmtPct, isNum } from './format.js';

// Единицы от ядра латиницей («mm», «N*m») — как на чертеже и в цеху: «мм», «Н·м». Неизвестная — как есть.
export const UNIT_TITLES = {
  mm: 'мм', um: 'мкм', 'µm': 'мкм', 'μm': 'мкм', m: 'м', cm: 'см', deg: '°', '°': '°', rad: 'рад',
  'N*m': 'Н·м', 'N\u00b7m': 'Н·м', 'N.m': 'Н·м', Nm: 'Н·м', N: 'Н', kN: 'кН', MPa: 'МПа', kPa: 'кПа', Pa: 'Па', bar: 'бар',
  A: 'А', mA: 'мА', V: 'В', mV: 'мВ', Ohm: 'Ом', ohm: 'Ом', 'Ω': 'Ом', kOhm: 'кОм', MOhm: 'МОм', Hz: 'Гц', kHz: 'кГц',
  W: 'Вт', g: 'г', kg: 'кг', s: 'с', ms: 'мс', min: 'мин', h: 'ч', degC: '°C', '°C': '°C', K: 'К',
  pct: '%', '%': '%', HRC: 'HRC', dB: 'дБ',
};

export function unitTitle(u) {
  const s = String(u ?? '').trim();
  return Object.prototype.hasOwnProperty.call(UNIT_TITLES, s) ? UNIT_TITLES[s] : s;
}

// Границы характеристики: двусторонний допуск, односторонний с номиналом или без числа запаса.
// span — то, к чему ядро относит запас: половина поля (двусторонний) или расстояние от границы до номинала.
export function limitsOf(m) {
  const L = isNum(m?.lower_limit) ? m.lower_limit : null;
  const U = isNum(m?.upper_limit) ? m.upper_limit : null;
  const N = isNum(m?.nominal) ? m.nominal : null;
  if (L !== null && U !== null && U > L) return { kind: 'two', L, U, N, span: (U - L) / 2 };
  if (L !== null && U === null) return { kind: 'lower', L, U, N, span: N !== null && N > L ? N - L : null };
  if (U !== null && L === null) return { kind: 'upper', L, U, N, span: N !== null && N < U ? U - N : null };
  return { kind: null, L, U, N, span: null };
}

// Сколько знаков после запятой у расстояния: на один больше, чем у границ (до четырёх)
export function distanceDigits(m) {
  return Math.min(4, Math.max(1, digitsOf(m?.lower_limit, m?.upper_limit, m?.nominal) + 1));
}

// Расстояние до ближайшей границы: по значению — точно и с указанием границы; без значения (точка живой
// кривой несёт только запас в %) — из запаса и границ той же характеристики, без указания стороны.
// Отрицательное — за границей. null — числа нет (односторонний без номинала, нет границ).
export function distanceToLimit(m) {
  const lim = limitsOf(m);
  const unit = unitTitle(m?.unit);
  const x = isNum(m?.value) ? m.value : null;
  if (x !== null && lim.kind === 'two') {
    const dl = x - lim.L;
    const du = lim.U - x;
    return dl <= du ? { d: dl, side: 'lower', unit, exact: true } : { d: du, side: 'upper', unit, exact: true };
  }
  if (x !== null && lim.kind === 'lower') return { d: x - lim.L, side: 'lower', unit, exact: true };
  if (x !== null && lim.kind === 'upper') return { d: lim.U - x, side: 'upper', unit, exact: true };
  if (isNum(m?.margin_pct) && lim.span) return { d: (m.margin_pct / 100) * lim.span, side: null, unit, exact: false };
  return null;
}

const SIDE = { lower: 'нижней', upper: 'верхней' };

// «0,0037 мм до нижней границы» / «за верхней границей на 0,0020 мм» / «0,004 мм до границы»
export function distanceText(m) {
  const r = distanceToLimit(m);
  if (!r) return '';
  const num = `${fmtNum(Math.abs(r.d), distanceDigits(m))}${r.unit ? ` ${r.unit}` : ''}`;
  const side = r.side ? `${SIDE[r.side]} ` : '';
  return r.d < 0 ? `за ${side}границей на ${num}` : `${num} до ${side}границы`;
}

// «запас 41 %, 0,0037 мм до нижней границы»; без числа — «числа запаса нет»
export function marginLine(m) {
  if (!isNum(m?.margin_pct)) return 'числа запаса нет';
  const pct = m.margin_pct < 0 ? `за границей, ${fmtPct(m.margin_pct)}` : `запас ${fmtPct(m.margin_pct)}`;
  const dist = distanceText(m);
  return dist ? `${pct}, ${dist}` : pct;
}

// ---------- границы характеристик для живой кривой ----------
// Точка кривой участка (TrendPoint) несёт только запас в %, а границы той же характеристики известны из
// профиля любой детали. Кэш: characteristic_id → {lower_limit, upper_limit, nominal, unit, title}.

// Ключ — characteristic_id; второй ключ «t:<название>» — для ItemSummary, где есть только название характеристики
export function learnLimits(cache, margins) {
  let learned = 0;
  for (const m of margins || []) {
    if (!m?.characteristic_id || cache.has(m.characteristic_id)) continue;
    if (!isNum(m.lower_limit) && !isNum(m.upper_limit)) continue;
    const e = { unit: m.unit || '', title: m.title || m.characteristic_id };
    for (const k of ['lower_limit', 'upper_limit', 'nominal']) if (isNum(m[k])) e[k] = m[k];
    cache.set(m.characteristic_id, e);
    if (m.title && !cache.has(`t:${m.title}`)) cache.set(`t:${m.title}`, e);
    learned += 1;
  }
  return learned;
}

// Наименьший запас детали (ItemSummary: процент и название характеристики) — «запас 41 %, 0,0037 мм до границы»
export function itemMarginLine(it, cache) {
  if (!isNum(it?.min_margin_pct)) return '';
  const lim = it.min_margin_characteristic ? cache?.get(`t:${it.min_margin_characteristic}`) : null;
  return marginLine({ ...(lim || {}), margin_pct: it.min_margin_pct }).replace(/^запас/, 'наименьший запас');
}

export function profileMargins(profile) {
  return (profile?.checks || []).flatMap((c) => c?.margins || []);
}

// Точка кривой как Margin: запас из точки, границы — из кэша; для distanceText / marginLine
export function pointMargin(point, cache) {
  const lim = point?.characteristic_id ? cache?.get(point.characteristic_id) : null;
  return { ...(lim || {}), characteristic_id: point?.characteristic_id, margin_pct: point?.margin_pct, zone: point?.zone };
}
