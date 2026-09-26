// Слова и расчёты экранов К33 (API v1.5–v1.6, DOMAIN §16–17): лестница утечки, точка пропуска, ворота по карточке,
// вероятность соответствия и риск в клейме, индекс Cm, прибор под сомнением, ступени входного контроля, меню по
// ролям и «точка ядра недоступна». Без DOM — проверяется node --test.

import { fmtNum, isNum, plural } from './format.js';

// ---------- точка ядра недоступна ----------
// Ядро этой версии не знает точки: FastAPI отвечает 404 {"detail": "Not Found"} (маршрута нет) или 405 (метода нет).
// 404 с объяснением ядра («карточки нет», «изделие не найдено») — это ответ точки, а не её отсутствие.
export function routeMissing(e) {
  const status = Number(e?.status) || 0;
  if (status === 405 || status === 501) return true;
  return status === 404 && (e?.body?.detail === 'Not Found' || e?.body === null || e?.body === undefined);
}

// Текст ошибки ядра: detail строкой, detail.detail объектом ядра, список ошибок проверки 422
export function coreDetail(e) {
  const d = e?.body?.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && !Array.isArray(d)) return String(d.detail || d.msg || d.message || e?.detail || '');
  return String(e?.detail || e?.message || '');
}

// Что показать вместо данных: { code, title, text } — код ответа, заголовок и объяснение простыми словами
export function failure(e, what) {
  const code = Number(e?.status) || 0;
  const detail = coreDetail(e);
  if (e?.demoMissing) return { code: 0, title: 'Данных нет', text: detail };
  if (routeMissing(e)) {
    return { code, title: `Точка ядра недоступна (${code})`,
      text: `В этой версии ядра нет точки «${what}» — она появится с ядром по контракту API v1.6.` };
  }
  if (code === 401) return { code, title: 'Нужен токен роли (401)', text: detail || 'Ядро не приняло токен роли.' };
  if (code === 403) return { code, title: 'Нет права (403)', text: detail || 'У этой роли нет права на эти данные.' };
  if (code === 404) return { code, title: 'Не найдено (404)', text: detail };
  if (code === 422) return { code, title: 'Ядро не приняло запрос (422)', text: detail };
  if (code === 0) return { code, title: 'Нет связи с ядром', text: detail };
  return { code, title: `Ядро ответило ${code}`, text: detail };
}

// ---------- экраны и рабочие места по ролям (SPEC.md 2.4, 7.15) ----------
// Названия экранов — одни на вкладке, в заголовке окна и в справке. Адреса (#/escape …) не меняются.
export const SCREEN_TITLES = {
  line: 'Линия',
  otk: 'Приёмка ОТК',
  escape: 'Что остановили',
  metrology: 'Средства измерений',
  suppliers: 'Входной контроль',
  sandbox: 'Прогон по истории',
};

// Экраны разбора (уровень 4) в роутере табло. Вкладка — подсказка, а не право: право проверяет ядро, и экран
// честно показывает отказ. Вход по токену — роль знает только ядро: видны все.
export const EXTRA_SCREENS = [
  { kind: 'escape', label: SCREEN_TITLES.escape, title: 'Что остановили и где бы это всплыло',
    roles: ['controller', 'qc_head', 'foreman', 'technologist', 'shift_supervisor', 'metrologist', 'manager'] },
  { kind: 'sandbox', label: SCREEN_TITLES.sandbox, title: 'Что изменится, если поменять настройки: прогон по прошлой истории',
    roles: ['technologist', 'qc_head'] },
  { kind: 'metrology', label: SCREEN_TITLES.metrology, title: 'Каким приборам сейчас нельзя верить и что они задели',
    roles: ['metrologist', 'controller', 'qc_head', 'technologist', 'manager'] },
  { kind: 'suppliers', label: SCREEN_TITLES.suppliers, title: 'Какую ступень контроля ждёт следующая партия и почему',
    roles: ['controller', 'qc_head', 'technologist', 'manager'] },
];

export function navFor(roleId) {
  const all = roleId === 'token' || !roleId;
  return EXTRA_SCREENS.filter((s) => all || s.roles.includes(roleId));
}

