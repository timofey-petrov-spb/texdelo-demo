// Справка «?» (SPEC.md 3.11): пять вкладок, в каждой не больше 600 знаков — «Знаки и цвета», «Что такое запас»,
// «Кто что делает», «Клавиши», «О стенде» (всё служебное: демо-стенд, круг, скорость, запись журнала, версия правил,
// событий в минуту, «текущий круг / вся смена»). Объяснения живут здесь, а не на рабочих экранах.
// Тексты — helpTabs(app) без DOM: длину вкладок проверяет node --test.

import { clear, h } from './dom.js';
import { ZONES } from './format.js';
import { thresholdsText } from './header.js';
import { roleTitle } from './texts.js';
import { SCREEN_TITLES, WORKPLACES } from './words.js';

export const HELP_LIMIT = 600;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Кто что делает — одной строкой на роль (подробнее — строка «что делаю» в меню роли)
const ROLE_SHORT = {
  controller: 'приёмка, клеймо, карточки, удержание',
  qc_head: 'значительные и критические несоответствия',
  foreman: '«стоп», удержания, исправления к сроку',
  technologist: 'уход режима и его причины',
  shift_supervisor: '«стоп», который вовремя не приняли',
  metrologist: 'поверка, прибор под сомнением',
  manager: 'что остановили и где, показатели',
  design_authority: 'ремонт и разрешения на отклонение',
  customer_rep: 'дело изделия и пакет доказательств',
  admin: 'целостность журнала, приём данных',
};

// Знаки: цвет + форма + слово; норма — серым, зелёного нет
export const SIGNS = [
  [ZONES.with_margin.icon, 'Норма, с запасом, принято ОТК — серым, без цвета', 'with_margin'],
  [ZONES.margin_reduced.icon, 'Уход режима, запас снижен, внимание', 'margin_reduced'],
  [ZONES.near_limit.icon, 'Решение: карточка ждёт, деталь удержана или у границы', 'near_limit'],
  [ZONES.beyond_limit.icon, 'Стоп: нужно действие сейчас; признаки несоответствия', 'beyond_limit'],
  [ZONES.not_assessable.icon, 'Оценка невозможна: нет надёжного результата', 'not_assessable'],
  [ZONES.not_checked.icon, 'Не проверено: точка впереди или пропущена', 'not_checked'],
  ['⏸', 'Удержана: дальше по маршруту не идёт', 'with_margin'],
];

function eventsPerMin(app) {
  let n = 0;
  for (const l of app.state?.lines?.values?.() || []) n += Number(l.totals?.events_per_min) || 0;
  return n;
}

// Вкладки справки: [{ key, title, text: [абзацы] }]
export function helpTabs(app) {
  const v = app.version || {};
  const where = app.mode === 'demo' ? 'Демо-сюжет без ядра: записанный поток событий проигрывается в браузере, время ускорено.'
    : v.mode === 'dev' ? 'Демо-стенд: ядро в режиме dev, события присылает эмулятор участков, смена сжата до 5,5 минуты.'
      : 'Живая линия: события участков записываются в журнал ядра и приходят на табло потоком.';
  const roles = Object.keys(WORKPLACES).map((id) => `${cap(roleTitle(id))} — ${ROLE_SHORT[id]}`);
  return [
    { key: 'signs', title: 'Знаки и цвета', text: [
      'Серое — значит в норме. Цвет получает только то, что ждёт человека; каждый статус — цвет, форма знака и слово, '
        + 'поэтому экран читается и без различения цветов. Зелёного нет.',
    ], signs: SIGNS },
    { key: 'margin', title: 'Что такое запас', text: [
      'Запас — расстояние от значения до ближайшей границы допуска в процентах половины поля: 100 % — середина поля, '
        + '0 % — граница. Рядом — то же в единицах (мм, Н·м).',
      `Сейчас ${thresholdsText(app)}: это настройка технолога для раннего предупреждения, а не граница приёмки.`,
      'Зона не принимает и не бракует: принимает инженер ОТК своим клеймом. Сводного балла нет: одно число спрятало бы, '
        + 'что проверено не всё.',
    ] },
    { key: 'roles', title: 'Кто что делает', text: roles },
    { key: 'keys', title: 'Клавиши', text: [
      `1 — ${SCREEN_TITLES.line}, 2 — ${SCREEN_TITLES.otk}, 3 — ${SCREEN_TITLES.escape}.`,
      'P — пауза показа: экран застывает, значки и часы идут; ещё раз P — догнать одним обновлением.',
      'Esc — закрыть журнал, окно или панель карточки. ↑ ↓ — соседняя деталь в приёмке.',
      `F — на весь экран, T — тема, ? — справка${app.mode === 'demo' ? ', пробел — пауза записанного сюжета' : ''}.`,
      'В поле ввода клавиши не работают.',
    ] },
    { key: 'about', title: 'О стенде', text: [
      where,
      `Запись журнала № ${app.state?.seq || 0}; событий в минуту: ${eventsPerMin(app)}.`,
      v.rules_version ? `Правила ${v.rules_version}${v.rules_fingerprint ? `, отпечаток ${String(v.rules_fingerprint).slice(0, 12)}` : ''}.` : '',
      'Детали повторного круга сюжета имеют метку круга; на экранах по умолчанию — только текущий круг.',
      'Лестница утечки, прогон по истории и коэффициенты стоимости — оценка команды, не норма.',
    ].filter(Boolean) },
  ];
}

export function tabLength(tab) {
  return [...tab.text, ...(tab.signs || []).map((s) => s[1])].join(' ').length;
}

export function openHelp(app, key = 'signs') {
  const dlg = document.getElementById('help-dlg');
  if (!dlg) return;
  const tabs = helpTabs(app);
  const close = h('button', { class: 'icon-btn help-close', type: 'button', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть справку',
    text: '×', onclick: () => dlg.close() });
  const bar = h('div', { class: 'help-tabs', role: 'tablist', 'aria-label': 'разделы справки' });
  const body = h('div', { class: 'help-body', role: 'tabpanel' });
  const lap = () => h('label', { class: 'help-lap' }, [h('input', { type: 'checkbox', checked: app.lapFilter === 'all', onchange: (e) => {
    app.lapFilter = e.target.checked ? 'all' : 'current';
    app.onLapFilter?.();
  } }), ' Показывать всю смену, а не только текущий круг']);
  function show(k) {
    const t = tabs.find((x) => x.key === k) || tabs[0];
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.key === t.key));
    clear(body).append(h('h2', { text: t.title }), ...t.text.map((p) => h('p', { text: p })),
      ...(t.signs || []).map(([icon, text, z]) => h('div', { class: `help-st z-${z}` }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: icon }),
        h('span', { text })])),
      ...(t.key === 'about' ? [lap()] : []));
  }
  bar.append(...tabs.map((t) => h('button', { type: 'button', role: 'tab', dataset: { key: t.key }, text: t.title, onclick: () => show(t.key) })));
  clear(dlg).append(h('div', { class: 'help-in' }, [close, bar, body]));
  show(key);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  close.focus();
}
