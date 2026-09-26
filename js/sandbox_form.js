// Машина времени для правил (DOMAIN §16.1, POST /v1/sandbox/replay): поля формы по телу SandboxRequest контракта
// API v1.6, сборка тела запроса с проверкой границ контракта, разбор SandboxReport для экрана. Без DOM — node --test.
// Меняются только настройки технолога; нормы (допуск по чертежу, погрешность и поверка средства измерения, правило решения) — нет.

import { fmtNum, isNum, plural } from './format.js';
import { parseNumber } from './words.js';

// Настройки кандидата: ключ контракта, подпись, границы контракта, шаг, «сейчас» — из порогов линии
export const NUMBER_FIELDS = [
  { key: 'with_margin_pct', label: 'Порог «с запасом», %', min: 0, max: 100, step: 1, group: 'zones' },
  { key: 'reduced_pct', label: 'Порог «у границы», %', min: 0, max: 100, step: 1, group: 'zones' },
  { key: 'confidence_signs', label: 'Уверенность анализатора для «признаки несоответствия»', min: 0, max: 1, step: 0.01, group: 'analyzer' },
  { key: 'quality_min', label: 'Порог надёжности наблюдения', min: 0, max: 1, step: 0.01, group: 'analyzer' },
];

// Детекторы малых сдвигов рядом с критериями Шухарта (DOMAIN §17.6)
export const DETECTOR_FIELDS = [
  { key: 'ewma_lambda', label: 'Сглаженное среднее: вес новой точки', min: 0, minOpen: true, max: 1, step: 0.05 },
  { key: 'ewma_L', label: 'Сглаженное среднее: граница, в σ', min: 0, minOpen: true, step: 0.5 },
  { key: 'cusum_k', label: 'Накопленная сумма: допуск, в σ', min: 0, step: 0.1 },
  { key: 'cusum_h', label: 'Накопленная сумма: порог, в σ', min: 0, minOpen: true, step: 0.5 },
];

// Переключение ступеней входного контроля (DOMAIN §17.5)
export const INCOMING_FIELDS = [
  { key: 'k_full_to_sampling', label: 'Сплошной → выборочный: партий подряд', min: 1, int: true },
  { key: 'm_sampling_to_skip', label: 'Выборочный → пропуск: партий подряд без карточек', min: 1, int: true },
  { key: 'skip_max_lots', label: 'Пропуск: не больше партий', min: 0, int: true },
  { key: 'skip_max_days', label: 'Пропуск: не дольше дней', min: 0, int: true },
];

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

// Значение поля по границам контракта; ошибка — фразой с подписью поля
function number(f, raw, errors) {
  const v = parseNumber(raw);
  if (!isNum(v)) {
    errors.push(`${f.label}: нужно число`);
    return undefined;
  }
  if (f.int && !Number.isInteger(v)) errors.push(`${f.label}: нужно целое число`);
  else if (isNum(f.min) && (f.minOpen ? v <= f.min : v < f.min)) errors.push(`${f.label}: ${f.minOpen ? 'больше' : 'не меньше'} ${fmtNum(f.min, f.step < 1 ? 2 : 0)}`);
  else if (isNum(f.max) && v > f.max) errors.push(`${f.label}: не больше ${fmtNum(f.max, f.step < 1 ? 2 : 0)}`);
  else return v;
  return undefined;
}

// Тело SandboxRequest: только то, что человек поменял. current — действующие пороги (для проверки «у границы» <
// «с запасом», когда меняется один из двух). Ничего не поменяно — прогонять нечего.
export function buildRequest(values = {}, current = {}) {
  const errors = [];
  const body = {};
  const label = String(values.label || '').trim();
  if (label.length > 120) errors.push('Название варианта: не длиннее 120 знаков');
  for (const f of NUMBER_FIELDS) {
    if (!has(values[f.key])) continue;
    const v = number(f, values[f.key], errors);
    if (v !== undefined) body[f.key] = v;
  }
  const hi = body.with_margin_pct ?? current.with_margin_pct;
  const lo = body.reduced_pct ?? current.reduced_pct;
  if (('with_margin_pct' in body || 'reduced_pct' in body) && isNum(hi) && isNum(lo) && lo >= hi) {
    errors.push(`Порог «у границы» (${fmtNum(lo)} %) должен быть меньше порога «с запасом» (${fmtNum(hi)} %)`);
  }
  const limits = [];
  for (const [i, row] of (values.control_limits || []).entries()) {
    const key = String(row?.key || '').trim();
    const cl = has(row?.center_line) ? parseNumber(row.center_line) : undefined;
    const sg = has(row?.sigma) ? parseNumber(row.sigma) : undefined;
    if (!key && cl === undefined && sg === undefined) continue;
    const n = `Контрольная карта, строка ${i + 1}`;
    if (!key) errors.push(`${n}: какая характеристика или параметр станка`);
    if (cl !== undefined && !isNum(cl)) errors.push(`${n}: центральная линия — число`);
    if (sg !== undefined && !(isNum(sg) && sg > 0)) errors.push(`${n}: σ — число больше 0`);
    if (key && cl === undefined && sg === undefined) errors.push(`${n}: задайте центральную линию или σ`);
    const out = { key };
    if (isNum(cl)) out.center_line = cl;
    if (isNum(sg) && sg > 0) out.sigma = sg;
    if (key) limits.push(out);
  }
  if (limits.length) body.control_limits = limits;
  const det = {};
  if (values.ewma) det.ewma = true;
  if (values.cusum) det.cusum = true;
  for (const f of DETECTOR_FIELDS) {
    if (!has(values[f.key])) continue;
    const v = number(f, values[f.key], errors);
    if (v !== undefined) det[f.key] = v;
  }
  if (Object.keys(det).length) body.detectors = det;
  const inc = {};
  for (const f of INCOMING_FIELDS) {
    if (!has(values[f.key])) continue;
    const v = number(f, values[f.key], errors);
    if (v !== undefined) inc[f.key] = v;
  }
  if (Object.keys(inc).length) body.incoming = inc;
  if (has(values.as_of_seq)) {
    const v = number({ label: 'Прогнать историю до записи №', min: 0, int: true }, values.as_of_seq, errors);
    if (v !== undefined) body.as_of_seq = v;
  }
  const settings = Object.keys(body).filter((k) => k !== 'as_of_seq');
  if (!settings.length && !errors.length) errors.push('Ничего не поменяно — прогонять нечего. Задайте хотя бы одну настройку.');
  if (label) body.label = label;
  return { body, errors };
}

