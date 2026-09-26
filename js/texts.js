// Один справочник текстов табло: подписи решений (по action и disposition), ролей, внешних систем и квитанций.
// Экран не переводит коды решений своим словарём (DOMAIN §8.1): он берёт готовую строку allowed_actions,
// а отсюда — только подпись кнопки. Без DOM — проверяется node --test.

// Подпись кнопки — по action; для set_disposition — по disposition
export const ACTION_TEXTS = {
  accept: 'Принять ОТК',
  accept_after_rework: 'Принять ОТК после доработки',
  return_for_rework: 'Вернуть на доработку',
  hold: 'Удержать',
  release: 'Снять удержание',
  approve: 'Согласовать',
  decline: 'Отказать в согласовании',
  take_review: 'Беру в работу',
  confirm: 'Подтвердить несоответствие',
  not_confirmed: 'Не подтверждено — сигнал ложный',
  request_recheck: 'Назначить дополнительный контроль',
  set_disposition: 'Решение по несоответствию',
  confirm_hypothesis: 'Подтвердить версию причины',
  refute_hypothesis: 'Отвергнуть версию причины',
  start_correction: 'Поручить исправить на месте, со сроком',
  correction_done: 'Исправлено',
  recheck_affected: 'Перепроверить затронутые изделия',
  stop_operation: 'Остановить операцию и вызвать технолога',
  link_event: 'Привязать событие к изделию',
};

// Решения по несоответствующей продукции — ГОСТ Р ИСО 9000-2015, п. 3.12
export const DISPOSITION_TEXTS = {
  rework: 'переделка',
  repair: 'ремонт',
  concession: 'разрешение на отклонение',
  regrade: 'изменение градации',
  scrap: 'перевод в отходы',
  return_to_supplier: 'возврат поставщику',
};

// Как решение звучит в записи: «удержано», «принято ОТК»
export const ACTION_DONE = {
  accept: 'принято ОТК',
  accept_after_rework: 'принято после доработки',
  return_for_rework: 'возвращено на доработку',
  hold: 'удержано',
  release: 'удержание снято',
  approve: 'согласовано',
  decline: 'в согласовании отказано',
  take_review: 'взято в работу',
  confirm: 'несоответствие подтверждено',
  not_confirmed: 'не подтверждено',
  request_recheck: 'назначен дополнительный контроль',
  set_disposition: 'решение по несоответствию',
  stop_operation: 'операция остановлена',
  start_correction: 'поручено исправить на месте',
  correction_done: 'исправлено',
};

// Решения, которые без причины не записываются: человек объясняет, почему
export const NEEDS_REASON = new Set([
  'hold', 'release', 'return_for_rework', 'confirm', 'not_confirmed', 'request_recheck', 'set_disposition', 'decline',
  'confirm_hypothesis', 'refute_hypothesis', 'stop_operation', 'start_correction', 'link_event',
]);

export const REASON_PROMPTS = {
  hold: 'Причина удержания',
  release: 'Почему снимаете удержание',
  return_for_rework: 'Что доработать',
  stop_operation: 'Почему остановлена операция',
};

// Роли — как говорят в цеху (DOMAIN §1)
export const ROLE_TITLES = {
  controller: 'инженер ОТК',
  foreman: 'мастер участка',
  technologist: 'технолог',
  manager: 'руководитель производства',
  admin: 'администратор',
  qc_head: 'начальник ОТК',
  design_authority: 'держатель КД',
  customer_rep: 'представитель заказчика',
  shift_supervisor: 'начальник смены',
  metrologist: 'метролог',
};

// Виды дефектов — как в справочнике подписей ядра (qc/reports/labels.py); сварочные несовершенства —
// термины ГОСТ Р ИСО 6520-1-2012 (lack_of_fusion — «несплавление», код 401)
export const DEFECT_TEXTS = {
  crack: 'трещина', pore: 'пора', lack_of_fusion: 'несплавление', undercut: 'подрез', scratch: 'риска', dent: 'вмятина',
  dimension_out_of_tolerance: 'размер вне допуска', surface_roughness: 'шероховатость вне требований', burr: 'заусенец',
  missing_part: 'некомплект', wrong_torque: 'момент затяжки вне допуска', connector_damage: 'повреждение соединителя',
  functional_test_failure: 'отказ функциональной проверки', chip: 'скол', nick: 'забоина',
  incomplete_penetration: 'непровар (402)', // внутренний дефект: камера при закрытом доступе его не видит
  excess_weld_metal: 'превышение выпуклости', burn_through: 'прожог', misalignment: 'смещение кромок',
  form_deviation: 'отклонение формы и расположения',
};

