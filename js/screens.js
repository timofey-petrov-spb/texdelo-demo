// Экраны разбора в роутере табло (js/ui.js) и вкладки строки статуса по роли (SPEC.md 2.4): видимых не больше
// четырёх, остальное — «Ещё ▾». Вкладка — подсказка, а не право: право проверяет ядро, экран показывает его отказ.
// У держателя КД, представителя заказчика и администратора — экран «Рабочее место — в кабинете ролей» (3.12).

import { clear, h } from './dom.js';
import { mountEscape } from './escape_screen.js';
import { mountMetrology } from './metrology_screen.js';
import { mountSandbox } from './sandbox_screen.js';
import { mountSuppliers } from './suppliers_screen.js';
import { CABINET_URL, SCREEN_TITLES, tabsFor, workplace } from './words.js';

// «Прогон по истории» — только ролям, у которых есть эта вкладка (QA В-27): по прямому адресу остальным — пояснение
function onlyForTab(kind, mount) {
  return (root, app) => {
    const { tabs, more } = tabsFor(app.role?.id);
    if (app.role?.id === 'token' || [...tabs, ...more].some((t) => t.kind === kind)) return mount(root, app);
    root.append(h('section', { class: 'panel cabinet' }, [
      h('h2', { class: 'cab-h', text: `«${SCREEN_TITLES[kind]}» — не на вашем рабочем месте` }),
      h('p', { class: 'muted', text: 'Этот экран — у технолога и начальника ОТК: новые настройки прогоняются по прошлой истории.' }),
      h('a', { class: 'btn btn-primary cab-go', href: `#/${workplace(app.role?.id).start || 'line'}`, text: 'Вернуться на свой экран' }),
    ]));
    return { update() {}, roleChanged() {} };
  };
}

export const EXTRA_ROUTES = {
  escape: mountEscape,
  sandbox: onlyForTab('sandbox', mountSandbox),
  metrology: mountMetrology,
  suppliers: mountSuppliers,
};

export function screenTitle(kind) {
  return SCREEN_TITLES[kind] || SCREEN_TITLES.line;
}

let moreBound = false;
function bindMore() {
  if (moreBound) return;
  moreBound = true;
  document.addEventListener('click', (e) => {
    const b = document.getElementById('tabs-more');
    const m = document.getElementById('tabs-more-menu');
    if (m && !m.hidden && !m.contains(e.target) && e.target !== b) {
      m.hidden = true;
      b?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    const m = document.getElementById('tabs-more-menu');
    if (e.key === 'Escape' && m && !m.hidden) m.hidden = true;
  });
}

// Вкладки для выбранной роли; активная — по адресу (деталь и участок — без активной вкладки)
export function renderNav(app) {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const w = workplace(app.role?.id);
  const { tabs, more } = w.cabinet ? { tabs: [], more: [] } : tabsFor(app.role?.id);
  const sig = [...tabs, ...more].map((t) => t.kind).join(',') + (more.length ? '|m' : '');
  if (nav.dataset.sig !== sig) {
    nav.dataset.sig = sig;
    clear(nav);
    for (const t of tabs) nav.append(h('a', { href: `#/${t.kind}`, dataset: { kind: t.kind }, title: t.title, text: t.label }));
    if (more.length) {
      const btn = h('button', { class: 'tab-more', id: 'tabs-more', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
        title: 'Другие экраны разбора' }, ['Ещё ', h('span', { 'aria-hidden': 'true', text: '▾' })]);
      const menu = h('div', { class: 'tabs-menu', id: 'tabs-more-menu', role: 'menu', hidden: true },
        more.map((t) => h('a', { class: 'menu-i', role: 'menuitem', href: `#/${t.kind}`, dataset: { kind: t.kind }, title: t.title,
          text: t.label, onclick: () => {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
          } })));
      btn.onclick = (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
      };
      bindMore();
      nav.append(h('span', { class: 'tab-more-box' }, [btn, menu]));
    }
  }
  markNav();
}

export function markNav() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const kind = (location.hash || '').replace(/^#\/?/, '').split('/')[0] || 'line';
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.kind === kind);
  const inMore = !!nav.querySelector(`.tabs-menu a[data-kind="${kind}"]`);
  const more = document.getElementById('tabs-more');
  if (more) {
    more.classList.toggle('active', inMore);
    more.firstChild.textContent = inMore ? `${screenTitle(kind)} ` : 'Ещё ';
  }
}