// Одинаковое тело — один вариант: ключи по порядку, название варианта не в счёт
export function requestKey(body) {
  const norm = (x) => (Array.isArray(x) ? x.map(norm) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().filter((k) => k !== 'label').map((k) => [k, norm(x[k])])) : x);
  return JSON.stringify(norm(body || {}));
}

// Тело запроса → значения полей формы (вариант из записи демо, повтор прошлого прогона)
export function formValues(body = {}) {
  const v = { label: body.label || '' };
  for (const f of NUMBER_FIELDS) if (isNum(body[f.key])) v[f.key] = String(body[f.key]);
  for (const f of DETECTOR_FIELDS) if (isNum(body.detectors?.[f.key])) v[f.key] = String(body.detectors[f.key]);
  v.ewma = !!body.detectors?.ewma;
  v.cusum = !!body.detectors?.cusum;
  for (const f of INCOMING_FIELDS) if (isNum(body.incoming?.[f.key])) v[f.key] = String(body.incoming[f.key]);
  v.control_limits = (body.control_limits || []).map((r) => ({ key: r.key || '', center_line: isNum(r.center_line) ? String(r.center_line) : '',
    sigma: isNum(r.sigma) ? String(r.sigma) : '' }));
  if (isNum(body.as_of_seq)) v.as_of_seq = String(body.as_of_seq);
  return v;
}

export const DETECTOR_WORDS = { shewhart: 'критерии Шухарта', ewma: 'сглаженное среднее', cusum: 'накопленная сумма' };

// Сдвиг первого предупреждения: «на 6 деталей раньше», «на 2 детали позже», «появилось бы», «исчезло бы»
export function leadText(lead) {
  const b = lead?.baseline_first_seq;
  const c = lead?.candidate_first_seq;
  const n = Number(lead?.items_earlier);
  const parts = [];
  if (!isNum(b) && isNum(c)) parts.push('по действующим правилам не было — появилось бы');
  else if (isNum(b) && !isNum(c)) parts.push('исчезло бы');
  if (isNum(n) && n !== 0) {
    const k = Math.abs(n);
    parts.push(`на ${k} ${plural(k, 'деталь', 'детали', 'деталей')} ${n > 0 ? 'раньше' : 'позже'}`);
  } else if (isNum(b) && isNum(c)) parts.push('в тот же момент');
  return parts.join(', ');
}

// Отчёт → что показать: итог, предупреждения (появились и исчезли — по времени), сдвиги, изменения зон
export function reportView(rep) {
  const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);
  const added = [...(rep?.warnings_added || [])].sort(bySeq);
  const removed = [...(rep?.warnings_removed || [])].sort(bySeq);
  const leads = [...(rep?.leads || [])].sort((a, b) => Math.abs(Number(b.items_earlier) || 0) - Math.abs(Number(a.items_earlier) || 0));
  const changes = [...(rep?.changes || [])];
  const codes = (list) => {
    const m = new Map();
    for (const w of list) m.set(w.code, (m.get(w.code) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    summary: Array.isArray(rep?.summary) ? rep.summary : [],
    added, removed, leads, changes,
    addedCodes: codes(added), removedCodes: codes(removed),
    zoneChanges: changes.filter((c) => c.what !== 'acceptance'),
    acceptanceChanges: changes.filter((c) => c.what === 'acceptance'),
    events: Number(rep?.events_replayed) || 0,
  };
}