// Вид дефекта в имени карточки: «Подрез шва · БД-01-0114» (SPEC.md 3.6, 7.13); нет здесь — слово DEFECT_TEXTS
export const CARD_DEFECT_NAMES = {
  undercut: 'Подрез шва', pore: 'Пора в шве', lack_of_fusion: 'Несплавление шва', crack: 'Трещина',
  incomplete_penetration: 'Непровар в корне шва', excess_weld_metal: 'Превышение выпуклости шва', burn_through: 'Прожог шва',
  misalignment: 'Смещение кромок', dimension_out_of_tolerance: 'Размер вне допуска',
  surface_roughness: 'Шероховатость вне требований', wrong_torque: 'Момент затяжки вне допуска',
  functional_test_failure: 'Отказ функциональной проверки', connector_damage: 'Повреждение соединителя',
  missing_part: 'Некомплект',
};

// Участки и места — как в справочнике dataset/reference/stations.yaml, но короче: «где сейчас», тексты ядра
export const PLACE_TEXTS = {
  'ST-IN': 'входной контроль', 'ST-TURN': 'токарный участок', 'ST-WELD': 'сварочный участок',
  'ST-ASSY': 'сборочный участок', 'ST-TEST': 'участок испытаний', 'ST-QA': 'приёмочный контроль',
  STORE: 'склад готовой продукции', SHIPPED: 'отгружено получателю', ISOLATOR: 'изолятор несоответствующей продукции',
};
// Те же места в ответе на «где?»: «начата операция на сборочном участке»
export const PLACE_WHERE = {
  'ST-IN': 'входном контроле', 'ST-TURN': 'токарном участке', 'ST-WELD': 'сварочном участке',
  'ST-ASSY': 'сборочном участке', 'ST-TEST': 'участке испытаний', 'ST-QA': 'приёмочном контроле',
  STORE: 'складе готовой продукции', ISOLATOR: 'изоляторе несоответствующей продукции',
};

// Точки контроля маршрута (dataset/reference/route.yaml)
export const CP_TEXTS = {
  'CP-IN': 'входной контроль', 'CP-TURN': 'ОТК после токарной', 'CP-WELD': 'ОТК сварки',
  'CP-FUNC': 'проверка функционирования', 'CP-HIDDEN': 'контроль скрытых работ', 'CP-QA': 'приёмочный контроль',
  'CP-ACCEPT': 'клеймо ОТК',
};

// Характеристики (dataset/reference/characteristics.yaml): код — словами, как в названии характеристики у ядра,
// без обозначения допуска — на одном профиле одна характеристика называется одинаково
export const CHAR_TEXTS = {
  'K01-BORE-D20': 'диаметр посадочного отверстия под датчик', 'K01-LENGTH-45': 'длина корпуса',
  'KR01-WELD-LEG': 'катет сварного шва кронштейна', 'KR01-WELD-5011': 'глубина подреза шва кронштейна',
  'BD01-TORQUE-DD': 'момент затяжки крепежа датчика', 'PE01-SUPPLY-CURRENT': 'ток потребления платы',
};

// Методы контроля (dataset/reference/methods.yaml) и средства измерений (instruments.yaml, characteristics.yaml)
export const METHOD_TEXTS = {
  visual_camera: 'визуальный с камерой и анализатором', weld_profilometer: 'лазерный профилометр шва',
  measuring: 'измерительный', roughness: 'шероховатость', torque_channel: 'канал датчика момента',
  function_stand: 'стенд функциональной проверки', ndt: 'неразрушающий контроль',
};
export const INSTRUMENT_TEXTS = {
  'PNM-01': 'пневматический измеритель отверстий', 'PRF-01': 'лазерный профилометр шва', 'MIC-01': 'микрометр',
  'CAL-02': 'штангенциркуль', 'TST-01': 'стенд функциональной проверки платы', 'TQM-01': 'канал измерения момента',
};