// Рабочее место роли: строка «что делаю» в меню роли, стартовый экран, видимые вкладки (не больше четырёх), вкладки
// в «Ещё ▾» и фильтр «Требует действия» по умолчанию (mine — «Мне», all — «Всем»); cabinet — у роли нет права
// читать линию, её место — кабинет ролей (экран вместо ошибки 403)
export const WORKPLACES = {
  controller: { doing: 'Приёмка и клеймо, карточки несоответствий, удержание', start: 'otk',
    tabs: ['line', 'otk', 'escape'], more: ['metrology', 'suppliers'], attn: 'mine' },
  qc_head: { doing: 'Решения по значительным и критическим несоответствиям', start: 'line',
    tabs: ['line', 'otk', 'escape'], more: ['metrology', 'suppliers', 'sandbox'], attn: 'mine' },
  foreman: { doing: 'Где «стоп», что удержано, что исправить к сроку', start: 'line',
    tabs: ['line', 'escape'], more: [], attn: 'mine' },
  technologist: { doing: 'Уход режима, причины, повторяющиеся обстоятельства', start: 'line',
    tabs: ['line', 'escape', 'sandbox'], more: ['metrology', 'suppliers'], attn: 'mine' },
  // начальнику смены — «стоп», который вовремя не приняли: внутри уровня сначала самое давнее (ближе к эскалации)
  shift_supervisor: { doing: '«Стоп», который вовремя не приняли', start: 'line',
    tabs: ['line', 'escape'], more: [], attn: 'all', order: 'oldest' },
  metrologist: { doing: 'Поверка средств измерений, прибор под сомнением', start: 'metrology',
    tabs: ['metrology', 'line', 'escape'], more: [], attn: 'all' },
  manager: { doing: 'Сколько остановили и где; показатели', start: 'escape',
    tabs: ['escape', 'line'], more: ['metrology', 'suppliers'], attn: 'all' },
  design_authority: { doing: 'Согласование ремонта и разрешения на отклонение', cabinet: true },
  customer_rep: { doing: 'Дело изделия, согласование, проверка пакета доказательств', cabinet: true },
  admin: { doing: 'Целостность журнала, приём данных', cabinet: true },
};
const ANY_ROLE = { doing: '', start: 'line', tabs: ['line', 'otk', 'escape'], more: ['metrology', 'suppliers', 'sandbox'],
  attn: 'all' };

export function workplace(roleId) {
  return WORKPLACES[roleId] || ANY_ROLE;
}

// Вкладки роли словами: видимые и в «Ещё ▾», каждая { kind, label, title }
export function tabsFor(roleId) {
  const w = workplace(roleId);
  const tab = (kind) => ({ kind, label: SCREEN_TITLES[kind] || kind,
    title: EXTRA_SCREENS.find((s) => s.kind === kind)?.title || SCREEN_TITLES[kind] || '' });
  return { tabs: (w.tabs || []).map(tab), more: (w.more || []).map(tab) };
}

// Кабинет ролей (Streamlit): карточки, согласования, дело изделия — там, где у табло функции нет
export const CABINET_URL = 'http://127.0.0.1:8601';

// «L-1» → «Линия 1» (подпись ряда плиток и выбора линии); не похоже на номер линии — как есть
export function lineWord(id) {
  const m = /^(?:L|Л)-?(\d+)$/i.exec(String(id || ''));
  return m ? `Линия ${m[1]}` : String(id || 'Линия');
}

// ---------- числа ----------
// Коэффициент стоимости: целое — целым, иначе одна-две значащие после запятой (1,3; 3,8; 231)
export function fmtFactor(v) {
  if (!isNum(v)) return '—';
  if (Number.isInteger(v)) return fmtNum(v);
  return fmtNum(v, Math.abs(v) < 10 ? 1 : 0);
}

// Вероятность 0…1 в процентах — то же правило, что у ядра (qc/read/conformity.py, pct_text): до сотых процента,
// не меньше 99,99 % — «> 99,99 %», меньше 0,01 % — «< 0,01 %»: ни «100 %», ни «0 %» (1,0 и 0 у ядра — округление
// нормального распределения, а не уверенность)
export function fmtProb(p) {
  if (!isNum(p)) return '—';
  if (p >= 0.9999) return '> 99,99 %';
  if (p < 0.0001) return '< 0,01 %';
  return `${fmtNum(p * 100, 2)} %`;
}

// ---------- лестница утечки (DOMAIN §16.2, §17.3) ----------
export const TEAM_NOTE = 'оценка команды, не норма';
export const RANGE_NOTE = 'ориентир, не норма';

