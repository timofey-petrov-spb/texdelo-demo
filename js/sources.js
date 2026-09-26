// Входные данные (К46, сессия с экспертами 26.09: «контроль корректности входных данных», «сигнализировать о
// случаях»): по каждому источнику — что это и где, связь, сколько принято, повторы, опоздания, пропуски нумерации,
// расхождение часов, подпись, карантин. Чистая логика без DOM — проверяется node --test.
//
// Данные — только то, что отдаёт ядро: LineState.sources (GET /v1/line; поля монитора приёма qc/ingest/stats.py:
// state, accepted, duplicates, late, gaps, missing_seq_count, clock_skew, unsigned, signature, last_seen_at) и, если у
// роли есть право на сводку приёма, её quarantined, rejected и last_heartbeat_at по источнику. Ничего не досчитывается.
//
// Что тревога, а что «к сведению»: повтор отсеян, опоздание учтено, пропуск нумерации виден — это работа приёма, а не
// поломка. Тревога — некорректные входные данные и потеря связи: отказ с кодом (запись не попала в историю детали),
// записи в карантине, записи без подписи или подпись не у всех, и источник, который шлёт сигнал «на связи» постоянно
// (оборудование линии), а теперь молчит. Учётные системы и квитанции присылают данные по событию: их молчание — норма.
// Источник из реестра, который ещё ни разу не присылал данных, — серым и без объяснения причины: ядро знает только,
// что он не выходил на связь.

import { fmtNum, fmtTime, isNum, parseTime, plural } from './format.js';

export const ONLINE = 'на связи';
export const SILENT = 'не отвечает';
export const NEVER = 'не выходил на связь';

// Участки — словами справочника dataset/reference/stations.yaml (в родительном падеже для «камера сварочного участка»)
const PLACES = {
  IN: ['входного контроля', 'Входной контроль'],
  TURN: ['токарного участка', 'Токарный участок'],
  WELD: ['сварочного участка', 'Сварочный участок'],
  ASSY: ['сборочного участка', 'Сборочный участок'],
  FUNC: ['участка испытаний', 'Участок испытаний'],
  QA: ['приёмочного контроля', 'Приёмочный контроль ОТК'],
};
// Оборудование и линия — dataset/reference/equipment.yaml; ключ момента TORQ-01 общий для двух линий
const EQUIPMENT = {
  LATHE: ['токарного станка', 'TURN'],
  WELD: ['сварочного поста', 'WELD'],
  TORQ: ['динамометрического ключа', 'ASSY'],
};
const EQUIPMENT_LINE = { 'LATHE-01': 'линия 1', 'LATHE-02': 'линия 2', 'WELD-01': 'линия 1', 'WELD-02': 'линия 2', 'TORQ-01': 'обе линии' };
// Учётные системы и квитанции: config/adapters.yaml, integrations/receipt_sources.py
const SYSTEMS = { MES: 'MES', ONEC: '1С', GAL: 'Галактика', MAIL: 'внутренняя почта', KOMPAS: 'КОМПАС' };
const SYSTEM_WHAT = { MES: 'операции', ONEC: 'задания и справочники', GAL: 'задания и справочники', KOMPAS: 'состав изделия' };

// номер экземпляра: «№ 2»; A1/B1 в реестре адаптеров — примеры двух форматов поставщиков (docs/CAMERAS.md)
const VENDOR = { A: 'А', B: 'Б' };
const num = (m) => {
  if (!m) return '';
  if (Number(m)) return ` № ${Number(m)}`;
  const v = /^([AB])\d+$/.exec(m);
  return v ? ` (формат поставщика ${VENDOR[v[1]]})` : '';
};