// Ступени анализатора камеры (DOMAIN §13.3) и виды изображений (§13.4)
export const STAGE_TEXTS = {
  detector: 'Детектор отклонения', classifier: 'Классификатор вида', measurement: 'Измерение',
  quality: 'Качество наблюдения',
};
export const EVIDENCE_TEXTS = { reference: 'эталон', observed: 'снимок детали', overlay: 'с признаками' };

// Каналы оповещения (DOMAIN §14.1)
export const CHANNEL_TEXTS = { workstation: 'рабочее место', mes_terminal: 'терминал MES', mail: 'внутренняя почта' };

export const SYSTEM_TITLES = { MES: 'MES', '1C': '1С', GALAKTIKA: 'Галактика', KOMPAS: 'КОМПАС-3D' };

// Квитанция внешней системы (события v1.2): статус — цвет, знак и подпись
export const RECEIPT_STATUS = {
  delivered: { label: 'доставлено, ждёт исполнения', icon: '○', tone: 'none' },
  accepted: { label: 'исполнено', icon: '✓', tone: 'ok' },
  refused: { label: 'отказ системы', icon: '!', tone: 'serious' },
  error: { label: 'сбой обмена — не исполнено', icon: '✕', tone: 'critical' },
};

export function roleTitle(role) {
  return ROLE_TITLES[role] || String(role || '');
}

export function systemTitle(system) {
  return SYSTEM_TITLES[system] || String(system || '');
}

export function receiptStatus(status) {
  return RECEIPT_STATUS[status] || { label: String(status || 'статус не сообщён'), icon: '?', tone: 'none' };
}

// ---------- словарь решений (SPEC.md раздел 4) ----------
// Подпись зависит от цели, кода и роли, а не только от кода: «Выпустить по разрешению на отклонение», а не «Снять
// удержание»; «Повторное предъявление принято» на карточке, а не клеймо детали; у технолога «Предупреждающее
// действие нужно», у представителя заказчика «Уведомление получено». У каждого варианта — глагол (label), что будет
// (what), кто дальше (next), нужна ли причина, срок, категория, где кнопка (place) и готовые причины (reasons).

// Категория дефекта (ГОСТ 15467-79): значение поля defect_category → слово
export const CATEGORY_TEXTS = { minor: 'малозначительный', major: 'значительный', critical: 'критический' };
export const CATEGORY_ORDER = ['minor', 'major', 'critical'];
export const CATEGORY_NONE = 'категория не установлена';

export function categoryTitle(code) {
  return CATEGORY_TEXTS[code] || CATEGORY_NONE;
}

// Роли в дательном падеже: «инженеру ОТК», «мастеру участка» (SPEC.md 7.11)
export const ROLE_DATIVE = {
  controller: 'инженеру ОТК', qc_head: 'начальнику ОТК', foreman: 'мастеру участка', technologist: 'технологу',
  shift_supervisor: 'начальнику смены', metrologist: 'метрологу', design_authority: 'держателю КД',
  customer_rep: 'представителю заказчика', manager: 'руководителю производства', admin: 'администратору',
};

// Рабочие места стенда → роль: «QC-01» → controller (роль приходит то кодом, то рабочим местом)
const SEAT_ROLES = {
  QC: 'controller', QH: 'qc_head', FM: 'foreman', TE: 'technologist', SS: 'shift_supervisor', MT: 'metrologist',
  KD: 'design_authority', VP: 'customer_rep', MG: 'manager', AD: 'admin',
};

export function roleCode(role) {
  const r = typeof role === 'object' && role ? role.role || role.code || role.id || '' : String(role || '');
  if (ROLE_TITLES[r]) return r;
  const seat = /^([A-Z]{2})-\d+$/.exec(r);
  return (seat && SEAT_ROLES[seat[1]]) || r;
}

const TARGETS = { item: 'item', nonconformance: 'nonconformance', card: 'nonconformance', nc: 'nonconformance',
  warning: 'warning', notification: 'warning', hypothesis: 'hypothesis', lot: 'lot' };

