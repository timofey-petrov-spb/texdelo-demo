// Человеческие названия на экране: карточки — по дефекту и детали («Подрез шва · БД-01-0114», одно имя на всех
// экранах, во всех окнах и у всех ролей; номер ядра — в подсказке), детали — исходным номером без служебной метки
// прогона и круга эмулятора, участки, точки контроля и характеристики — словами из справочника texts.js вместо кодов
// ядра («ST-TURN, линия L-1: K01-BORE-D20» → «Токарный участок, линия Л-1: диаметр отверстия под датчик»).
// Без DOM — проверяется node --test.

import { itemTitle, plural } from './format.js';
import {
  CARD_DEFECT_NAMES, CHAR_TEXTS, CP_TEXTS, DEFECT_TEXTS, INSTRUMENT_TEXTS, PLACE_TEXTS, PLACE_WHERE, ROLE_DATIVE,
} from './texts.js';

// ---------- детали ----------
const RUN = /-R[0-9A-Za-z]+-C(\d+)$/;

// «PE-01-0101-Rc7c9402d-C2» → { base: 'PE-01-0101', cycle: 2 }; круг 1 — обычный, пометки не нужно
export function itemParts(id) {
  const s = String(id ?? '');
  const m = RUN.exec(s);
  const base = itemTitle(m ? s.slice(0, m.index) : s);
  const cycle = m && Number(m[1]) > 1 ? Number(m[1]) : null;
  return { base, cycle, cycleText: cycle ? `круг ${cycle}` : '' };
}

// ---------- участки, точки, характеристики ----------
export function placeTitle(code, fallback = '') {
  return PLACE_TEXTS[code] || fallback || String(code ?? '');
}

export function cpTitle(code, fallback = '') {
  return CP_TEXTS[code] || fallback || String(code ?? '');
}

export function charTitle(code, fallback = '') {
  return CHAR_TEXTS[code] || fallback || String(code ?? '');
}

