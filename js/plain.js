// Служебные значения ядра — словами для цеха, в одном месте (К35): флаги приёма записи, коды статусов и решений
// в тексте («(signal)», «: received»), номера решений и событий (UUID) и ссылки на пункты документов («DOMAIN §17.4»,
// «идея … как зарубежная практика») — их рабочий экран убирает в раскрывающееся «Основание». Тексты ядра проходят
// сюда через clean() (group.js). Без DOM — проверяется node --test.

import { MACHINE } from './format.js';
import { ACTION_TEXTS, DISPOSITION_TEXTS, RECEIPT_STATUS } from './texts.js';

// Флаги приёма записи (qc/ingest: flags.py, chain.py, sequence.py, receipts.py; qc/read/models.py)
export const FLAG_TEXTS = {
  item_prev_mismatch: 'порядок записей изделия восстановлен',
  unknown_values: 'есть неизвестные значения полей',
  unknown_fields: 'есть неизвестные поля',
  late: 'пришло позже, история пересобрана',
  redelivered: 'повтор доставки, не учтён дважды',
  duplicate: 'повтор доставки, не учтён дважды',
  gap: 'пропуск в нумерации записей участка',
  gap_filled: 'пропуск в нумерации восполнен',
  seq_reused: 'номер записи участка повторён',
  clock_skew: 'часы участка расходятся с часами ядра',
  future_occurred_at: 'время события впереди часов ядра',
  unsigned: 'не подписано участком',
  stale_heartbeat: 'участок долго молчал',
  bad_headers: 'ошибки в заголовках записи',
  unmatched_item: 'изделие не опознано, ждёт сопоставления',
  quality_unknown: 'качество снимка не сообщено',
  severity_not_specified: 'тяжесть не указана',
  schema_newer_minor: 'формат участка новее',
  component_head: 'сверена цепочка составной части',
  after_acceptance: 'после приёмки ОТК',
  receipt_for_unknown: 'квитанция на неизвестное решение',
  receipt_item_mismatch: 'квитанция не к этому изделию',
  receipt_source_unexpected: 'квитанция от неожиданного отправителя',
  receipt_system_mismatch: 'система в квитанции не та',
};
// Флаги-сведения: запись в порядке, флаг только поясняет — на экране тихо, не как отклонение
const QUIET = new Set(['component_head', 'after_acceptance', 'gap_filled', 'delivered', 'accepted', 'redelivered', 'duplicate',
  'quality_unknown', 'severity_not_specified']);

// Флаги записи словами: { text, quiet } по каждому; статусы квитанций — подписями квитанций
export function flagTexts(flags) {
  return (Array.isArray(flags) ? flags : []).filter(Boolean).map((f) => {
    const s = String(f);
    const text = FLAG_TEXTS[s] || RECEIPT_STATUS[s]?.label || s.replace(/_/g, ' ');
    return { code: s, text, quiet: QUIET.has(s) };
  });
}

// Коды статусов и решений, которые ядро вставляет в текст как есть (qc/domain/status.py, qc/read/titles.py)
export const ENUM_TEXTS = {
  // карточка несоответствия (DOMAIN 5.1)
  signal: 'сигнал, ещё не рассмотрена', under_review: 'на рассмотрении', confirmed: 'несоответствие подтверждено',
  not_confirmed: 'не подтверждено', extra_control: 'нужен дополнительный контроль', awaiting_approval: 'ждёт согласования',
  approved: 'согласовано', reverification: 'повторное предъявление', isolation: 'в изоляторе', claim: 'рекламация поставщику',
  closed: 'закрыта',
  // покупной экземпляр (DOMAIN 6.2)
  received: 'получено, не проверено', verifying: 'на проверке', accepted: 'принято на входном контроле',
  nonconforming_isolated: 'несоответствующее, в изоляторе',
  // изделие (DOMAIN 6.1)
  not_presented: 'не предъявлено', in_work: 'в работе', under_inspection: 'на контроле', not_assessed: 'не оценено',
  on_hold: 'удержано', nonconforming: 'несоответствующее', accepted_qc: 'принято ОТК',
  accepted_concession: 'принято по разрешению на отклонение', scrapped: 'переведено в отходы',
  // исход наблюдения
  defect_signs_detected: 'есть признаки дефекта', no_defect_signs: 'признаков дефекта нет',
  assessment_impossible: 'оценка невозможна',
  // этап обнаружения карточки
  incoming: 'на входном контроле', between_checks: 'между проверками', not_established: 'этап не установлен',
  // действия исполнителя (operator.action)
  mode_change: 'смена режима', confirmation: 'подтверждение', check_skipped: 'пропуск контроля',
  manual_decision: 'решение вручную', pause: 'пауза', resume: 'продолжение',
  // категория дефекта (ГОСТ 15467-79)
  critical: 'критический', major: 'значительный', minor: 'малозначительный',
  ...DISPOSITION_TEXTS,
};