function targetKind(target) {
  const t = typeof target === 'object' && target ? target.kind : target;
  return TARGETS[t] || String(t || '');
}

function codeOf(code) {
  if (code && typeof code === 'object') return [code.kind, code.action, code.disposition].filter(Boolean).join(':');
  return String(code || '').trim();
}

const BY_CATEGORY = 'по категории: малозначительный — инженер ОТК, значительный и критический — начальник ОТК';

// Ключ: «цель|код» или «цель|код|роль»; цель «*» — для любой цели
const D = (label, what, next, reason, extra = {}) => ({ label, what, next, reason, ...extra });
const DECISIONS = {
  // по детали (4.2)
  'item|acceptance:accept': D('Принять ОТК', 'Клеймо с вашей подписью; квитанции в MES и 1С; деталь уходит на склад.',
    '', 'none', { place: 'нижняя панель детали', main: true, when: 'все условия выполнены' }),
  'item|acceptance:accept_after_rework': D('Принять ОТК после доработки', 'Клеймо «принято после доработки».', '',
    'none', { place: 'нижняя панель детали', main: true, when: 'карточки закрыты доработкой, новое наблюдение чистое' }),
  'item|acceptance:return_for_rework': D('Вернуть на доработку',
    'Не принимаю: исполнитель переделывает и предъявляет снова. Деталь не удерживается, карточка не открывается.',
    'мастер участка', 'required', { place: 'окно «Решение по приёмке»', prompt: 'Что доработать',
      reasons: ['Зачистить и предъявить', 'Размер у границы', 'Нет документа'] }),
  'item|correction:start_correction': D('Поручить исправить на месте, со сроком',
    'Мелкое исправление здесь же; мастер отмечает «Исправлено» к сроку. Не отметит — придёт предупреждение «исправление просрочено».',
    'мастер участка', 'required', { due: true, place: 'окно «Решение по приёмке»', prompt: 'Что исправить',
      reasons: ['Зачистить заусенец', 'Подтянуть крепёж', 'Дооформить документ'] }),
  'item|correction:correction_done': D('Исправлено', 'Поручение закрыто; деталь ждёт повторного контроля.', 'инженер ОТК',
    'none', { place: 'строка поручения' }),
  'item|hold:hold': D('⏸ Удержать деталь',
    'Деталь остановится на месте: MES не даст следующую операцию, клеймо поставить нельзя. Это не решение о качестве.',
    'снять удержание может инженер ОТК', 'required', { place: 'шапка детали', prompt: 'Причина удержания',
      reasons: ['Пропуск контроля', 'Ждём повторный замер', 'Сомнение в приборе', 'Ждём решения технолога',
        'До решения по карточке'] }),
  'item|hold:release': D('Снять удержание', 'MES снова пустит деталь. Карточки и предупреждения останутся.', '',
    'required', { place: 'шапка детали', prompt: 'Почему снимаете удержание',
      reasons: ['Повторный замер в норме', 'Решение по карточке принято', 'Прибор проверен'] }),
  'item|containment:stop_operation': D('Остановить операцию и вызвать технолога',
    'Операция остановлена, технолог получает оповещение.', 'технолог', 'required',
    { place: 'меню шапки детали', prompt: 'Что не так в операции' }),
  'item|approval:approve': D('Согласовать приёмку заказчиком', 'Записана приёмка заказчика.', '', 'none',
    { place: 'кабинет ролей' }),
  'item|approval:decline': D('Отказать в приёмке заказчиком', 'Приёмка заказчика не записана; деталь ждёт решения.', '',
    'required', { place: 'кабинет ролей' }),
  'item|identification:link_event': D('Привязать событие к детали', 'Запись участка будет отнесена к этой детали.', '',
    'required', { place: 'кабинет ролей' }),

  // по карточке (4.3)
  'nonconformance|review:take_review': D('Беру в работу',
    'Вы рассматриваете сигнал; оповещение по карточке считается полученным.', 'вы', 'none', { when: 'пришёл сигнал' }),
  'nonconformance|review:take_review|customer_rep': D('Уведомление получено',
    'Записано: заказчик получил уведомление о значительном несоответствии.', '', 'none'),
  'nonconformance|review:confirm': D('Подтвердить несоответствие', 'Карточка перейдёт в «подтверждено».',
    'малозначительный — инженер ОТК; значительный и критический — начальник ОТК', 'required', { category: true,
      when: 'признаки подтвердились',
      reasons: ['Признаки подтверждены повторным осмотром', 'Подтверждено измерением',
        'Подтверждено неразрушающим контролем'] }),
  'nonconformance|review:confirm|technologist': D('Предупреждающее действие нужно',
    'Отметка технолога: нужно предупреждающее действие, чтобы несоответствие не повторилось.', '', 'required',
    { when: 'после разрешения на отклонение или изменения градации' }),
  'nonconformance|review:not_confirmed': D('Не подтверждено — сигнал ложный',
    'Карточка закроется; снимок уйдёт в разметку для дообучения анализатора.', '', 'required',
    { when: 'признаков нет', reasons: ['Ложный сигнал: блик или загрязнение', 'Повторный контроль без признаков дефекта',
      'Сигнал относится к другой детали'] }),
  'nonconformance|review:not_confirmed|technologist': D('Предупреждающее действие не нужно',
    'Отметка технолога: предупреждающее действие не нужно.', '', 'required'),
  'nonconformance|review:request_recheck': D('Назначить дополнительный контроль',
    'Одного наблюдения мало: «нужен дополнительный контроль», после нового наблюдения — снова на рассмотрении.',
    'инженер ОТК', 'required', { reasons: ['Качество снимка ниже порога', 'Нужен неразрушающий контроль',
      'Два источника противоречат друг другу'] }),
  'nonconformance|disposition:set_disposition:rework': D('Решение: переделка',
    'Деталь на повторное предъявление; больше двух переделок — отметка превышения.',
    'мастер участка, затем инженер ОТК', 'required', { reasons: ['Дефект устраним переделкой по технологии'] }),
  'nonconformance|disposition:set_disposition:repair': D('Решение: ремонт',
    'Устранимо, но не до полного соответствия: карточка ждёт согласования.', 'держатель КД', 'required',
    { reasons: ['Устранение ремонтом по методу, согласованному с держателем КД'] }),
  'nonconformance|disposition:set_disposition:concession': D('Решение: разрешение на отклонение',
    'Отклонение не влияет на работу изделия: карточка ждёт согласования.',
    'держатель КД (и представитель заказчика, если приёмка заказчика)', 'required',
    { reasons: ['Отклонение не влияет на функцию — нужны согласования'] }),
  'nonconformance|disposition:set_disposition:regrade': D('Решение: изменение градации',
    'Годится для другого применения: карточка закроется.', 'технолог — решить о предупреждающем действии', 'required',
    { reasons: ['Деталь пригодна для другого применения'] }),
  'nonconformance|disposition:set_disposition:scrap': D('Решение: перевод в отходы',
    'Неустранимо: деталь — в изолятор.', 'мастер участка — перенести деталь в изолятор', 'required',
    { reasons: ['Дефект неустраним'] }),
  'nonconformance|disposition:set_disposition:return_to_supplier': D('Решение: возврат поставщику',
    'Несоответствие покупного изделия: рекламация поставщику.', 'инженер ОТК', 'required',
    { reasons: ['Дефект покупного изделия — рекламация поставщику'] }),
  'nonconformance|disposition:release': D('Выпустить по разрешению на отклонение',
    'Всё согласовано: деталь выпускается, карточка закроется.', '', 'none'),
  'nonconformance|acceptance:accept_after_rework': D('Повторное предъявление принято',
    'После переделки наблюдение чистое: карточка закроется. Клеймо детали ставится отдельно.',
    'инженер ОТК — клеймо детали', 'none'),
  'nonconformance|acceptance:return_for_rework': D('Повторное предъявление не принято',
    'Переделка не помогла: карточка снова «подтверждено».', BY_CATEGORY, 'required',
    { reasons: ['При повторном предъявлении дефект сохранился'] }),
  'nonconformance|containment:stop_operation': D('Не начинать следующую операцию, пока карточка открыта',
    'Ворота переносятся на ближайшую операцию: начнут её — «стоп» мастеру и ОТК. MES остановит операцию, которая идёт сейчас.',
    '', 'required',
    { when: 'карточка некритичная, но ждать нельзя' }),
  'nonconformance|hold:hold': D('Удержать деталь по этой карточке',
    'MES не даст следующую операцию, клеймо поставить нельзя. Это не решение о качестве.',
    'снять удержание может инженер ОТК', 'required', { reasons: ['До решения по карточке'] }),
  'nonconformance|hold:release': D('Снять удержание', 'MES снова пустит деталь. Карточка остаётся.', '', 'required',
    { reasons: ['Решение по карточке принято'] }),
  'nonconformance|approval:approve': D('Согласовать', 'Согласие записано; когда согласуют все — «согласовано».', '',
    'none', { place: 'кабинет ролей' }),
  'nonconformance|approval:decline': D('Отказать в согласовании',
    'Карточка вернётся в «подтверждено»: нужно другое решение.', BY_CATEGORY, 'required', { place: 'кабинет ролей' }),
  '*|hypothesis:confirm_hypothesis': D('Подтвердить версию причины',
    'Версия причины подтверждена; исполнитель не назначается, пока причину не подтвердил технолог.', '', 'required',
    { place: 'кабинет ролей' }),
  '*|hypothesis:refute_hypothesis': D('Отвергнуть версию причины', 'Версия причины отвергнута.', '', 'required',
    { place: 'кабинет ролей' }),

  // по оповещению и предупреждению (4.4)
  'warning|review:take_review': D('Получил', 'Эскалация остановится; в журнале запишется, кто и когда получил.', '',
    'none', { place: 'строка «Требует действия»',
      hint: 'Вы получили оповещение: эскалация остановится, в журнале запишется, кто и когда' }),
  'warning|review:take_review|customer_rep': D('Уведомление получено',
    'Записано: заказчик получил уведомление; эскалация остановится.', '', 'none', { place: 'строка «Требует действия»' }),
  'warning|containment:release': D('Снять «стоп» по процессу',
    'Режим восстановлен. Удержания деталей останутся — их снимает инженер ОТК.', '', 'required',
    { place: 'участок, «Что делать»', reasons: ['Резец заменён, первая деталь в норме', 'Режим восстановлен'] }),
};