// Стоимость обнаружения на ступени: диапазон вне завода (источник — ориентир) или коэффициент внутри завода.
// У точки завода ядро К31 отдаёт и cost_low = cost_high = коэффициент (а строка by_stage сводки — только их), но это
// единицы участка детали, а не «во сколько раз дороже, чем на заводе» — другая шкала (docs/ESCAPE.md, «Две шкалы в
// одной лестнице»): «к заводу» — только у этапа вне завода (ступень или строка «вне завода: …»)
export function costText(step) {
  if (!step) return '';
  if (isNum(step.cost_factor)) return `×${fmtFactor(step.cost_factor)} к участку детали (${TEAM_NOTE})`;
  const outside = isOutside(step) || /^вне завода/i.test(String(step.stage || ''));
  if (!outside && isNum(step.cost_low) && step.cost_low === step.cost_high && (step.control_point_id || step.stage)) {
    return `×${fmtFactor(step.cost_low)} к участку детали (${TEAM_NOTE})`;
  }
  if (isNum(step.cost_low) && isNum(step.cost_high)) {
    const span = step.cost_low === step.cost_high ? fmtFactor(step.cost_low) : `${fmtFactor(step.cost_low)}…${fmtFactor(step.cost_high)}`;
    const src = step.cost_source ? `${step.cost_source}, ` : '';
    return `в ${span} раза дороже, чем на заводе (${src}${RANGE_NOTE})`;
  }
  return '';
}

// «Во сколько раз дороже там, где проявился бы»: диапазон, если ядро его дало, иначе коэффициент
export function preventedText(l) {
  if (!l) return '';
  if (isNum(l.cost_prevented_low) && isNum(l.cost_prevented_high)) {
    return `в ${fmtFactor(l.cost_prevented_low)}…${fmtFactor(l.cost_prevented_high)} раза дороже (${RANGE_NOTE})`;
  }
  if (isNum(l.cost_factor_prevented)) return `в ${fmtFactor(l.cost_factor_prevented)} раза дороже (${TEAM_NOTE})`;
  return '';
}

export function isOutside(step) {
  return !step?.control_point_id && /^вне завода/i.test(String(step?.title || ''));
}

// Ступени лестницы для экрана: где обнаружено, дальше по маршруту, вне завода; «здесь проявился бы» — первая,
// которая обнаружила бы (как would_surface_at ядра)
export function ladderSteps(l) {
  const steps = Array.isArray(l?.steps) ? [...l.steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const surface = steps.find((s) => s.would_detect) || null;
  return steps.map((s) => ({ ...s, outside: isOutside(s), surface: s === surface, cost: costText(s) }));
}

// Точка пропуска по 8D (DOMAIN §17.3): отвечает проверка, а не человек
export const ESCAPE_KINDS = {
  missed: { label: 'точка пропустила: было «признаков нет»', tone: 'caution', icon: '◐' },
  not_assessable: { label: 'на точке оценка была невозможна', tone: 'caution', icon: '?' },
  skipped: { label: 'на точке нет результата', tone: 'caution', icon: '○' },
  rejected_signal: { label: 'сигнал был, но его не подтвердили', tone: 'caution', icon: '!' },
  no_capable_point: { label: 'способной точки нет — нужна новая точка контроля', tone: 'serious', icon: '!' },
  none: { label: 'ускользания нет: первая способная точка и обнаружила', tone: 'none', icon: '✓' },
};

export function escapeKind(kind) {
  return ESCAPE_KINDS[kind] || { label: String(kind || 'вид не передан'), tone: 'none', icon: '?' };
}

// ---------- ворота по карточке (DOMAIN §17.4) ----------
export const GATE_STATUS = {
  open: { label: 'нельзя начинать, пока карточка открыта', tone: 'critical', icon: '✕' },
  passed: { label: 'карточка закрыта — шаг можно начинать', tone: 'none', icon: '✓' },
  not_required: { label: 'ворота не нужны — после обнаружения шагов нет', tone: 'none', icon: '○' },
};

export function gateStatus(s) {
  return GATE_STATUS[s] || { label: String(s || 'статус не передан'), tone: 'none', icon: '?' };
}

// ---------- вероятность соответствия и риск (DOMAIN §17.1) ----------
// null — у измерения этих полей нет вовсе (ядро без API v1.6); пустое p — с причиной из p_basis
export function conformityText(m) {
  if (!m || !('p_conform' in m || 'p_nonconform' in m)) return null;
  if (isNum(m.p_conform)) return `вероятность соответствия ${fmtProb(m.p_conform)}`;
  return `вероятность соответствия не считается${m.p_basis ? `: ${m.p_basis}` : ''}`;
}

export function hasConformity(profile) {
  return (profile?.checks || []).some((c) => (c.margins || []).some((m) => 'p_conform' in m || 'p_nonconform' in m));
}

export function riskText(risk, title = '') {
  if (!risk || !isNum(risk.value)) return '';
  const what = title || risk.characteristic_id || '';
  return `риск, что принятая деталь не соответствует: ${fmtProb(risk.value)}${what ? ` (${what})` : ''}`;
}

// ---------- метрология: Cm и прибор под сомнением (DOMAIN §17.1–17.2) ----------
export function cmVerdict(row) {
  if (!row || !isNum(row.cm)) return { key: 'none', label: 'Cm не определён', tone: 'none' };
  if (isNum(row.cm_target) && row.cm < row.cm_target) return { key: 'low', label: `ниже цели ${fmtNum(row.cm_target, 1)}`, tone: 'caution' };
  return { key: 'ok', label: isNum(row.cm_target) ? `не ниже цели ${fmtNum(row.cm_target, 1)}` : 'цель не задана', tone: 'none' };
}

// Отметки с экрана нет: отклонение средства при поверке приходит из системы поверки (DOMAIN §17.2)
export const SUSPECT_BY_MESSAGE = 'Отметки с экрана нет: отклонение средства при поверке приходит из системы '
  + 'поверки сообщением метрологии reference.updated (справочник средств: когда выявлено, найденное отклонение, '
  + 'последняя успешная поверка), DOMAIN §17.2. Ядро сразу пересчитывает прежние измерения этим средством.';

export function instrumentsOf(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.instrument_id).filter(Boolean))].sort();
}

