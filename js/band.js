// Полоса допуска одной характеристики: поле от нижней до верхней границы оттенками серого (ближе к границе —
// темнее), штрих номинала, заштрихованная погрешность у границ, маркер значения. Цвет — только у маркера вне
// нормы. Запас — в % и в единицах характеристики; основание (Margin.basis — норма из DOMAIN §12) — в подсказке.
// И строка качественной проверки: уверенность анализатора против порога, качество снимка.

import { h, zoneBadge } from './dom.js';
import {
  DEFAULT_THRESHOLDS, digitsOf, fmtNum, isAbnormal, isNum, METHODS, RESULTS, ZONES, zoneKey,
} from './format.js';
import { bandLabels, bandLayout, labelRows } from './geometry.js';
import { marginLine, unitTitle } from './margin.js';
import { conformityText } from './words.js';

function spec(m, d) {
  const u = m.unit ? ` ${unitTitle(m.unit)}` : '';
  if (isNum(m.lower_limit) && isNum(m.upper_limit)) return `допуск ${fmtNum(m.lower_limit, d)}…${fmtNum(m.upper_limit, d)}${u}`;
  if (isNum(m.lower_limit)) return `не меньше ${fmtNum(m.lower_limit, d)}${u}`;
  if (isNum(m.upper_limit)) return `не больше ${fmtNum(m.upper_limit, d)}${u}`;
  return 'границы не переданы';
}

export function toleranceBand(m, thresholds, extra = null) {
  const z = zoneKey(m.zone);
  const odd = isAbnormal(z);
  const d = Math.min(4, digitsOf(m.lower_limit, m.upper_limit, m.nominal));
  const dv = Math.min(4, Math.max(d, digitsOf(m.value)));
  const lay = bandLayout(m, thresholds);
  const bar = h('div', { class: `tb-bar tb-${lay.kind}`, role: 'img' });
  for (const sgm of lay.segments) {
    bar.append(h('span', { class: `tb-seg tb-${sgm.zone}`, style: { left: `${sgm.from}%`, width: `${sgm.to - sgm.from}%` } }));
  }
  for (const g of lay.guards) {
    bar.append(h('span', { class: 'tb-guard', title: 'зона погрешности у границы',
      style: { left: `${g.from}%`, width: `${Math.max(0.6, g.to - g.from)}%` } }));
  }
  // подписи шкалы: границы главнее номинала; близкие — во второй ряд, совсем тесно — только в подсказке (К35);
  // номинал совпал с границей — одна подпись «20,000 — нижняя и номинал» (К39)
  const SIDE = { lower: ['нижн.', 'нижняя', 'нижняя граница допуска'], upper: ['верхн.', 'верхняя', 'верхняя граница допуска'] };
  const labs = bandLabels(lay.limits, lay.nominal, m.nominal).map((l) => (l.side === 'nom'
    ? { at: l.at, prio: 1, cls: 'tb-lab-nom', title: 'номинал', text: `ном. ${fmtNum(m.nominal, d)}` }
    : { at: l.at, prio: 0, cls: `tb-lab-${l.side}`, title: `${SIDE[l.side][2]}${l.nominal ? ' и номинал' : ''}`,
      text: l.nominal ? `${fmtNum(l.value, d)} — ${SIDE[l.side][1]} и номинал` : `${SIDE[l.side][0]} ${fmtNum(l.value, d)}` }));
  for (const l of lay.limits) bar.append(h('span', { class: 'tb-limit', style: { left: `${l.at}%` } }));
  if (lay.nominal !== null) bar.append(h('span', { class: 'tb-nom', style: { left: `${lay.nominal}%` } }));
  const rows = labelRows(labs);
  const scale = h('div', { class: `tb-scale${rows.includes(1) ? ' tb-scale-2' : ''}`,
    title: labs.filter((l, i) => rows[i] < 0).map((l) => l.text).join(', ') || null });
  labs.forEach((l, i) => {
    if (rows[i] >= 0) scale.append(h('span', { class: `tb-lab ${l.cls}${rows[i] ? ' tb-lab-r2' : ''}`, style: { left: `${l.at}%` }, title: l.title, text: l.text }));
  });
  if (lay.marker) {
    const arrow = lay.marker.overflow === 'below' ? '◀ ' : lay.marker.overflow === 'above' ? ' ▶' : '';
    const val = `${lay.marker.overflow === 'below' ? arrow : ''}${fmtNum(m.value, dv)}${m.unit ? ` ${unitTitle(m.unit)}` : ''}`
      + `${lay.marker.overflow === 'above' ? arrow : ''}`;
    bar.append(h('span', { class: `tb-marker${odd ? ` z-${z} tb-marker-odd` : ''}`, style: { left: `${lay.marker.at}%` } },
      [h('span', { class: 'tb-val', text: val })]));
  }
  const line = marginLine(m);
  const conformity = conformityText(m); // DOMAIN §17.1: вероятность соответствия, JCGM 106 — зарубежная практика
  const guard = isNum(m.guard_band_pct) ? `погрешность ${fmtNum(m.guard_band_pct, 0)} % поля` : '';
  const basis = [m.basis, m.instrument_id ? `средство измерения ${m.instrument_id}` : '', guard].filter(Boolean).join('\n');
  bar.setAttribute('aria-label', `${m.title || m.characteristic_id}: значение ${fmtNum(m.value, dv)}, ${spec(m, d)}, ${line}, ${ZONES[z].label}`);
  bar.title = basis;
  return h('div', { class: `tb${odd ? ` z-${z} tb-odd` : ''}` }, [
    h('div', { class: 'tb-head' }, [
      h('span', { class: 'tb-title', text: m.title || m.characteristic_id }),
      m.key_characteristic ? h('span', { class: 'tb-key', title: 'ключевая характеристика по маршруту', text: 'ключевая' }) : null,
      h('span', { class: 'tb-spec', text: spec(m, d) }),
      basis ? h('span', { class: 'tb-basis', tabindex: '0', title: basis, 'aria-label': `основание: ${basis}`, text: 'основание' }) : null,
      h('span', { class: 'tb-margin', text: line }),
      conformity ? h('span', { class: 'tb-p', title: m.p_basis || '', text: conformity }) : null,
      odd ? zoneBadge(z) : null,
    ]),
    bar,
    scale,
    extra,
  ]);
}

