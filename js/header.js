// Строка статуса табло (SPEC.md 2.3): одна строка 48 px — имя, вкладки роли (screens.js), три значка наблюдения
// «Стоп / Решение / Уход», связь и часы, рабочее место «роль · линия ▾» (роли со строкой «что делаю», тема, на весь
// экран, «О стенде», пульт демо), журнал «≡» и справка «?». Бегущей строки и подвала нет: обозначения — в справке.

import { clear, h, toast } from './dom.js';
import { DEFAULT_THRESHOLDS, fmtNum, isNum } from './format.js';
import { openHelp } from './help.js';
import { liveText } from './live.js';
import { tokenRole } from './roles.js';
import { sortedLines } from './state.js';
import { lineWord, workplace } from './words.js';

const $ = (id) => document.getElementById(id);

export function load(key, dflt) {
  try {
    return localStorage.getItem(`texdelo.board.${key}`) ?? dflt;
  } catch {
    return dflt;
  }
}

export function save(key, v) {
  try {
    localStorage.setItem(`texdelo.board.${key}`, v);
  } catch {
    // хранилище недоступно (приватное окно) — настройка живёт до перезагрузки
  }
}

// Выбор линии «Показать: Обе линии · Линия 1 · Линия 2» — там, где он работает (Приёмка ОТК), не в строке статуса.
// box — куда рисовать (по умолчанию #lines, если есть); counts — число деталей по линии { all, 'L-1': 7 } (не обязательно)
export function renderLinePicker(app, onPick, box = $('lines'), counts = null) {
  if (!box) return;
  const lines = sortedLines(app.state);
  const sig = `${app.lineFilter}|${lines.map((l) => l.line_id).join(',')}|${counts ? JSON.stringify(counts) : ''}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  clear(box);
  box.hidden = lines.length < 2;
  if (app.lineFilter !== 'all' && lines.length && !lines.some((l) => l.line_id === app.lineFilter)) app.lineFilter = 'all';
  const opts = [['all', 'Обе линии'], ...lines.map((l) => [l.line_id, lineWord(l.line_id)])];
  box.append(h('span', { class: 'lp-l', text: 'Показать:' }));
  for (const [id, label] of opts) {
    const n = counts && Number.isFinite(counts[id]) ? counts[id] : null;
    box.append(h('button', { type: 'button', class: app.lineFilter === id ? 'on' : '', 'aria-pressed': String(app.lineFilter === id),
      onclick: () => {
        app.lineFilter = id;
        save('line', id);
        renderLinePicker(app, onPick, box, counts);
        onPick?.(id);
      } }, [label, n === null ? null : h('span', { class: 'lp-n', text: String(n) })]));
  }
}

// ---------- рабочее место: «роль · линия ▾» ----------
function roleLabel(r) {
  return [h('span', { class: 'rl-name', text: r?.name || r?.title || 'Роль' }),
    r?.lineLabel ? h('span', { class: 'rl-line', text: r.lineLabel }) : null];
}

let menuBound = false;
function bindMenu() {
  if (menuBound) return;
  menuBound = true;
  const btn = $('role');
  const menu = $('role-menu');
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('[aria-checked="true"]')?.focus();
  };
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      btn.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('.menu-i, .role-i')) close();
  });
}

// Роли — из ядра (GET /v1/demo/roles) или из демо-данных; нет ролей (ядро в режиме strict) — поле токена в меню
export function renderRole(app, onChange) {
  bindMenu();
  const btn = $('role');
  const list = $('role-list');
  const input = $('token');
  const roles = app.roles || [];
  clear(btn).append(...roleLabel(app.role).filter(Boolean), h('span', { class: 'rl-caret', 'aria-hidden': 'true', text: '▾' }));
  btn.title = [app.role?.actor, app.role?.title, 'Сменить рабочее место, тема, на весь экран, о стенде'].filter(Boolean).join('\n');
  clear(list);
  for (const r of roles) {
    const on = r.key === app.role?.key;
    list.append(h('li', {}, [h('button', { class: `role-i${on ? ' on' : ''}`, type: 'button', role: 'menuitemradio',
      'aria-checked': String(on), title: r.actor || '', onclick: () => {
        if (r.key === app.role?.key) return;
        app.role = r;
        renderRole(app, onChange);
        toast(`Рабочее место: ${[r.name, r.lineLabel].filter(Boolean).join(', ')}`, 'info', 2500);
        onChange?.(r);
      } }, [h('span', { class: 'ri-t' }, roleLabel(r).filter(Boolean)), workplace(r.id).doing ? h('span', { class: 'ri-d', text: workplace(r.id).doing }) : null])]));
  }
  input.hidden = roles.length > 0 || app.mode === 'demo';
  input.placeholder = app.role?.token ? 'токен введён — сменить' : 'токен роли';
  input.onchange = () => {
    app.role = tokenRole(input.value);
    try {
      sessionStorage.setItem('texdelo.board.token', app.role.token);
    } catch {
      // без хранилища токен живёт до перезагрузки
    }
    renderRole(app, onChange);
    onChange?.(app.role);
  };
}

export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $('theme');
  if (!b) return;
  b.textContent = `Тема: ${t === 'dark' ? 'тёмная' : 'светлая'}`;
  b.title = t === 'dark' ? 'Сменить на светлую (T)' : 'Сменить на тёмную (T)';
}

// ---------- связь и пауза показа ----------
// Коротко в строке: «● Живое», «❚❚ Пауза: 7 новых — продолжить», «○ Нет связи 12 с», «Демо-сюжет»;
// подробности (номер записи журнала, когда обновлено, адрес ошибки) — в подсказке
export function connText(app, conns, demoInfo, now = Date.now()) {
  const seq = app.state.seq || 0;
  const all = [...conns.values()];
  const ago = app.lastEventAt ? Math.max(0, Math.round((now - app.lastEventAt) / 1000)) : null;
  const upd = ago === null ? '' : `Обновлено ${ago} с назад. `;
  // кабинетная роль: линию она не читает, поток остановлен — ядро на связи
  if (workplace(app.role?.id).cabinet && app.api) return ['conn-live', app.mode === 'demo' ? '● Демо' : '● Живое', 'Ядро на связи. Линию эта роль не читает — её рабочее место в кабинете ролей'];
  const failed = all.find((c) => c.state === 'error');
  if (failed) {
    return ['conn-lost', '○ Нет связи', `${failed.http ? `Ядро ответило ${failed.http}.` : 'Ядро не отвечает.'} ${upd}`];
  }
  const lost = all.find((c) => c.state === 'lost' || c.state === 'reconnecting');
  if (lost) {
    const sec = lost.lostAt ? ` ${Math.max(1, Math.round((now - lost.lostAt) / 1000))} с` : '';
    const why = lost.http ? ` Ядро ответило ${lost.http}${lost.detail ? `: ${lost.detail}` : ''}.` : '';
    return ['conn-lost', `○ Нет связи${sec}`, `Связь потеряна — табло продолжит с записи журнала № ${lost.seq ?? seq}.${why}`];
  }
  const paused = app.live?.paused?.();
  if (paused) {
    // надпись — liveText К37: «❚❚ Пауза · 1 новое — продолжить» (падеж по числу)
    return ['conn-pause', liveText(app.live),
      'Показ на паузе: экран застыл, значки и часы идут. Продолжить — клик или клавиша P'];
  }
  if (app.mode === 'demo') {
    const speed = demoInfo?.speed && demoInfo.speed !== 1 ? `, ×${demoInfo.speed}` : '';
    return ['conn-demo', demoInfo?.ended ? '● Демо окончено' : '● Демо',
      `Записанный сюжет проигрывается в браузере${speed}, запись журнала № ${seq}. ${upd}Подробнее — «О стенде»`];
  }
  if (all.some((c) => c.state === 'live')) {
    return ['conn-live', '● Живое', `${app.version?.mode === 'dev' ? 'Демо-стенд, ' : ''}запись журнала № ${seq}. ${upd}`
      + 'Пауза показа — клавиша P'];
  }
  return ['conn-wait', 'Подключаюсь…', 'Табло подключается к ядру'];
}

export function renderConn(app, conns, demoInfo) {
  const el = $('conn');
  const [cls, text, title] = connText(app, conns, demoInfo);
  const c = `conn ${cls}`;
  if (el.className !== c) el.className = c;
  if (el.lastChild.textContent !== text) el.lastChild.textContent = text;
  if (el.title !== title) el.title = title;
  document.body.classList.toggle('is-paused', cls === 'conn-pause'); // длинная надпись паузы — без имени системы на 1280
  if (demoInfo?.total && $('demo-pos')) $('demo-pos').textContent = `${Math.min(demoInfo.idx, demoInfo.total)} из ${demoInfo.total}`;
}

// ---------- часы: ЧЧ:ММ, раз в минуту ----------
export function renderClock(now = new Date()) {
  const el = $('clock');
  const t = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  if (el && el.textContent !== t) {
    el.textContent = t;
    el.title = 'Московское время';
  }
}

// ---------- три значка наблюдения ----------
const WATCH = [
  ['stop', '✕', 'Стоп', 'critical', '«Стоп» и пропуски контроля текущего круга'],
  ['decision', '!', 'Решение', 'serious', 'Открытые карточки и удержанные детали текущего круга'],
  ['drift', '◐', 'Уход', 'caution', 'Участки, где уходит режим'],
];

// counts — { stop, decision, drift } (attention.js watchCounts); DOM трогается, только если число изменилось
export function renderWatch(counts, onPick) {
  const box = $('watch');
  if (!box) return;
  if (!box.firstChild) {
    for (const [k, icon, label, tone, title] of WATCH) {
      box.append(h('button', { type: 'button', class: 'w w-zero', dataset: { k, tone }, title: `${title}. Открыть список на «Линии»`,
        onclick: () => onPick?.(k) }, [h('span', { class: 'zic', 'aria-hidden': 'true', text: icon }),
        h('b', { class: 'w-n', text: '—' }), h('span', { class: 'w-l', text: label })]));
    }
  }
  for (const b of box.children) {
    const n = counts?.[b.dataset.k];
    const text = Number.isFinite(n) ? String(n) : '—';
    const cls = `w${n > 0 ? ` w-on sev-${b.dataset.tone}` : ' w-zero'}`;
    if (b.className !== cls) b.className = cls;
    const v = b.querySelector('.w-n');
    if (v.textContent !== text) v.textContent = text;
  }
}

// ---------- пульт демо (в меню рабочего места) ----------
export function demoControls(demo, getInfo) {
  const box = $('democtl');
  box.hidden = false;
  const pause = h('button', { type: 'button', title: 'Пауза / продолжить сюжет (пробел)', text: '⏸', onclick: () => {
    demo.pause();
    pause.textContent = getInfo()?.paused ? '▶' : '⏸';
  } });
  const speed = h('select', { 'aria-label': 'скорость сюжета', onchange: () => demo.setSpeed(Number(speed.value)) },
    [1, 2, 4].map((v) => h('option', { value: v, text: `×${v}` })));
  clear(box).append(h('span', { class: 'demo-tag', text: 'Демо-сюжет' }), pause, speed,
    h('button', { type: 'button', title: 'Сюжет сначала', text: '↻', onclick: () => {
      demo.restart();
      pause.textContent = '⏸';
    } }),
    h('button', { type: 'button', title: 'Оборвать связь на 6 с: табло само переподключится и дочитает пропущенное',
      text: 'Обрыв связи', onclick: () => demo.outage(6000) }),
    h('span', { id: 'demo-pos' }));
}

// Пороги зон — из данных линии (их задаёт технолог); пока данных нет — значения по умолчанию
export function thresholdsText(app) {
  const t = sortedLines(app.state).map((l) => l.thresholds).find(Boolean) || DEFAULT_THRESHOLDS;
  const w = isNum(t.with_margin_pct) ? t.with_margin_pct : DEFAULT_THRESHOLDS.with_margin_pct;
  const r = isNum(t.reduced_pct) ? t.reduced_pct : DEFAULT_THRESHOLDS.reduced_pct;
  return `пороги запаса ${fmtNum(w)} и ${fmtNum(r)} %`;
}

export function bindHelp(app) {
  $('help').onclick = () => openHelp(app);
  $('about').onclick = () => openHelp(app, 'about');
}

// Токен роли, введённый раньше (режим strict): живёт в сессии вкладки
export function savedToken() {
  try {
    return sessionStorage.getItem('texdelo.board.token') || '';
  } catch {
    return '';
  }
}

// Пауза показа — модуль К37 (live.js, SPEC.md 5.3); пока его нет, строка статуса показывает «● Живое» без паузы.
// Имя модуля — переменной: до вливания П1 файла нет, а проверка импортов табло ищет только существующие файлы
const LIVE_MODULE = './live.js';

// Строка статуса и клавиши: тема, на весь экран, журнал, справка, пауза показа; 1 — Линия, 2 — Приёмка ОТК,
// 3 — Что остановили, F, T, ? , пробел — пауза демо, Esc — закрыть журнал. Клавиши молчат в полях ввода.
export function bindStatusBar(app, { log, demo, resume }) {
  applyTheme((new URLSearchParams(location.search).get('theme') || load('theme.v2', 'light')) === 'dark' ? 'dark' : 'light');
  $('theme').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    save('theme.v2', t); // новый ключ: прежний сохранённый «dark» не перебивает светлую по умолчанию
    applyTheme(t);
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  $('fullscreen').onclick = fullscreen;
  $('journal').onclick = () => log.toggle();
  bindHelp(app);
  import(LIVE_MODULE).then((m) => {
    // attachLive (К37): app.live и клавиша P; продолжили — накопленное за паузу одним обновлением (resume(ch));
    // пауза, продолжение и счётчик новых — перерисовать строку статуса (resume(null))
    if (typeof m.attachLive !== 'function') return;
    m.attachLive(app, (ch) => resume(ch || null));
    app.live?.onChange?.(() => resume(null));
  }).catch(() => {});
  $('conn').onclick = () => app.live?.paused?.() && app.live.toggle();
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.code;
    if (k === 'Digit1') app.go('#/line');
    else if (k === 'Digit2') app.go('#/otk');
    else if (k === 'Digit3') app.go('#/escape');
    else if (k === 'KeyF') fullscreen();
    else if (k === 'KeyT') $('theme').click();
    else if (e.key === '?') openHelp(app);
    else if (k === 'Escape' && log.open()) log.toggle(false);
    else if (k === 'Space' && demo() && e.target === document.body) {
      e.preventDefault();
      $('democtl').querySelector('button')?.click();
    }
  });
}

// Рабочее место — своё у каждой вкладки (QA В-30): ?role=QC-01 в адресе, иначе выбранное в этой вкладке
// (sessionStorage), иначе последнее выбранное на этом компьютере (localStorage)
export function savedRole(dflt) {
  const asked = new URLSearchParams(globalThis.location?.search || '').get('role');
  if (asked) return asked;
  try {
    const s = sessionStorage.getItem('texdelo.board.role');
    if (s) return s;
  } catch {
    // хранилище вкладки недоступно — берём общее
  }
  return load('role', dflt);
}

export function saveRole(key) {
  try {
    sessionStorage.setItem('texdelo.board.role', key);
  } catch {
    // без хранилища вкладки роль живёт до перезагрузки
  }
  save('role', key);
}