// Экран вместо ошибки 403: у роли нет права читать линию, её рабочее место — кабинет ролей (Streamlit)
// Что именно ждёт человека в кабинете — по роли (QA В-37)
const CABINET_TEXT = {
  design_authority: 'Ваши согласования ремонта и разрешения на отклонение — в кабинете ролей.',
  customer_rep: 'Дело изделия, согласования и проверка пакета доказательств — в кабинете ролей.',
  admin: 'Целостность журнала и приём данных — в кабинете ролей.',
};

export function mountCabinet(root, app) {
  const r = app.role || {};
  const doing = workplace(r.id).doing;
  root.append(h('section', { class: 'panel cabinet', 'aria-label': 'рабочее место' }, [
    h('h2', { class: 'cab-h', text: 'Ваше рабочее место — в кабинете ролей' }),
    h('p', { class: 'cab-who', text: [r.name || r.title, doing ? doing.toLowerCase() : ''].filter(Boolean).join(': ') + '.' }),
    h('p', { class: 'muted', text: `Табло показывает цех: линию, приёмку и остановленные несоответствия. ${CABINET_TEXT[r.id] || CABINET_TEXT.design_authority}` }),
    // роль — в адресе кабинета, чтобы не выбирать её заново (кабинет читает ?role=, Codex X32)
    h('a', { class: 'btn btn-primary cab-go', href: `${CABINET_URL}/?role=${encodeURIComponent(r.actor || r.id || '')}`, target: '_blank', rel: 'noopener',
      title: `Кабинет ролей: ${CABINET_URL}`, text: 'Открыть кабинет ролей ↗' }),
  ]));
  return { update() {}, roleChanged() {} };
}

// ---------- экраны отказа: нет ядра, нет демо, вход по токену ----------
export function demoHref(loc) {
  const q = new URLSearchParams(loc.search);
  q.delete('api');
  q.set('demo', '1');
  return `?${q}${loc.hash || '#/line'}`;
}

export function errorPanel(e, where, retry, demoLink) {
  const code = Number(e?.status) || 0;
  const hint = code === 401 || code === 403
    ? 'Ядро не приняло токен роли. Выберите другое рабочее место в меню роли или введите действующий токен.'
    : code >= 500 ? 'Сбой в ядре — смотрите его журнал.' : code ? 'Ядро ответило ошибкой.' : 'Ядро по этому адресу не отвечает.';
  return h('div', { class: 'panel pf-error core-error' }, [
    h('h2', { text: code ? `Ядро ответило ${code}` : 'Нет связи с ядром' }),
    h('p', { text: [e?.detail || e?.message, `адрес ${where}`].filter(Boolean).join('; ') }),
    h('p', { class: 'muted', text: hint }),
    h('div', { class: 'acc-row' }, [
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Повторить', onclick: retry }),
      h('a', { class: 'btn', href: demoLink, text: 'Открыть демо-сюжет' }),
    ]),
  ]);
}

// Ядро работает, но ролей с токенами не раздаёт (режим strict, ядро без API v1.3, запрос не с самого сервера):
// табло не подменяет живую линию записью — просит токен роли
export function tokenPanel(why, where, demoLink) {
  return h('div', { class: 'panel pf-error core-error' }, [
    h('h2', { text: 'Вход по токену роли' }),
    h('p', { text: `Ядро на связи (${where}), но роли рабочих мест не выдаёт: ${why}.` }),
    h('p', { class: 'muted', text: 'Введите токен своей роли в меню роли в строке статуса — его выдаёт администратор. '
      + 'Табло подключится к живой линии сразу после ввода.' }),
    h('div', { class: 'acc-row' }, [h('a', { class: 'btn', href: demoLink, text: 'Открыть демо-сюжет' })]),
  ]);
}

export function noDemoPanel(e, isFile) {
  return h('div', { class: 'panel pf-error' }, [h('h2', { text: 'Нет ни ядра, ни демо-данных' }),
    h('p', { text: isFile ? 'Табло открыто как файл: браузер не даёт читать demo/. Запустите: '
      + '..\.venv\Scripts\python.exe -m http.server 8611 -d ui/board и откройте http://127.0.0.1:8611/?demo=1#/line'
      : `Демо-данные не загрузились: ${e.message}` })]);
}