// Качественная проверка: исход, уверенность анализатора против порога, качество снимка
export function qualitative(check, thresholds) {
  const thr = isNum(thresholds?.confidence_signs) ? thresholds.confidence_signs : DEFAULT_THRESHOLDS.confidence_signs;
  const signs = check.inspection_result === 'defect_signs_detected';
  const parts = [
    h('span', { class: 'q-method', text: METHODS[check.inspection_method] || check.inspection_method || 'проверка' }),
    h('span', { class: `q-result${signs || check.inspection_result === 'assessment_impossible' ? ' q-odd' : ''}`,
      text: RESULTS[check.inspection_result] || check.inspection_result || '' }),
  ];
  if (isNum(check.confidence)) {
    const c = Math.max(0, Math.min(1, check.confidence));
    parts.push(h('span', { class: 'q-meter-wrap' }, [
      h('span', { class: `q-meter${signs && c < thr ? ' low' : ''}`, role: 'img',
        'aria-label': `уверенность ${fmtNum(c, 2)}, порог ${fmtNum(thr, 2)}` }, [
        h('span', { class: 'q-fill', style: { width: `${c * 100}%` } }),
        h('span', { class: 'q-thr', style: { left: `${thr * 100}%` }, title: `порог ${fmtNum(thr, 2)}` }),
      ]),
      h('span', { class: 'q-num', text: `уверенность ${fmtNum(c, 2)}, порог ${fmtNum(thr, 2)}` }),
    ]));
  }
  if (isNum(check.observation_quality)) {
    parts.push(h('span', { class: 'q-num', text: `качество наблюдения ${fmtNum(check.observation_quality, 2)}` }));
  }
  if (check.reliable === false) parts.push(h('span', { class: 'q-warn', text: '? наблюдение ненадёжно' }));
  return h('div', { class: 'qual' }, parts);
}
