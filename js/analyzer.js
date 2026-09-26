// «Что увидел анализатор» (DOMAIN §13.3–13.4): наблюдение из карточки несоответствия (Card.signal, API v1.4) —
// пара изображений «эталон | с признаками» и ступени анализатора-ансамбля: детектор отклонения, классификатор вида
// с альтернативами, измерение размера с пределом по норме, качество наблюдения. Анализатор — внешний: экран
// показывает, что пришло, и не достраивает того, чего источник не сообщил. Без DOM — проверяется node --test.

import { DEFAULT_THRESHOLDS, fmtNum, isNum } from './format.js';
import { DEFECT_TEXTS, EVIDENCE_TEXTS, STAGE_TEXTS } from './texts.js';

export const STAGE_ORDER = ['detector', 'classifier', 'measurement', 'quality'];

const defectTitle = (d) => d?.title || DEFECT_TEXTS[d?.defect_type] || d?.defect_type || '';
const prob = (p) => (isNum(p) ? fmtNum(p, 2) : '—');

// Пара изображений: эталон слева, снимок с признаками (разметка анализатора, иначе снимок) справа
export function evidencePair(refs) {
  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && r.evidence_id && r.url);
  const reference = list.find((r) => r.kind === 'reference') || null;
  const shown = list.find((r) => r.kind === 'overlay') || list.find((r) => r.kind === 'observed')
    || list.find((r) => r !== reference) || null;
  const pair = [reference, shown].filter(Boolean);
  const extra = list.filter((r) => !pair.includes(r));
  const checked = pair.filter((r) => typeof r.verified === 'boolean');
  return {
    reference, shown, extra, empty: !pair.length,
    synthetic: pair.some((r) => r.synthetic === true),
    // подпись файла: проверена, если все показанные сошлись с отпечатком; не сходится — если хоть один нет
    verified: checked.some((r) => r.verified === false) ? false : checked.length && checked.length === pair.length ? true : null,
  };
}

export function evidenceCaption(ref) {
  if (!ref) return '';
  return ref.title || EVIDENCE_TEXTS[ref.kind] || 'изображение';
}

// Измерение этого несовершенства в том же наблюдении: характеристика с кодом несовершенства
// («KR01-WELD-5011» — глубина подреза 5011) или с его названием; катет шва пределом подреза не служит
export function defectMargin(defect, measurements) {
  const code = defect?.code || defect?.iso6520_code || '';
  const title = String(defect?.title || DEFECT_TEXTS[defect?.defect_type] || '').toLowerCase();
  return (Array.isArray(measurements) ? measurements : []).find((x) => isNum(x?.upper_limit) && (
    (code && String(x.characteristic_id || '').includes(code)) || (title && String(x.title || '').toLowerCase().includes(title)))) || null;
}

// Размер несовершенства и предел по норме: из измерения того же несовершенства (Margin — граница и основание),
// иначе — только размер и основание из вида дефекта
export function sizeVsLimit(defect, measurements) {
  if (!defect || !isNum(defect.size)) return null;
  const unit = defect.unit === 'mm' ? 'мм' : defect.unit || '';
  const m = defectMargin(defect, measurements);
  const out = { size: defect.size, unit, text: `${fmtNum(defect.size, 2)} ${unit}`.trim(), limit: null, over: null,
    basis: defect.basis || m?.basis || '', zone: defect.zone || m?.zone || null };
  if (m) {
    out.limit = m.upper_limit;
    out.over = defect.size > m.upper_limit;
    out.limitText = `предел ${fmtNum(m.upper_limit, 2)} ${unit}`.trim();
  }
  return out;
}

function stageInfo(obs, stage) {
  return (obs?.analyzer_stages || []).find((s) => s?.stage === stage) || null;
}

const CLOSED = new Set(['closed', 'not_confirmed']);

// Карточка закрыта (сигнал не подтверждён, решение исполнено) — ступени без цвета тревоги (ISA-101): цвет только
// у того, что ещё требует действия
export function cardClosed(card) {
  return CLOSED.has(card?.status);
}