// Что за источник — по его номеру и справочникам: { kind, name, place, line, continuous }.
// continuous — оборудование линии: шлёт сигнал «на связи» постоянно, его молчание — тревога
export function sourceInfo(id) {
  const s = String(id || '');
  let m = /^(LATHE|WELD|TORQ)-(\d+)-LOG$/.exec(s);
  if (m) {
    const [word, place] = EQUIPMENT[m[1]];
    return { kind: 'журнал станка', name: `Журнал ${word} ${Number(m[2])}`, place: PLACES[place][1],
      line: EQUIPMENT_LINE[`${m[1]}-${m[2]}`] || '', continuous: true };
  }
  m = /^CAM-(IN|TURN|WELD|ASSY|FUNC|QA)(?:-([A-Z]?\d+))?$/.exec(s);
  if (m) return { kind: 'камера', name: `Камера ${PLACES[m[1]][0]}${num(m[2])}`, place: PLACES[m[1]][1], line: '', continuous: true };
  m = /^(MEAS|TERM)-(IN|TURN|WELD|ASSY|FUNC|QA)(?:-(\d+))?$/.exec(s);
  if (m) {
    const kind = m[1] === 'MEAS' ? 'измерения' : 'терминал';
    const name = m[1] === 'MEAS' ? 'Измерения' : 'Терминал';
    return { kind, name: `${name} ${PLACES[m[2]][0]}${num(m[3])}`, place: PLACES[m[2]][1], line: '', continuous: true };
  }
  m = /^STAND-(IN|FUNC)(?:-(\d+))?$/.exec(s);
  if (m) {
    const name = m[1] === 'IN' ? 'Стенд входного контроля' : 'Стенд функциональной проверки';
    return { kind: 'стенд', name: `${name}${num(m[2])}`, place: PLACES[m[1]][1], line: '', continuous: true };
  }
  m = /^CMM-(\d+)$/.exec(s);
  if (m) return { kind: 'КИМ', name: `Координатно-измерительная машина${num(m[1])}`, place: PLACES.TURN[1], line: '', continuous: true };
  if (s === 'MACHINE-WELD') return { kind: 'сигналы станка', name: 'Сигналы сварочного поста', place: PLACES.WELD[1], line: '', continuous: true };
  if (/^REG-\d+$/.test(s)) return { kind: 'учётная система', name: 'Регистрация изделий', place: '', line: '', continuous: false };
  m = /^(MES|ONEC|GAL|MAIL|KOMPAS)-(?:(SYNC)-)?\d+(-RCPT)?$/.exec(s);
  if (m) {
    const sys = SYSTEMS[m[1]];
    if (m[3]) return { kind: 'квитанции', name: `Квитанции: ${sys}`, place: '', line: '', continuous: false };
    const what = m[2] ? 'обмен заданиями' : SYSTEM_WHAT[m[1]] || 'обмен';
    return { kind: 'учётная система', name: `${sys}: ${what}`, place: '', line: '', continuous: false };
  }
  return { kind: 'другой источник', name: 'Другой источник', place: '', line: '', continuous: false };
}

const n0 = (v) => (isNum(v) && v > 0 ? v : 0);
const sumCodes = (o) => (o && typeof o === 'object' ? Object.values(o).reduce((a, v) => a + n0(v), 0) : 0);