// «0,6» и «0.6» — одно число; пусто и мусор — NaN
export function parseNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.').replace('−', '-');
  return s === '' || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s) ? NaN : Number(s);
}

// ---------- входной контроль (DOMAIN §17.5) ----------
export const INCOMING_STAGES = {
  full: { label: 'сплошной', icon: '●', hint: 'каждый экземпляр на входном контроле' },
  sampling: { label: 'выборочный', icon: '◑', hint: 'партия по выборке' },
  skip: { label: 'пропуск', icon: '○', hint: 'партия без входного контроля, не больше N партий и D дней' },
};
const RANK = { skip: 0, sampling: 1, full: 2 };

export function stageMeta(s) {
  return INCOMING_STAGES[s] || { label: String(s || 'не передана'), icon: '?', hint: '' };
}

export function weaker(declared, required) {
  return declared in RANK && required in RANK && RANK[declared] < RANK[required];
}

export const LOT_OUTCOMES = {
  accepted: 'принята', rejected: 'отказ на входном контроле', card: 'карточка несоответствия',
  skipped: 'принята пропуском', pending: 'ждёт входного контроля',
};

// Когда переключится: правила — config/incoming.yaml (настройка технолога); числа правил ядро в ответе не передаёт,
// поэтому — сколько партий принято подряд с перехода и что сменит ступень
export function switchText(q) {
  const since = Number(q?.since_seq) || 0;
  const hist = Array.isArray(q?.history) ? q.history : [];
  const after = hist.filter((x) => (Number(x.seq) || 0) > since);
  let run = 0;
  for (const x of after) run = x.outcome === 'accepted' ? run + 1 : x.outcome === 'skipped' ? run : 0;
  const n = `${run} ${plural(run, 'партия', 'партии', 'партий')}`;
  const from = since > 0 ? 'с перехода' : 'с начала истории пары';
  if (q?.stage === 'full') return `Ослабится до выборочного после серии партий, принятых подряд при сплошном контроле; ${from} принято подряд: ${n}.`;
  if (q?.stage === 'sampling') return `Ослабится до пропуска после серии партий подряд без карточек (${from}: ${n}); отказ партии или подтверждённая карточка «входной материал» — сразу сплошной.`;
  if (q?.stage === 'skip') return 'Пропуск ограничен числом партий и днями — затем выборочный; карточка на партии за пропуском — выборочный, отказ — сплошной.';
  return '';
}

// Название участка над столбцом плиток — коротко («Токарный участок» → «Токарный», «Участок испытаний» →
// «Испытания», «Приёмочный контроль ОТК» → «Приёмка ОТК»); полное — в подсказке
export function shortStation(title) {
  const s = String(title || '').trim();
  const adj = /^(\S+(?:ый|ой|ий))\s+участок$/i.exec(s);
  if (adj) return adj[1];
  if (/^участок испытаний$/i.test(s)) return 'Испытания';
  if (/^(?:участок )?входно(?:й|го) контрол/i.test(s)) return 'Входной контроль';
  if (/^(?:приёмочный контроль|участок приёмочного)/i.test(s)) return 'Приёмка ОТК';
  return s;
}