// Ступени для экрана: что сообщил источник по каждой; ступень без данных не выдумывается. Несовершенств в одном
// наблюдении может быть несколько (трещина и подрез): классификатор и измерение — по каждому.
// opts.closed — карточка закрыта: факты те же, цвет тревоги снят
export function analyzerStages(obs, thresholds = {}, opts = {}) {
  if (!obs || typeof obs !== 'object') return [];
  const conf = isNum(thresholds.confidence_signs) ? thresholds.confidence_signs : DEFAULT_THRESHOLDS.confidence_signs;
  const qmin = isNum(thresholds.quality_min) ? thresholds.quality_min : DEFAULT_THRESHOLDS.quality_min;
  const defects = (obs.defects || []).filter(Boolean);
  const d = defects[0] || null;
  const many = defects.length > 1;
  const reported = new Set((obs.analyzer_stages || []).map((s) => s?.stage));
  const rows = [];
  const tone = (t) => (opts.closed ? '' : t);
  const push = (stage, facts, extra = {}) => {
    const info = stageInfo(obs, stage);
    rows.push({ stage, title: STAGE_TEXTS[stage] || stage, version: info?.model_version || '', summary: info?.summary || '',
      facts: facts.map((f) => ({ ...f, tone: tone(f.tone || '') })), ...extra });
  };
  const withDet = defects.find((x) => isNum(x.detector_confidence));
  const detConf = withDet ? withDet.detector_confidence : isNum(obs.confidence) ? obs.confidence : null;
  if (reported.has('detector') || d || obs.inspection_result) {
    const found = obs.inspection_result === 'defect_signs_detected' || !!d;
    const low = found && isNum(detConf) && detConf < conf;
    push('detector', [
      { label: 'отклонение от нормы', value: obs.inspection_result === 'assessment_impossible' ? 'оценить нельзя' : found ? 'есть' : 'нет',
        tone: found ? 'critical' : '' },
      { label: 'уверенность', value: prob(detConf), tone: low ? 'serious' : '',
        note: low ? `ниже порога ${fmtNum(conf, 2)} — нужен инженер ОТК` : '' },
    ]);
  }
  // классификатор: по каждому несовершенству — вид с кодом и альтернативы полосками
  const groups = defects.filter((x) => isNum(x.class_confidence) || (x.alternatives || []).length).map((x) => {
    const alts = (x.alternatives || []).filter((a) => a && isNum(a.probability))
      .map((a) => ({ title: a.title || DEFECT_TEXTS[a.defect_type] || a.defect_type, p: a.probability, main: false }))
      .sort((a, b) => b.p - a.p);
    return { title: defectTitle(x), note: x.code ? `код ${x.code} по ГОСТ Р ИСО 6520-1-2012` : '',
      bars: [{ title: defectTitle(x), p: isNum(x.class_confidence) ? x.class_confidence : null, main: true }, ...alts] };
  });
  if (reported.has('classifier') || groups.length) {
    const facts = groups.length ? groups.map((g) => ({ label: 'вид', value: g.title, note: g.note })) : [{ label: 'вид', value: '—' }];
    push('classifier', facts, { groups, bars: groups.length === 1 ? groups[0].bars : [] });
  }
  // измерение: размер каждого измеренного несовершенства и предел по его же характеристике
  const sized = defects.map((x) => ({ x, size: sizeVsLimit(x, obs.measurements) })).filter((r) => r.size);
  if (reported.has('measurement') || sized.length) {
    const facts = [];
    for (const { x, size } of sized) {
      facts.push({ label: many ? `${defectTitle(x)}, размер` : 'размер', value: size.text, tone: size.over ? 'critical' : '' });
      if (size.limitText) facts.push({ label: 'по норме', value: size.limitText, tone: size.over ? 'critical' : '', note: size.over ? 'за пределом' : 'в пределе' });
      if (size.basis) facts.push({ label: 'основание', value: size.basis, plain: true });
    }
    if (!facts.length) facts.push({ label: 'размер', value: 'не измерен' });
    push('measurement', facts);
  }
  if (reported.has('quality') || isNum(obs.observation_quality) || typeof obs.reliable === 'boolean') {
    const q = isNum(obs.observation_quality) ? obs.observation_quality : null;
    const poor = q !== null && q < qmin;
    push('quality', [
      { label: 'качество снимка', value: q === null ? 'не передано' : prob(q), tone: poor ? 'serious' : '',
        note: q === null ? '' : poor ? `ниже порога ${fmtNum(qmin, 2)} — оценка невозможна` : `порог ${fmtNum(qmin, 2)}` },
      { label: 'наблюдение', value: obs.reliable === false ? 'ненадёжно — основанием не служит' : obs.reliable ? 'надёжно' : 'не передано',
        tone: obs.reliable === false ? 'standby' : '' },
    ]);
  }
  const rank = (s) => (STAGE_ORDER.includes(s) ? STAGE_ORDER.indexOf(s) : STAGE_ORDER.length);
  for (const s of obs.analyzer_stages || []) {
    if (s?.stage && !rows.some((r) => r.stage === s.stage)) push(s.stage, []);
  }
  return rows.sort((a, b) => rank(a.stage) - rank(b.stage));
}