const CODES = /(?<![\wА-Яа-я-])(ST-[A-Z]+|CP-[A-Z]+|STORE|SHIPPED|ISOLATOR|(?:K|KR|BD|PE|DD)01-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?![\wА-Яа-я-])/g;
const LINE = /(?<![\wА-Яа-я-])L-(\d+)(?![\wА-Яа-я-])/g;
// «на ST-ASSY» — где (на сборочном участке); после глагола движения — куда («ушло на сборочный участок»)
const WHERE = /(?:^|[\s(«"])на\s+$/iu;
const MOTION = /(?:^|[\s(«"])(?:ушл[аои]?|ушёл|уход\S*|переда\S*|направ\S*|отправ\S*|поступ\S*|перемещ\S*|перешл\S*|пошл\S*|пош[её]л|верн\S*|возвра\S*)\s+на\s+$/iu;

function up(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---------- операции, оборудование, задания, типы изделий (SPEC.md 7.10, 7.13; запасной слой — у источника X29/X31) ----------
// Справочники dataset/reference: route.yaml (операции), equipment.yaml, item_types.yaml, operators.yaml
const OPERATIONS = { TURN: 'Токарная обработка корпуса', WELD: 'Сварка кронштейна', ASSY: 'Установка датчика и платы',
  CLOSE: 'Закрытие крышки' };
const EQUIPMENT = { 'LATHE-01': 'токарный станок 1', 'LATHE-02': 'токарный станок 2', 'WELD-01': 'сварочный пост 1',
  'WELD-02': 'сварочный пост 2', 'TORQ-01': 'ключ с регистрацией момента' };
const TYPES = { 'BD-01': 'блок датчиков', 'K-01': 'корпус', 'KR-01': 'кронштейн', 'DD-01': 'датчик давления', 'PE-01': 'плата электроники' };
const TYPES_WHERE = { 'BD-01': 'блоке датчиков', 'K-01': 'корпусе', 'KR-01': 'кронштейне', 'DD-01': 'датчике давления',
  'PE-01': 'плате электроники' };
const SOURCES = { MAIL: 'Почта', ONEC: '1С', 'MES-01': 'MES', 'ONEC-01': '1С' };
const NB = '(?<![\\wА-Яа-я-])';
const NE = '(?![\\wА-Яа-я-])';
const RUN_OP = new RegExp(`${NB}(?:RUN-\\d{4}-|OP-)(TURN|WELD|ASSY|CLOSE)(?:-R[0-9A-Za-z]+-C\\d+)?(?: \\(круг \\d+\\))?${NE}`, 'g');
const EQUIP = new RegExp(`${NB}(LATHE-0\\d|WELD-0\\d|TORQ-01)${NE}`, 'g');
const JOB = new RegExp(`${NB}(?:задание\\s+)?(?:JOB|WO)-\\d+-L-(\\d)(?:-[0-9A-Za-z]+)*(?: \\(круг \\d+\\))?${NE}`, 'g');
const TYPE_COUNT = new RegExp(`${NB}(BD|K|KR|DD|PE)-01 × (\\d+)${NE}`, 'g');
const TYPE = new RegExp(`${NB}(BD|K|KR|DD|PE)-01${NE}(?!-\\d)`, 'g');
const OPERATOR = new RegExp(`${NB}OP-(\\d{2})${NE}`, 'g');
const MAILBOX = /(письм[оа]) в ящик роли ([a-z_]+)/g;
const SOURCE = new RegExp(`${NB}(MAIL|ONEC-01|ONEC|MES-01)(?=:)`, 'g');

// Источники записей (SPEC 7.10) — в родительном падеже для «журнал …», «из …»; типы событий — словами
const SOURCE_GEN = { LATHE: 'токарного станка', WELD: 'сварочного поста', TORQ: 'ключа с регистрацией момента' };
const EVENT_WORDS = { 'equipment.state': 'состояние станка', 'job.received': 'задание получено',
  'operation.started': 'операция начата', 'operation.finished': 'операция закончена', 'measurement.recorded': 'замер записан',
  'inspection.result': 'результат контроля', 'operator.action': 'действие исполнителя', 'item.registered': 'деталь зарегистрирована',
  'external.receipt': 'квитанция внешней системы', 'decision.recorded': 'решение', 'reference.updated': 'обновление справочника',
  'component.received': 'поступление составной части', 'heartbeat': 'сигнал «на связи»',
  'operation.paused': 'операция приостановлена', 'operation.resumed': 'операция продолжена',
  'operation.transferred': 'деталь перемещена', 'assembly.linked': 'составная часть установлена',
  'complaint.received': 'рекламация получена' };
// Средства измерений: «CAL-02 (Штангенциркуль, ST-QA)» → «штангенциркуль (приёмочный контроль)»; номер — словом справочника
const INSTR = new RegExp(`${NB}((?:PNM|PRF|MIC|CAL|TST|TQM)-0\\d)(?: \\(([^,()]+), ([^()]+)\\))?${NE}`, 'g');
const LOG = new RegExp(`${NB}(LATHE|WELD|TORQ)-0(\\d)-LOG${NE}`, 'g');
const LATE = /позднее событие ([a-z_]+\.[a-z_.]+) от ([^:]+): пересобраны (.+)$/;
const EVENT = new RegExp(`${NB}([a-z_]+\\.[a-z_]+)${NE}`, 'g');

function logTitle(kind, n) {
  return kind === 'TORQ' ? `журнал ${SOURCE_GEN[kind]}` : `журнал ${SOURCE_GEN[kind]} ${n}`;
}

export function opsInText(text) {
  return String(text ?? '')
    // «позднее событие equipment.state от LATHE-02-LOG: пересобраны БД-01-0106» → «Журнал токарного станка 2:
    // запись «состояние станка» пришла позже — пересобрана история БД-01-0106»
    .replace(LATE, (m, type, src, items) => `${src.trim()}: запись «${EVENT_WORDS[type] || 'событие'}» пришла позже — `
      + `пересобрана история ${items}`)
    .replace(new RegExp(`от ${LOG.source}`, 'g'), (m, kind, n) => `из ${logTitle(kind, n).replace(/^журнал/, 'журнала')}`)
    .replace(LOG, (m, kind, n) => logTitle(kind, n))
    .replace(new RegExp(`событи([ея]) ${EVENT.source}`, 'g'), (m, e, t) => (EVENT_WORDS[t] ? `событи${e} «${EVENT_WORDS[t]}»` : m))
    .replace(/(^|[.!?]\s+)журнал /g, (m, p) => `${p}Журнал `)
    .replace(EVENT, (m, t) => EVENT_WORDS[t] || m)
    .replace(INSTR, (m, id, name, place) => (name ? `${name.trim().toLowerCase()} (${PLACE_TEXTS[place.trim()] || place.trim()})`
      : INSTRUMENT_TEXTS[id] || id))
    .replace(RUN_OP, (m, op) => `«${OPERATIONS[op]}»`)
    .replace(JOB, (m, line) => `задание MES на линию ${line}`)
    .replace(TYPE_COUNT, (m, t, n) => (t === 'BD' ? `${n} ${plural(Number(n), 'блок', 'блока', 'блоков')} датчиков` : `${TYPES[`${t}-01`]} × ${n}`))
    .replace(EQUIP, (m, id) => EQUIPMENT[id] || id)
    .replace(TYPE, (m, t, at, all) => {
      const key = `${t}-01`;
      return (WHERE.test(all.slice(0, at)) ? TYPES_WHERE[key] : TYPES[key]) || m;
    })
    .replace(OPERATOR, (m, n) => `исполнитель ${n}`)
    .replace(MAILBOX, (m, w, role) => (ROLE_DATIVE[role] ? `${w} ${ROLE_DATIVE[role]}` : m))
    .replace(/(^|[^А-Яа-яЁё])отк(?![А-Яа-яЁё])/g, '$1ОТК') // «отк сварки» из текста ядра — аббревиатура
    .replace(SOURCE, (m, s) => SOURCES[s] || s);
}

// Коды ядра в тексте — словами; неизвестный код остаётся как есть. В начале фразы — с большой буквы.
// Участок после «на» — в предложном падеже («начата операция на сборочном участке»), кроме «куда»
export function humanizeCodes(text) {
  const s = opsInText(text);
  const out = s.replace(CODES, (code, _c, at, all) => {
    const before = all.slice(0, at);
    const where = PLACE_WHERE[code] && WHERE.test(before) && !MOTION.test(before);
    const word = (where ? PLACE_WHERE[code] : PLACE_TEXTS[code]) || CP_TEXTS[code] || CHAR_TEXTS[code];
    if (!word) return code;
    return at === 0 || /[.!?]\s*$/.test(before) ? up(word) : word;
  });
  // «линия L-1» и «линия Л-1» → «линия 1»; остальное «L-1» → «Л-1»
  return out.replace(/(лини[яиюей]+)\s+[LЛ]-(\d+)/giu, '$1 $2').replace(LINE, 'Л-$1');
}

// ---------- карточки ----------
// Имя карточки — по дефекту и детали: «Подрез шва · БД-01-0114». Оно зависит только от самой карточки, поэтому
// одинаково в двух окнах и у двух ролей (прежний номер по порядку окна у разных окон расходился). Регистр общий для
// экранов: табло пополняет его из потока (карточки линии) и из профилей деталей; порядковый номер остался только
// для совместимости (cardNumber), на экран не выводится.
const registry = new Map();
const numbers = new Map();

const byOpened = ([a, x], [b, y]) => {
  const ta = x.opened_at || '￿';
  const tb = y.opened_at || '￿';
  return ta < tb ? -1 : ta > tb ? 1 : a.localeCompare(b);
};

export function rememberCards(list) {
  let changed = false;
  const fresh = [];
  for (const c of list || []) {
    if (!c?.nc_id) continue;
    const old = registry.get(c.nc_id);
    const next = { opened_at: c.opened_at || old?.opened_at || '', defect_type: c.defect_type || old?.defect_type || '',
      item_id: c.item_id || old?.item_id || '' };
    if (!old || old.opened_at !== next.opened_at || old.defect_type !== next.defect_type || old.item_id !== next.item_id) {
      registry.set(c.nc_id, next);
      changed = true;
    }
    if (!numbers.has(c.nc_id)) fresh.push([c.nc_id, next]);
  }
  for (const [id] of fresh.sort(byOpened)) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  return changed;
}

export function forgetCards() {
  registry.clear();
  numbers.clear();
}

export function cardNumber(id) {
  return numbers.get(id) ?? null;
}

function cardInfo(card) {
  const c = typeof card === 'string' ? { nc_id: card } : card || {};
  const known = registry.get(c.nc_id) || {};
  return { id: c.nc_id || '', defect: c.defect_type || known.defect_type || '', itemId: c.item_id || known.item_id || '' };
}

// Вид дефекта для имени: «Подрез шва»; неизвестный вид — словом справочника, с большой буквы
export function defectName(code) {
  if (!code) return '';
  return CARD_DEFECT_NAMES[code] || up(DEFECT_TEXTS[code] || String(code).replace(/_/g, ' '));
}

// Имя карточки: «Подрез шва · БД-01-0114». Принимает номер ядра или карточку ({ nc_id, defect_type, item_id }).
// Ни дефекта, ни детали не знаем — «Карточка несоответствия» (номер ядра на экран не выводится).
// Средняя точка здесь — не разделитель списка (их убрал К16), а формат имени карточки по SPEC.md 3.6 и 7.13
const DOT = ` ${String.fromCharCode(0xb7)} `;
export function cardTitle(card) {
  const { defect, itemId } = cardInfo(card);
  const name = defectName(defect);
  const item = itemId ? itemParts(itemId).base : '';
  if (name && item) return name + DOT + item;
  if (name) return name;
  if (item) return `Карточка несоответствия${DOT}${item}`;
  return 'Карточка несоответствия';
}

// Имя известно (есть дефект или деталь) — можно ставить в текст
function hasName(card) {
  const { defect, itemId } = cardInfo(card);
  return !!(defect || itemId);
}

// Подсказка к имени: номер карточки в ядре и круг сюжета (со второго)
export function cardHint(card) {
  const { id, itemId } = cardInfo(card);
  if (!id) return '';
  const cycle = itemId ? itemParts(itemId).cycleText : '';
  return `номер в ядре: ${id}${cycle ? `; ${cycle}` : ''}`;
}

// Ссылка на карточку в тексте: «Подрез шва · БД-01-0114» в кавычках-«ёлочках»
export function cardRef(card) {
  return `«${cardTitle(card)}»`;
}

// Подпись карточки в списках — то же имя, что везде. item: false — деталь уже названа рядом (строка полосы по
// детали, разделы страницы детали): остаётся вид дефекта «Подрез шва», без повтора номера детали
export function cardLabel(card, { item = true } = {}) {
  if (item) return cardTitle(card);
  return defectName(cardInfo(card).defect) || cardTitle(card);
}

const NC = /(карточк[а-яё]*(?:\s+несоответстви[яй])?\s+)?(NC-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*)/giu;
// «карточка» в падеже по предлогу перед номером: «контроль по карточке № 1», «без карточки № 2»
const CASES = [
  [/(?:^|[\s(«"])(?:по|к|ко|о|об|в|во|на|при)\s+$/iu, 'карточке'],
  [/(?:^|[\s(«"])(?:без|для|от|из|у|до|после|против|кроме)\s+$/iu, 'карточки'],
  [/(?:^|[\s(«"])(?:с|со|за|над|под|перед)\s+$/iu, 'карточкой'],
];

function cardWord(before) {
  const hit = CASES.find(([re]) => re.test(before));
  const word = hit ? hit[1] : 'карточка';
  return before.trim() === '' || /[.!?]\s*$/.test(before) ? up(word) : word;
}

// Номера карточек ядра в тексте — именами: «Карточка NC-0114-1: …» → «Карточка «Подрез шва · БД-01-0114»: …»,
// «доп. контроль по NC-0114-1» → «доп. контроль по карточке «Подрез шва · БД-01-0114»». Имени не знаем — номер
// ядра убирается, остаётся слово «карточка» в нужном падеже
// После имени ядро часто повторяет вид и деталь: «карточка NC-… «подрез» на BD-01-0114» — в имени это уже есть
const TAIL = /^\s*«[^»]{1,40}»(?:\s+на\s+(?:BD|БД|K|KR|PE|DD)-?\d\d-\d{4}(?:-R[0-9A-Za-z]+-C\d+)?)?/u;

export function cardsInText(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(NC)) {
    const [whole, pre, id] = m;
    out += src.slice(last, m.index);
    last = m.index + whole.length;
    const word = pre || `${cardWord(src.slice(0, m.index))} `;
    if (!hasName(id)) {
      out += word.trimEnd();
      continue;
    }
    out += `${word}${cardRef(id)}`;
    const defect = DEFECT_TEXTS[cardInfo(id).defect];
    const tail = TAIL.exec(src.slice(last));
    if (tail && defect && tail[0].includes(`«${defect}»`)) last += tail[0].length;
  }
  return (out + src.slice(last)).replace(/ {2,}/g, ' ');
}

// Текст ядра для экрана: коды — словами, карточки — по имени
export function humanText(text) {
  return cardsInText(humanizeCodes(text));
}

// ---------- карточка несоответствия: статус, путь, кто делает следующий шаг (SPEC.md 3.6, 7.2) ----------
export const CARD_STEPS = ['Сигнал', 'Рассмотрение', 'Подтверждено', 'Решение', 'Закрыто'];

// статус ядра → [шаг пути (0…4), плашка панели, тон плашки]
export const CARD_STATUS = {
  signal: [0, 'Ждёт рассмотрения', 'serious'],
  under_review: [1, 'На рассмотрении', 'serious'],
  extra_control: [1, 'Нужен дополнительный контроль', 'serious'],
  confirmed: [2, 'Ждёт решения по несоответствию', 'serious'],
  reverification: [3, 'Повторное предъявление', 'serious'],
  isolation: [3, 'В изоляторе', 'serious'],
  claim: [3, 'Рекламация поставщику', 'serious'],
  awaiting_approval: [3, 'Ждёт согласования', 'serious'],
  approved: [3, 'Согласовано — можно выпускать', 'ok'],
  closed: [4, 'Закрыта', 'ok'],
  not_confirmed: [4, 'Не подтверждено', 'ok'],
};

export function cardStatus(status) {
  const [step, badge, tone] = CARD_STATUS[status] || [0, 'Статус не сообщён', 'none'];
  return { step, badge, tone, closed: step === 4 };
}

// «Следующий шаг делает: …» — по статусу и категории
export function cardNextStep(status, category) {
  const head = !category || category === 'major' || category === 'critical';
  switch (status) {
    case 'signal': return 'инженер ОТК — рассмотреть сигнал';
    case 'under_review': case 'extra_control': return 'инженер ОТК — подтвердить или не подтвердить';
    case 'confirmed': return `${head ? 'начальник ОТК' : 'инженер ОТК'} — решение по несоответствию`;
    case 'reverification': return 'мастер участка — переделка, затем инженер ОТК — повторная проверка';
    case 'awaiting_approval': return 'держатель КД (и представитель заказчика, если приёмка заказчика) — согласовать';
    case 'approved': return `${head ? 'начальник ОТК' : 'инженер ОТК'} — выпустить по разрешению на отклонение`;
    case 'isolation': return 'мастер участка — перенести деталь в изолятор';
    case 'claim': return 'инженер ОТК — оформить возврат поставщику';
    case 'closed': case 'not_confirmed': return 'никто — карточка закрыта';
    default: return '';
  }
}

// Адрес карточки в кабинете ролей (Streamlit, страница «Карточка», ?nc=)
export function cabinetUrl(nc, loc = globalThis.location) {
  const host = loc?.hostname || '127.0.0.1';
  const proto = loc?.protocol === 'https:' ? 'https:' : 'http:';
  return `${proto}//${host}:8601/card?nc=${encodeURIComponent(nc || '')}`;
}

// ?card=<nc_id> — открыть панель сразу (снимки, ссылка из письма); ?card=item — первую открытую карточку детали
// из адреса #/item/<номер>. Ждём, пока табло подключится к ядру и получит карточки
export function cardFromAddress(search, hash, cards) {
  const want = new URLSearchParams(search || '').get('card');
  if (!want) return null;
  if (want !== 'item') return want;
  const item = decodeURIComponent((/^#\/item\/([^?]+)/.exec(hash || '') || [])[1] || '');
  const list = [...(cards || [])].filter((c) => c?.item_id === item);
  return (list.find((c) => !cardStatus(c.status).closed) || list[0])?.nc_id || null;
}