const UNKNOWN = 'Решение без названия на табло';
const warned = new Set();

// Подпись и пояснения решения. target — вид цели ('item' | 'nonconformance' | 'warning' или { kind }), code —
// строка allowed_actions («review:confirm», «disposition:set_disposition:rework») или разобранное решение,
// role — код роли или рабочее место («QC-01»). Ответ: { label, what, next, reason: 'none' | 'required', due,
// category, place, reasons, prompt, hint, when, main, known }. Неизвестный код — «Решение без названия на табло»
// и запись в консоль (один раз на код).
export function decisionText(target, code, role) {
  const t = targetKind(target);
  const c = codeOf(code);
  const r = roleCode(role);
  const hit = DECISIONS[`${t}|${c}|${r}`] || DECISIONS[`${t}|${c}`] || DECISIONS[`*|${c}|${r}`] || DECISIONS[`*|${c}`];
  const base = { label: UNKNOWN, what: '', next: '', reason: 'required', due: false, category: false, place: '',
    reasons: [], prompt: '', hint: '', when: '', main: false, known: false, code: c };
  if (!hit) {
    const key = `${t}|${c}`;
    if (!warned.has(key)) {
      warned.add(key);
      globalThis.console?.warn?.(`табло: решения «${c}» (цель ${t || '—'}) нет в словаре texts.js`);
    }
    return base;
  }
  return { ...base, prompt: hit.reason === 'required' ? 'Причина' : '', ...hit, due: !!hit.due,
    category: !!hit.category, reasons: hit.reasons || [], known: true };
}

// Все ключи словаря «цель|код» — для сторожа текста
export function decisionCodes() {
  return [...new Set(Object.keys(DECISIONS).map((k) => k.split('|').slice(0, 2).join('|')))];
}

// Есть ли код в словаре для этой цели (для теста «каждый код демо-профилей есть в словаре»)
export function knownDecision(target, code) {
  const t = targetKind(target);
  const c = codeOf(code);
  return Object.keys(DECISIONS).some((k) => k.startsWith(`${t}|${c}`) || k.startsWith(`*|${c}`));
}
