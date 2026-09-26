// Форматирование и словари интерфейса — чистые функции, без DOM (проверяются node --test).

export const ZONES = {
  with_margin: { label: 'с запасом', icon: '✓' },
  margin_reduced: { label: 'запас снижен', icon: '◐' },
  near_limit: { label: 'у границы', icon: '!' },
  beyond_limit: { label: 'признаки несоответствия', icon: '✕' },
  not_assessable: { label: 'оценка невозможна', icon: '?' },
  not_checked: { label: 'не проверено', icon: '○' },
};
export const ZONE_KEYS = Object.keys(ZONES);
// от худшей к лучшей (DOMAIN §11.2). not_checked — только пропущенная обязательная точка (деталь ушла дальше
// без результата); точки впереди (pending) в сравнение не передаются
export const WORST_ORDER = ['beyond_limit', 'not_assessable', 'not_checked', 'near_limit', 'margin_reduced', 'with_margin'];
// Отклонение — всё, кроме нормы и «ещё не проверено»: только его экран раскрашивает (ISA-101)
export const ABNORMAL = new Set(['margin_reduced', 'near_limit', 'beyond_limit', 'not_assessable']);
// quality_min — порог качества наблюдения (config/rules.yaml, observation.quality_min): ниже — «оценка невозможна»
export const DEFAULT_THRESHOLDS = { with_margin_pct: 50, reduced_pct: 25, confidence_signs: 0.8, quality_min: 0.7 };

export function zoneKey(z) {
  return Object.prototype.hasOwnProperty.call(ZONES, z) ? z : 'not_checked';
}

export function zoneMeta(z) {
  return ZONES[zoneKey(z)];
}

export function isAbnormal(z) {
  return ABNORMAL.has(z);
}