// Предупреждения ядра (37 кодов, SPEC.md 7.12): заголовок строки словами; код — только в подсказке. Тот же словарь
// для полосы, журнала и экранов уровня 4 (запасной слой: у источника тексты правит Codex, X31)
export const WARNING_TEXTS = {
  W_CHECK_SKIPPED: 'Пропуск контроля', W_NOT_ASSESSED: 'Ушло без оценки', W_ROUTE_VIOLATION: 'Нарушение маршрута',
  W_SPC_RULE1: 'Уход режима: точка за контрольной границей', W_SPC_RULE2: 'Уход режима, критерий 2 (7 точек по одну сторону)',
  W_SPC_RULE3: 'Уход режима, критерий 3 (7 точек подряд убывают или растут)',
  W_SPC_EWMA: 'Уход режима: малый сдвиг (сглаженное среднее)', W_SPC_CUSUM: 'Уход режима: малый сдвиг (накопленная сумма)',
  W_SPC: 'Уход режима', W_FIRST_PIECE: 'Первая деталь после наладки — предъявить ОТК',
  W_FIRST_PIECE_PENDING: 'Первая деталь после наладки ещё без результата', W_MISSING_DOCUMENTS: 'Нет документа в пакете',
  W_OPERATION_ON_HOLD: 'Операция над удержанной деталью', W_NO_QUALIFICATION: 'Нет действующего допуска исполнителя',
  W_COMPONENT_NOT_ACCEPTED: 'Составная часть не принята на входном контроле', W_PARAM_OUT_OF_MODE: 'Параметр вне режима',
  W_EQUIPMENT_DEVIATION: 'Операция при отклонении станка', W_SILENT_CONTROL_POINT: 'Нет результата точки контроля',
  W_REPEATED_CIRCUMSTANCE: 'Повторяющееся обстоятельство', W_REPEAT_AFTER_REJECT: 'Повторный сигнал после отклонения',
  W_CORRECTION_OVERDUE: 'Исправление на месте просрочено', W_UNAUTHORIZED_REWORK: 'Доработка без решения',
  W_OPERATION_STALLED: 'Операция стоит', W_LATE_EVENT: 'Запись пришла позже — история пересобрана',
  W_DECISION_BEFORE_LATE: 'Решение принято до поздней записи — проверьте', W_SOURCES_DISAGREE: 'Источники контроля расходятся',
  W_SHIFT_END_UNFINISHED: 'Конец смены — операция не завершена', W_GATE_BLOCKED: 'Шаг закрыт, пока карточка открыта',
  W_CUSTOMER_NOTIFY_DUE: 'Уведомить заказчика о значительном несоответствии',
  W_CUSTOMER_NOTIFY_OVERDUE: 'Уведомление заказчику просрочено', W_PREVENTIVE_ACTION_DUE: 'Нужно решение о предупреждающем действии',
  W_INCOMING_STAGE_WEAKER: 'Входной контроль партии слабее требуемого',
  W_INSTRUMENT_CALIBRATION_DUE: 'Поверка средства измерений скоро истекает',
  W_INSTRUMENT_CALIBRATION_EXPIRED: 'Поверка средства измерений истекла', W_INSTRUMENT_SUSPECT: 'Прибор под сомнением',
  W_MULTI_MINOR_SAME_ITEM: 'Несколько малозначительных на одной детали', W_SOURCE_SILENT: 'Источник данных молчит',
  W_JOURNAL_INTEGRITY: 'Нарушена целостность журнала',
};

// Заголовок предупреждения по коду; неизвестный код на экран не выводится — «Предупреждение» и запись в консоль
const unknownWarn = new Set();
export function warningTitle(code) {
  if (WARNING_TEXTS[code]) return WARNING_TEXTS[code];
  if (code && !unknownWarn.has(code)) {
    unknownWarn.add(code);
    globalThis.console?.warn?.(`табло: предупреждения «${code}» нет в словаре plain.js`);
  }
  return 'Предупреждение';
}

// Код статуса отдельным полем (Card.status, Card.stage, ItemSummary.status) — словами; неизвестный — как есть
export function enumTitle(code) {
  return ENUM_TEXTS[code] || String(code ?? '').replace(/_/g, ' ');
}

// Параметры режима станка в тексте ядра («WELD-01: running (welding_current 122.1)»)
export const PARAM_TEXTS = { welding_current: 'ток сварки', torque: 'момент затяжки', spindle_speed: 'частота вращения шпинделя',
  feed_rate: 'подача', temperature: 'температура', current: 'ток', voltage: 'напряжение' };