// «Что увидели» в панели карточки (SPEC.md 3.6): не больше двух чисел против порогов, словами — уверенность камеры
// и размер несовершенства (или замер вне допуска). Нет данных — строки нет, ничего не достраивается
export function seenFacts(obs, thresholds = {}) {
  if (!obs || typeof obs !== 'object') return [];
  const conf = isNum(thresholds.confidence_signs) ? thresholds.confidence_signs : DEFAULT_THRESHOLDS.confidence_signs;
  const defects = (obs.defects || []).filter(Boolean);
  const out = [];
  // уверенность наблюдения — то число, которое ядро сравнивает с порогом «признаки несоответствия» (0,62 при
  // пороге 0,80 — решает человек); уверенность детектора отклонения — запасной вариант
  const withDet = defects.find((x) => isNum(x.detector_confidence));
  const c = isNum(obs.confidence) ? obs.confidence : withDet ? withDet.detector_confidence : null;
  if (isNum(c) && (defects.length || obs.inspection_result === 'defect_signs_detected')) {
    const low = c < conf;
    out.push({ text: `Уверенность камеры ${fmtNum(c, 2)} — ${low ? `ниже ${fmtNum(conf, 2)}: решает человек` : `не ниже ${fmtNum(conf, 2)}`}`,
      tone: low ? 'serious' : '' });
  }
  const d = defects.find((x) => isNum(x.size));
  const size = d ? sizeVsLimit(d, obs.measurements) : null;
  if (size) {
    const name = defectTitle(d);
    const head = name ? `${name[0].toUpperCase()}${name.slice(1)} ${size.text}` : `Размер ${size.text}`;
    out.push({ text: isNum(size.limit) ? `${head} при пределе ${fmtNum(size.limit, 2)} ${size.unit}`.trim() : head,
      tone: size.over ? 'critical' : '' });
  } else {
    const m = (obs.measurements || []).find((x) => x && isNum(x.value) && ['beyond_limit', 'near_limit'].includes(x.zone));
    if (m) {
      const lim = [isNum(m.lower_limit) ? fmtNum(m.lower_limit, 3) : '', isNum(m.upper_limit) ? fmtNum(m.upper_limit, 3) : '']
        .filter(Boolean).join('…');
      out.push({ text: `${m.title ? `${m.title[0].toUpperCase()}${m.title.slice(1)} ` : 'Замер '}${fmtNum(m.value, 3)} ${m.unit || ''}`.trim()
        + (lim ? ` при допуске ${lim} ${m.unit || ''}`.trimEnd() : ''), tone: m.zone === 'beyond_limit' ? 'critical' : 'serious' });
    }
  }
  return out.slice(0, 2);
}

// Полоса вероятности: ширина в процентах, не больше 100
export function barWidth(p) {
  return isNum(p) ? Math.max(0, Math.min(100, Math.round(p * 100))) : 0;
}