export function worstZone(zones) {
  let best = -1;
  for (const z of zones || []) {
    const i = WORST_ORDER.indexOf(z);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best < 0 ? 'not_checked' : WORST_ORDER[best];
}

export const LEVELS = {
  stop: { label: 'Стоп', rank: 0, tone: 'critical', icon: '✕' },
  warning: { label: 'Внимание', rank: 1, tone: 'serious', icon: '!' },
  info: { label: 'К сведению', rank: 2, tone: 'none', icon: 'i' },
};

export function levelMeta(level) {
  return LEVELS[level] || { label: String(level || 'к сведению'), rank: 3, tone: 'none', icon: 'i' };
}

export const EVENT_TYPES = {
  'item.registered': 'регистрация',
  'operation.started': 'начало операции',
  'operation.finished': 'конец операции',
  'operation.paused': 'пауза',
  'operation.resumed': 'возобновление',
  'operation.transferred': 'перемещение',
  'inspection.result': 'контроль',
  'equipment.state': 'станок',
  'operator.action': 'действие',
  'assembly.linked': 'сборка',
  'decision.recorded': 'решение',
  'job.received': 'задание',
  'reference.updated': 'справочник',
  'complaint.received': 'рекламация',
  'external.receipt': 'квитанция',
};

export const CHAIN_CODES = {
  OK: 'цепочка цела',
  CHAIN_BROKEN: 'цепочка нарушена',
  TAMPERED: 'запись изменена',
  SIGNATURE_INVALID: 'подпись не сходится',
  TRUNCATED: 'цепочка обрезана',
  FORKED: 'цепочка раздвоена',
};

export const DOC_KINDS = {
  passport: 'паспорт', logbook: 'формуляр', certificate: 'сертификат', specification: 'технические условия',
  test_report: 'протокол испытаний',
};

export const METHODS = {
  visual: 'визуальный контроль', measurement: 'измерительный контроль', functional: 'функциональный контроль',
  ndt: 'неразрушающий контроль', other: 'иной метод',
};

export const RESULTS = {
  no_defect_signs: 'признаков нет', defect_signs_detected: 'есть признаки дефекта',
  assessment_impossible: 'оценка невозможна',
};

const LINE_RU = { L: 'Л' };

export function lineTitle(id) {
  if (!id) return 'линия';
  const m = /^([A-Z]+)-(\d+)$/.exec(String(id));
  return m ? `${LINE_RU[m[1]] || m[1]}-${m[2]}` : String(id);
}

const NUMS = new Map();
function nf(digits) {
  if (!NUMS.has(digits)) {
    NUMS.set(digits, new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return NUMS.get(digits);
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// «12,0061» — десятичная запятая, минус — настоящий минус
export function fmtNum(v, digits = 0) {
  if (!isNum(v)) return '—';
  return nf(digits).format(v).replace('-', '−').replace(/ /g, ' ');
}

export function fmtPct(v, digits = 0) {
  return isNum(v) ? `${fmtNum(v, digits)} %` : '—';
}

// точность значения — по точности границ и номинала
export function digitsOf(...vals) {
  let d = 0;
  for (const v of vals) {
    if (!isNum(v)) continue;
    const s = String(v);
    const i = s.indexOf('.');
    if (i >= 0) d = Math.max(d, Math.min(4, s.length - i - 1));
  }
  return d;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function parseTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function fmtTime(iso) {
  const d = parseTime(iso);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '';
}

export function fmtDateTime(iso) {
  const d = parseTime(iso);
  if (!d) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${fmtTime(iso)}`;
}

export function shortHash(h, head = 8, tail = 4) {
  if (!h) return '—';
  const s = String(h);
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// Номер детали: «BD-01-0107», у живого стенда с повтором сюжета — с меткой прогона и круга
// «BD-01-0107-R9017b42b-C2» (эмулятор, Codex X22.1). Метка прогона на экранах не нужна, круг — только со второго.
// Так же помечены составные части («DD-01-0115-R9017b42b-C1»).
export const ITEM_ID = /(?:BD|БД)-(\d{2})-(\d{4})(?:-R([0-9A-Za-z]+)-C(\d+))?/;
export const ITEM_ID_G = new RegExp(ITEM_ID.source, 'g');
const ANY_ID = /^([A-ZА-Я]{1,3})-(\d{2})-(\d{4})(?:-R[0-9A-Za-z]+-C(\d+))?$/;
// метка прогона у любого обозначения: деталь, составная часть, операция («RUN-0135-ASSY-R2f78aaab-C1»)
const RUN_G = /([0-9A-Za-zА-Яа-я])-R[0-9a-f]{8}-C(\d+)(?![0-9A-Za-z])/g;

// Круг сюжета — только в «Вся смена» (SPEC 7.13, QA В-40): на экранах текущего круга (К37, app.lapFilter) пометка
// «(круг N)» у каждой строки — шум. Без табло (node --test, отчёты) — как раньше
const lapLabels = () => {
  const app = globalThis.texdelo;
  return !app || app.lapFilter === 'all';
};
const cycleText = (c) => (Number(c) > 1 && lapLabels() ? ` (круг ${Number(c)})` : '');

// «БД-01-0107» → «0107»: номер на фишке детали (и у «BD-01-0107-R9017b42b-C1» — тоже «0107»);
// составная часть — с обозначением: «DD-0115»
export function shortItem(id) {
  const s = String(id || '');
  const m = ANY_ID.exec(s);
  if (m) return /^(?:BD|БД)$/.test(m[1]) ? m[3] : `${m[1]}-${m[3]}`;
  const d = /(\d+)$/.exec(s.replace(/-R[0-9A-Za-z]+-C\d+$/, ''));
  return d ? d[1] : s || '?';
}

// «BD-01-0107» из данных ядра показываем по-русски, как в цеху; метку прогона эмулятора — нет, круг — со второго
export function itemTitle(id) {
  const s = String(id || '');
  const m = ANY_ID.exec(s);
  if (!m) return s.replace(/^BD-/, 'БД-');
  const head = /^(?:BD|БД)$/.test(m[1]) ? 'БД' : m[1];
  return `${head}-${m[2]}-${m[3]}${cycleText(m[4])}`;
}

// Номера в тексте ядра — так же, как на метках: «BD-01-0101-R9017b42b-C1» → «БД-01-0101»
export function itemsInText(text) {
  return String(text ?? '').replace(RUN_G, (x, base, c) => `${base}${cycleText(c)}`).replace(/(?<![A-Za-z])BD-(\d{2}-\d{4})/g, 'БД-$1');
}

// Поиск детали по номеру на посту ОТК: «0101», «БД-01-0101», полный номер. Среди деталей с тем же номером
// (повтор сюжета по кругу) — последний круг. Не нашлось — номер как есть (ядро ответит 404, экран так и скажет).
export function findItemId(query, ids) {
  const q = String(query || '').trim().toUpperCase().replace(/^БД-/, 'BD-');
  if (!q) return '';
  const all = [...(ids || [])].map(String);
  const exact = all.find((x) => x.toUpperCase() === q);
  if (exact) return exact;
  const digits = /^\d{1,4}$/.test(q) ? q.padStart(4, '0') : null;
  const hits = all.filter((x) => (digits ? shortItem(x) === digits && ITEM_ID.test(x) : x.toUpperCase().startsWith(q)));
  const cycleOf = (x) => Number(ITEM_ID.exec(x)?.[4]) || 0;
  if (hits.length) return hits.reduce((a, b) => (cycleOf(b) >= cycleOf(a) ? b : a));
  return digits ? `BD-01-${digits}` : q;
}

// Карточка «NC-3838c614-8901-4b8e-…» → «NC-3838c614»: UUID целиком на экране не читается
export function cardTitle(id) {
  const s = String(id || '');
  const m = /^([A-ZА-Я]+-[0-9a-f]{8})-[0-9a-f]{4}-/i.exec(s);
  return m ? m[1] : s;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function coverageText(cov) {
  if (!cov || !isNum(cov.required)) return 'покрытие неизвестно';
  return `${cov.reliable ?? 0} из ${cov.required}`;
}

export function statusTitle(item) {
  return item?.status_title || String(item?.status || '').replace(/_/g, ' ');
}

export function marginText(pct) {
  if (!isNum(pct)) return 'числа запаса нет';
  return pct < 0 ? `за границей: ${fmtPct(pct)}` : `запас ${fmtPct(pct)}`;
}

// Мягкие переносы в длинных русских словах: браузер переносит по слогам, а не посреди слога
// («функ-ци-о-ни-ро-ва-ния»), даже если словаря переносов у него нет. Правила упрощённые: гласная-согласная-гласная —
// перенос перед согласной; между гласными 2+ согласных — после первой; й, ь, ъ не отрываются; по краям — не меньше 2 букв.
const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
const STICKY = 'йьъЙЬЪ';

function hyphenateWord(w) {
  const vi = [];
  for (let i = 0; i < w.length; i++) if (VOWELS.includes(w[i])) vi.push(i);
  const cuts = [];
  for (let k = 0; k < vi.length - 1; k++) {
    const a = vi[k];
    const b = vi[k + 1];
    let cut = b - a - 1 >= 2 ? a + 2 : a + 1;
    while (cut < b && STICKY.includes(w[cut])) cut += 1;
    if (cut >= 2 && w.length - cut >= 2 && !cuts.includes(cut)) cuts.push(cut);
  }
  let out = '';
  let from = 0;
  for (const c of cuts) {
    out += `${w.slice(from, c)}\u00ad`;
    from = c;
  }
  return out + w.slice(from);
}

export function softHyphens(text, minLength = 10) {
  return String(text ?? '').replace(/[А-Яа-яЁё]+/g, (w) => (w.length < minLength ? w : hyphenateWord(w)));
}

export const MACHINE = {
  running: 'работа', idle: 'простой', warning: 'предупреждение', stopped: 'остановка', alarm: 'авария',
  setup: 'наладка', repair: 'ремонт', tool_change: 'смена инструмента',
};

// Состояние станка: цвет — только у аварии и остановки (ISA-101); простой, наладка, смена инструмента,
// ремонт — обычная жизнь участка, серым текстом
export function machineTone(ms) {
  if (ms === 'alarm') return 'critical';
  if (ms === 'stopped' || ms === 'warning') return 'serious';
  return '';
}

// Деталь с пропущенной обязательной проверкой (DOMAIN §11.2: хуже «у границы») — красный пунктир на метке,
// в очереди ОТК и в шапке профиля; «не проверено» у новой детали (впереди всё) — серое
export function itemSkipped(it) {
  return !!it && !it.accepted && Number(it.coverage?.skipped) > 0;
}