// Станок словами: «LATHE-01» → «токарный станок 1»; неизвестный — как есть (код — в подсказке)
const MACHINE_KINDS = { LATHE: 'токарный станок', WELD: 'сварочный пост', TORQ: 'гайковёрт', MILL: 'фрезерный станок',
  PRESS: 'пресс', TEST: 'испытательный стенд', CMM: 'координатно-измерительная машина' };
export function machineName(id) {
  const m = /^([A-Z]+)-0*(\d+)$/.exec(String(id || ''));
  return m && MACHINE_KINDS[m[1]] ? `${MACHINE_KINDS[m[1]]} ${m[2]}` : String(id || '');
}

// Приёмочный участок: детали там не «в работе», а «у ОТК»
export function isAcceptance(stationId, title = '') {
  return stationId === 'ST-QA' || /приёмоч/i.test(String(title));
}

// ---------- предупреждения ядра словами ----------
// Заголовок строки по коду предупреждения (SPEC.md 7.12); полная фраза ядра — строкой ниже
export const CODE_TITLES = {
  W_CHECK_SKIPPED: 'Пропуск контроля',
  W_NOT_ASSESSED: 'Ушло без оценки',
  W_ROUTE_VIOLATION: 'Нарушение маршрута',
  W_SPC_RULE1: 'Уход режима: точка за контрольной границей',
  W_SPC_RULE2: 'Уход режима, критерий 2',
  W_SPC_RULE3: 'Уход режима, критерий 3',
  W_SPC_EWMA: 'Уход режима: малый сдвиг (сглаженное среднее)',
  W_SPC_CUSUM: 'Уход режима: малый сдвиг (накопленная сумма)',
  W_SPC: 'Уход режима',
  W_FIRST_PIECE: 'Первая деталь после наладки — предъявить ОТК',
  W_FIRST_PIECE_PENDING: 'Первая деталь после наладки ещё без результата',
  W_MISSING_DOCUMENTS: 'Нет документа в пакете',
  W_OPERATION_ON_HOLD: 'Операция над удержанной деталью',
  W_NO_QUALIFICATION: 'Нет действующего допуска исполнителя',
  W_COMPONENT_NOT_ACCEPTED: 'Составная часть не принята на входном контроле',
  W_PARAM_OUT_OF_MODE: 'Параметр вне режима',
  W_EQUIPMENT_DEVIATION: 'Операция при отклонении станка',
  W_SILENT_CONTROL_POINT: 'Нет результата точки контроля',
  W_REPEATED_CIRCUMSTANCE: 'Повторяющееся обстоятельство',
  W_REPEAT_AFTER_REJECT: 'Повторный сигнал после отклонения',
  W_CORRECTION_OVERDUE: 'Исправление на месте просрочено',
  W_UNAUTHORIZED_REWORK: 'Доработка без решения',
  W_OPERATION_STALLED: 'Операция стоит',
  W_LATE_EVENT: 'Запись пришла позже — история пересобрана',
  W_DECISION_BEFORE_LATE: 'Решение принято до поздней записи — проверьте',
  W_SOURCES_DISAGREE: 'Источники контроля расходятся',
  W_SHIFT_END_UNFINISHED: 'Конец смены — операция не завершена',
  W_GATE_BLOCKED: 'Шаг закрыт, пока карточка открыта',
  W_CUSTOMER_NOTIFY_DUE: 'Уведомить заказчика о значительном несоответствии',
  W_CUSTOMER_NOTIFY_OVERDUE: 'Уведомление заказчику просрочено',
  W_PREVENTIVE_ACTION_DUE: 'Нужно решение о предупреждающем действии',
  W_INCOMING_STAGE_WEAKER: 'Входной контроль партии слабее требуемого',
  W_INSTRUMENT_CALIBRATION_DUE: 'Поверка средства измерений скоро истекает',
  W_INSTRUMENT_CALIBRATION_EXPIRED: 'Поверка средства измерений истекла',
  W_INSTRUMENT_SUSPECT: 'Прибор под сомнением',
  W_MULTI_MINOR_SAME_ITEM: 'Несколько малозначительных на одной детали',
  W_SOURCE_SILENT: 'Источник данных молчит',
  W_JOURNAL_INTEGRITY: 'Нарушена целостность журнала',
};