const TOKEN = '[a-z]+(?:_[a-z]+)*';
const PARAM = /(?<![\w-])([a-z]+(?:_[a-z]+)*) (-?\d+(?:[.,]\d+)?)(?![\w])/g;
const IN_PARENS = new RegExp(`\\s*\\((${TOKEN})\\)`, 'g');
const AFTER_COLON = new RegExp(`:\\s(${TOKEN})(?=$|[;,.)]|\\s\\()`, 'g');
const BARE = /(?<![\w-])([a-z]+(?:_[a-z]+)+)(?![\w-])/g; // item_prev_mismatch посреди фразы

// «открыта карточка № 3 (signal)» → «открыта карточка № 3 (сигнал, ещё не рассмотрена)»; неизвестный код в скобках
// не показывается; «не принят на входном контроле: received» → «…: получено, не проверено»
export function enumsInText(text) {
  return String(text ?? '')
    .replace(IN_PARENS, (m, t) => (ENUM_TEXTS[t] ? ` (${ENUM_TEXTS[t]})` : ''))
    .replace(AFTER_COLON, (m, t) => (ENUM_TEXTS[t] || MACHINE[t] ? `: ${ENUM_TEXTS[t] || MACHINE[t]}` : m))
    .replace(PARAM, (m, t, v) => (PARAM_TEXTS[t] ? `${PARAM_TEXTS[t]} ${v.replace('.', ',')}` : m))
    .replace(BARE, (m, t) => FLAG_TEXTS[t] || ENUM_TEXTS[t] || m);
}

// ---------- решения и события: без UUID ----------
// отдельный номер, а не часть другого обозначения: номер карточки ядра «NC-<uuid>-1» переводит names.js
const UUID = /(?<![\w-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])/gi;
const decisions = new Map();

// Решения, которые видит табло (поток, карточки): по номеру решения — что решено, когда, запись журнала
export function rememberDecisions(list) {
  for (const d of list instanceof Map ? list.values() : list || []) {
    if (!d?.event_id) continue;
    decisions.set(String(d.event_id).toLowerCase(), { action: d.action, disposition: d.disposition || null,
      at: d.decided_at || d.occurred_at || null, seq: Number.isFinite(d.seq) ? d.seq : null });
  }
}

export function forgetDecisions() {
  decisions.clear();
}

function hhmm(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// «удержать» (подпись кнопки без пояснения после тире), решение по несоответствию — его видом
export function decisionWord(action, disposition = null) {
  if (disposition && DISPOSITION_TEXTS[disposition]) return DISPOSITION_TEXTS[disposition];
  const t = ACTION_TEXTS[action];
  const w = t ? t.split(' — ')[0] : '';
  // строчная — только первая буква: «принять ОТК», не «принять отк»
  return w ? w[0].toLowerCase() + w.slice(1) : '';
}

// Номер решения ядра → «решение «удержать» от 11:26» (или «запись журнала № N»); неизвестный — не показывается
export function decisionRef(id) {
  const d = decisions.get(String(id || '').toLowerCase());
  if (!d) return '';
  const what = decisionWord(d.action, d.disposition);
  const at = hhmm(d.at);
  if (what) return `«${what}»${at ? ` от ${at}` : ''}`;
  return Number.isFinite(d.seq) ? `(запись журнала № ${d.seq})` : '';
}

// UUID в тексте: известное решение — словами, иначе убирается вместе с лишним пробелом
export function idsInText(text) {
  return String(text ?? '').replace(new RegExp(`\\s?${UUID.source}`, 'gi'), (m) => {
    const ref = decisionRef(m.trim());
    return ref ? ` ${ref}` : '';
  });
}

// ---------- основание: ссылки на пункты документов ----------
const REF = /DOMAIN\s*§|§\s*\d|API v\d|зарубежн|\bидея\b|config\/|\.ya?ml\b|JCGM|NASA JSC|First Resonance/i;
// скобки с одной вложенной парой: «(JCGM 106:2012, формула (12) — как зарубежная практика)»
const PARENS = /\s*\(((?:[^()]|\([^()]*\))*)\)/g;
const LOOSE = /[,;]?\s*(?:DOMAIN\s*)?§\s*\d+(?:\.\d+)*(?:\s*[–-]\s*\d+(?:\.\d+)*)?/g;

// «шаг … (ворота по карточке — идея First Resonance ION, как зарубежная практика; DOMAIN §17.4)» →
// { text: 'шаг …', basis: ['ворота по карточке — идея …; DOMAIN §17.4'] }
export function splitBasis(text) {
  const basis = [];
  let out = String(text ?? '').replace(PARENS, (m, inner) => {
    if (!REF.test(inner)) return m;
    basis.push(inner.trim());
    return '';
  });
  out = out.replace(LOOSE, (m) => {
    basis.push(m.replace(/^[,;]\s*/, '').trim());
    return '';
  });
  return { text: out.replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim(), basis };
}

// Всё вместе — для текста ядра на рабочем экране (основание отбрасывается; где оно нужно — splitBasis)
export function plainText(text) {
  return splitBasis(enumsInText(idsInText(text))).text;
}