// «12 с», «3 мин», «1 ч 5 мин» — сколько прошло с последней связи
export function agoText(sec) {
  if (!isNum(sec) || sec < 0) return '';
  if (sec < 90) return `${fmtNum(Math.round(sec))} с`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${fmtNum(min)} мин`;
  return `${fmtNum(Math.floor(min / 60))} ч ${fmtNum(min % 60)} мин`;
}

// Строка экрана по источнику. stat — строка сводки приёма (может не быть); nowIso — время снимка ядра
export function sourceRow(src, stat = null, nowIso = null) {
  const info = sourceInfo(src?.source_id);
  const state = src?.state === ONLINE || src?.state === SILENT || src?.state === NEVER ? src.state : (src?.state ? SILENT : NEVER);
  // оборудование по справочнику — или любой источник, который присылал сигнал «на связи»
  const continuous = info.continuous || !!stat?.last_heartbeat_at;
  const last = parseTime(src?.last_seen_at);
  const now = parseTime(nowIso);
  const ago = last && now ? Math.max(0, (now - last) / 1000) : null;
  const quarantined = stat ? sumCodes(stat.quarantined) : null;
  const rejected = stat ? sumCodes(stat.rejected) : null;
  const unsigned = n0(src?.unsigned);
  const sigBad = src?.signature === 'unsigned' || src?.signature === 'mixed';
  const row = {
    id: String(src?.source_id || ''), ...info, state, continuous,
    accepted: n0(src?.accepted), duplicates: n0(src?.duplicates), late: n0(src?.late), gaps: n0(src?.gaps),
    missing: n0(src?.missing_seq_count), skew: n0(src?.clock_skew), unsigned, quarantined, rejected,
    signature: src?.signature || null, lastSeen: last ? fmtTime(src.last_seen_at) : '', ago,
  };
  const alarms = [];
  if (rejected > 0) alarms.push(`отказано ${fmtNum(rejected)} — в историю не попали`);
  if (quarantined > 0) alarms.push(`в карантине ${fmtNum(quarantined)}`);
  if (unsigned > 0) alarms.push(`без подписи ${fmtNum(unsigned)}`);
  else if (sigBad) alarms.push(src.signature === 'unsigned' ? 'записи без подписи' : 'подпись не у всех записей');
  if (state === SILENT && continuous) alarms.push(`замолчал${ago != null ? ` ${agoText(ago)} назад` : ''}`);
  const notes = [];
  if (row.duplicates) notes.push(`повторов отсеяно ${fmtNum(row.duplicates)}`);
  if (row.late) notes.push(`опоздало ${fmtNum(row.late)}`);
  if (row.missing) notes.push(`ждём досылку ${fmtNum(row.missing)}`);
  else if (row.gaps) notes.push(`пропуск нумерации закрыт досылкой: ${fmtNum(row.gaps)}`);
  if (row.skew) notes.push(`часы расходятся: ${fmtNum(row.skew)}`);
  row.alarms = alarms;
  row.notes = notes;
  row.tone = alarms.length ? 'serious' : notes.length ? 'caution' : state === ONLINE ? 'ok' : 'none';
  row.link = linkWords(row);
  return row;
}

// Связь словами: «на связи», «замолчал 3 мин назад», «по событию, последний раз 2 мин назад», «ещё не присылал данных»
export function linkWords(row) {
  if (row.state === NEVER) return { text: 'ещё не присылал данных (есть в реестре)', tone: 'none', icon: '○' };
  if (row.state === ONLINE) return { text: 'на связи', tone: 'ok', icon: '●' };
  const ago = row.ago != null ? `${agoText(row.ago)} назад` : '';
  if (row.continuous) return { text: `замолчал${ago ? ` ${ago}` : ''}`, tone: 'serious', icon: '!' };
  return { text: `по событию${ago ? `, последний раз ${ago}` : ''}`, tone: 'none', icon: '●' };
}

// Порядок: сначала тревоги, потом «к сведению», потом на связи, в конце — ещё не выходившие на связь
const RANK = { serious: 0, caution: 1, ok: 2, none: 3 };
export function sortRows(rows) {
  return [...rows].sort((a, b) => (RANK[a.tone] - RANK[b.tone]) || ((a.state === NEVER) - (b.state === NEVER))
    || (b.accepted - a.accepted) || a.name.localeCompare(b.name, 'ru'));
}

// Все строки: sources — LineState.sources, stats — сводка приёма (или null), nowIso — время снимка
export function sourceRows(sources, stats = null, nowIso = null) {
  const by = stats?.sources && typeof stats.sources === 'object' ? stats.sources : {};
  return sortRows((Array.isArray(sources) ? sources : []).filter((s) => s && s.source_id)
    .map((s) => sourceRow(s, stats ? by[s.source_id] || {} : null, nowIso)));
}

// Сводка вверху: «Все источники: 35. На связи 20, повторов отсеяно 1, опозданий 1, в карантине 0»
export function sourcesSummary(rows) {
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const known = rows.some((r) => r.quarantined !== null);
  const out = {
    total: rows.length,
    online: rows.filter((r) => r.state === ONLINE).length,
    never: rows.filter((r) => r.state === NEVER).length,
    byEvent: rows.filter((r) => r.state === SILENT && !r.continuous).length,
    silent: rows.filter((r) => r.state === SILENT && r.continuous).length,
    accepted: sum('accepted'), duplicates: sum('duplicates'), late: sum('late'), gaps: sum('gaps'), missing: sum('missing'),
    skew: sum('skew'), unsigned: sum('unsigned'),
    quarantined: known ? sum('quarantined') : null, rejected: known ? sum('rejected') : null,
    alarms: rows.filter((r) => r.alarms.length),
  };
  out.text = `Все источники: ${fmtNum(out.total)}. На связи ${fmtNum(out.online)}, повторов отсеяно ${fmtNum(out.duplicates)}, `
    + `опозданий ${fmtNum(out.late)}, в карантине ${out.quarantined === null ? 'нет данных' : fmtNum(out.quarantined)}`;
  // «тревог нет» — только о том, что проверено: без сводки приёма про карантин и отказы ничего не утверждаем
  out.okText = out.quarantined === null
    ? 'Тревог по связи и подписи нет; карантин и отказы — нет данных у этой роли. Повторы и опоздания — к сведению, приём их учёл.'
    : 'Тревог нет: отказов нет, карантин пуст, записей без подписи нет, оборудование линии на связи. '
      + 'Повторы и опоздания — к сведению, приём их учёл.';
  return out;
}

// Знак в строке статуса: только настоящие тревоги; null — показывать нечего
export function sourcesSign(rows) {
  const bad = rows.filter((r) => r.alarms.length);
  if (!bad.length) return null;
  const first = bad.slice(0, 3).map((r) => `${r.name}: ${r.alarms.join(', ')}`);
  return {
    count: bad.length,
    text: `! Данные: ${fmtNum(bad.length)}`,
    title: `Входные данные — ${fmtNum(bad.length)} ${plural(bad.length, 'источник требует', 'источника требуют', 'источников требуют')} `
      + `внимания. ${first.join('; ')}${bad.length > 3 ? '; …' : ''}. Открыть экран «Входные данные»`,
  };
}

// Что система делает с каждым случаем — простыми словами (показывается на экране)
export const CASES = [
  ['Повтор', 'та же запись пришла ещё раз — отсеяна, в истории одна.'],
  ['Опоздание', 'хранятся оба времени — когда случилось и когда пришло; история пересобрана по времени события.'],
  ['Пропуск нумерации', 'виден сразу по номерам источника; досылка закрывает пропуск.'],
  ['Нет обязательного поля', 'отказ с кодом причины: источник знает, что исправить.'],
  ['Чужая или неверная подпись', 'карантин: в историю не попадает, исходные байты хранятся для разбора.'],
  ['Расхождение часов', 'время источника и время приёма хранятся оба, запись помечена.'],
];
