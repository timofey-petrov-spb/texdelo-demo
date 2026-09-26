// Точка входа табло: роли, ядро или демо, поток событий, маршрутизация по #; строка статуса — header.js, вкладки — screens.js.
// Роли: ядро (режим dev) — GET /v1/demo/roles; 404 от ядра — вход по токену; ядра нет — демо. Запросы — с токеном роли.

import { bootFallback, createLiveApi, isDemoForced, resolveApiBase, rolesFallback } from './api.js';
import { withV16 } from './api_v16.js';
import { lapKeep, watchCounts } from './attention.js';
import { CORE_TIMEOUT_MS, DEFAULT_ROLE, LINE_TIMEOUT_MS } from './config.js';
import { createDemo } from './demo.js';
import { clear, h, toast } from './dom.js';
import { itemTitle } from './format.js';
import {
  bindStatusBar, demoControls, load, renderClock, renderConn, renderLinePicker, renderRole, renderWatch, savedRole, savedToken, saveRole,
} from './header.js';
import { installCardPanel } from './card_panel.js';
import { createProfile } from './item.js';
import { journal } from './feed.js';
import { mountLine } from './line.js';
import { forgetCards, rememberCards } from './names.js';
import { mountOtk } from './otk.js';
import { normalizeRoles, pickRole, tokenRole } from './roles.js';
import {
  demoHref, errorPanel, EXTRA_ROUTES, markNav, mountCabinet, noDemoPanel, renderNav, screenTitle, tokenPanel,
} from './screens.js';
import { FetchEventSource, fetchStreamSupported } from './sse.js';
import { applyEvent, createState, emptyChanges, linesOf, mergeChanges, sourceSeq } from './state.js';
import { mountStation } from './station.js';
import { StreamClient } from './stream.js';
import { workplace } from './words.js';

const $ = (id) => document.getElementById(id);
const main = $('view');
const app = {
  state: createState(),
  api: null,
  mode: 'connecting',
  roles: [],
  role: null,
  version: null,
  limits: new Map(),
  lineFilter: load('line', 'all'),
  attnKind: null, lapFilter: 'current', // значок-фильтр «Требует действия»; текущий круг или вся смена (5.6)
  lastEventAt: 0,
  go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
};
window.texdelo = app; // для отладки на стенде
installCardPanel(app); // панель карточки (К40) — сразу, а не по импорту escape_screen.js (QA В-07); повтор безопасен

let view = null;
let viewKind = '';
let pending = null; let raf = 0; // накопленные изменения и кадр их показа
let demo = null; let demoInfo = null; // сюжет демо и его положение
let lineBox = null; // выбор линии «Показать: …» над очередью «Приёмки ОТК»
let deferred = null; // живая линия ещё не открыта: роль из кабинета (нет права читать линию)
const conns = new Map(); // состояние каждого потока: main или по линии
const streams = [];
const log = journal(app);

app.handle = (ev, source) => handle(ev, source); // для отладки на стенде: подать StreamEvent вручную

function handle(ev, source = 'main') {
  const ch = applyEvent(app.state, ev, source);
  if (!ch) return;
  app.lastEventAt = Date.now();
  pending = mergeChanges(pending || emptyChanges(), ch);
  if (!raf) raf = requestAnimationFrame(flush);
}

function flush() {
  raf = 0;
  const ch = pending;
  pending = null;
  if (!ch) return;
  if (ch.reset) forgetCards(); // новый журнал — карточки нумеруются заново
  if (ch.reset || ch.cards) rememberCards(app.state.cards.values());
  if (app.live?.paused?.()) { app.live.stash(ch); paintStatus(); return; } // пауза показа (live.js, К37): застыла рабочая зона
  if (lineBox && (ch.reset || ch.lines.size)) renderLinePicker(app, onLinePick, lineBox);
  try {
    view?.update?.(ch);
  } catch (e) {
    console.error('табло: ошибка обновления экрана', e);
  }
  if (ch.reset || ch.feed.length) log.update(ch);
  paintStatus();
}

// Строка статуса: значки «Стоп / Решение / Уход» (текущий круг, обе линии) и связь — и во время паузы показа
function paintStatus() {
  renderWatch(watchCounts(app.state, lapKeep(app)), onWatch);
  paintConn();
}

function paintConn() {
  renderConn(app, conns, demoInfo);
}

function setConn(s, source = 'main') {
  const prev = conns.get(source) || {};
  const lost = s.state === 'lost' || s.state === 'reconnecting';
  conns.set(source, { ...prev, ...s, lostAt: lost ? prev.lostAt || Date.now() : 0 });
  paintConn();
}

// Клик по значку строки статуса — «Линия» со списком, отфильтрованным по этому значку
function onWatch(kind) {
  app.attnKind = app.attnKind === kind && viewKind === 'line' ? null : kind;
  if (viewKind === 'line' && view?.filterKind) view.filterKind(app.attnKind);
  else app.go('#/line');
}

// ---------- маршрутизация ----------
const decode = (x) => { try { return decodeURIComponent(x); } catch { return x; } }; // eslint-disable-line

function parse(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  const [kind = 'line', a, b] = parts;
  if (kind === 'otk') return { kind: 'otk', id: a || null };
  if (kind === 'item' && a) return { kind: 'item', id: a };
  if (kind === 'station' && a) return b ? { kind: 'station', line: a, id: b } : { kind: 'station', line: null, id: a };
  if (EXTRA_ROUTES[kind]) return { kind }; // экраны разбора: что остановили, средства измерений, входной контроль, прогон
  return { kind: 'line' };
}

// Пересобрать текущий экран целиком (смена линии или роли)
function remount() {
  viewKind = '';
  route();
}

function onLinePick() {
  if (viewKind === 'otk') remount();
}

function route() {
  const r = parse(location.hash);
  const cabinet = !!workplace(app.role?.id).cabinet;
  document.body.classList.toggle('is-cabinet', cabinet);
  markNav();
  if (r.kind === 'otk' && viewKind === 'otk' && view?.select) {
    view.select(r.id);
    return;
  }
  view?.unmount?.();
  view?.destroy?.();
  clear(main);
  lineBox = null;
  const kind = cabinet ? 'cabinet' : r.kind;
  main.className = `view view-${kind}`;
  viewKind = kind;
  if (cabinet && app.roles.length) {
    view = mountCabinet(main, app);
    document.title = 'Рабочее место — ТехДело';
    return;
  }
  if (!app.api) {
    main.append(h('div', { class: 'placeholder big', text: 'Подключаюсь к ядру…' }));
    view = null;
    return;
  }
  if (r.kind === 'otk') {
    // фильтр линии — там, где работает (SPEC.md 2.3): «Приёмка ОТК» К37 рисует свой — тогда этот не нужен
    lineBox = h('div', { class: 'linepick otk-lines', role: 'group', 'aria-label': 'какие линии показать' });
    main.append(lineBox);
    view = mountOtk(main, app, r.id);
    if (main.querySelector('.linepick:not(.otk-lines)')) lineBox = void lineBox.remove();
    else renderLinePicker(app, onLinePick, lineBox);
  } else if (r.kind === 'item') {
    const box = h('div', { class: 'item-page' });
    main.append(box);
    view = createProfile(box, app, r.id);
  } else if (r.kind === 'station') {
    view = mountStation(main, app, r.line, r.id);
  } else if (EXTRA_ROUTES[r.kind]) {
    view = EXTRA_ROUTES[r.kind](main, app);
  } else {
    view = mountLine(main, app, { openJournal: () => log.toggle(true) });
  }
  document.title = `${r.kind === 'item' ? itemTitle(r.id) : r.kind === 'station' ? 'Участок' : screenTitle(r.kind)} — ТехДело`;
  main.scrollTop = 0;
}

// ---------- роли ----------
function startHash(role) {
  return `#/${workplace(role?.id).start || 'line'}`;
}

function setRoles(list) {
  app.roles = normalizeRoles(list);
  app.role = pickRole(app.roles, savedRole(DEFAULT_ROLE)) || tokenRole(savedToken());
  renderRole(app, onRole);
  saveRole(app.role.key);
  renderNav(app);
  if (!location.hash) history.replaceState(null, '', startHash(app.role));
}

// Смена рабочего места: вкладки и стартовый экран роли; на детали и участке — остаёмся на месте
function onRole(r) {
  saveRole(r.key);
  renderNav(app);
  app.attnKind = null;
  const cabinet = !!workplace(r.id).cabinet;
  if (!app.api && app.mode === 'live') {
    connect(); // вход по токену (режим strict): с новым токеном — заново
    return;
  }
  if (app.mode === 'live') {
    if (cabinet) {
      for (const c of streams) c.stop(); // у роли нет права читать линию: поток не нужен
      conns.clear();
    } else if (deferred) {
      const d = deferred;
      deferred = null;
      openLine(d.live, d.base, d.lineParam).catch((e) => coreError(e, d.base, () => location.reload()));
    } else {
      restartStreams();
    }
  }
  if (cabinet || !['item', 'station'].includes(viewKind)) {
    const next = startHash(r);
    if (location.hash === next) remount();
    else location.hash = next;
  } else {
    remount();
  }
  paintStatus();
}

// ---------- запуск ----------
async function startDemo(reason) {
  const loop = new URLSearchParams(location.search).get('loop') === '1';
  demo = createDemo({ base: 'demo/', loop, getRole: () => app.role, onStatus: (s) => {
    demoInfo = s;
    paintConn();
  } });
  try {
    await demo.load();
    app.mode = 'demo';
    setRoles(await demo.api.roles().catch(() => []));
  } catch (e) {
    clear(main).append(noDemoPanel(e, location.protocol === 'file:'));
    return;
  }
  app.api = demo.api;
  app.demo = demo; // для отладки на стенде: сюжет, поправки, журнал
  app.version = await demo.api.version();
  document.body.classList.add('is-demo');
  demoControls(demo, () => demoInfo);
  route();
  // поток демо читает тот же StreamClient, что и поток ядра: обрыв и since_seq — настоящие
  const client = new StreamClient({ base: '', EventSourceImpl: demo.EventSource, getSeq: () => sourceSeq(app.state),
    onEvent: (ev) => handle(ev), onStatus: (s) => setConn(s) });
  streams.push(client);
  client.start();
  demo.start();
  if (reason) toast(reason, 'info', 6000);
}

function openStream(base, lineId, source) {
  const useFetch = fetchStreamSupported();
  const client = new StreamClient({
    base, lineId, getSeq: () => sourceSeq(app.state, source), onEvent: (ev) => handle(ev, source),
    onStatus: (s) => setConn(s, source),
    EventSourceImpl: useFetch ? FetchEventSource : globalThis.EventSource,
    init: () => (useFetch && app.role?.token ? { headers: { Authorization: `Bearer ${app.role.token}` } } : undefined),
  });
  client.source = source;
  streams.push(client);
  client.start();
}

// Роль сменилась — поток переоткрывается с новым токеном и продолжает с того же since_seq
function restartStreams() {
  for (const c of streams) {
    c.stop();
    c.start();
  }
}

async function startLive(api, base, snapshot, lineParam) {
  app.api = api;
  app.mode = 'live';
  api.version().then((v) => {
    app.version = v;
    paintConn();
  }).catch(() => {});
  // ядро отдало сводную линию без line_id, а деталей — с разных линий: снимок и поток на каждую линию
  const ids = lineParam ? [] : linesOf(snapshot);
  const per = ids.length > 1 ? await Promise.all(ids.map((id) => api.line(id, LINE_TIMEOUT_MS).catch(() => null))) : [];
  if (per.length && per.every((s) => s && typeof s === 'object')) {
    per.forEach((s, i) => handle({ type: 'line', seq: Number(s.as_of_seq) || 0, line: { ...s, line_id: s.line_id || ids[i] } }, ids[i]));
    route();
    for (const id of ids) openStream(base, id, id);
  } else {
    if (snapshot && typeof snapshot === 'object') handle({ type: 'line', seq: Number(snapshot.as_of_seq) || 0, line: snapshot });
    route();
    openStream(base, lineParam || undefined, 'main');
  }
  // стартовые списки: активные предупреждения и карточки; дальше их ведёт поток
  api.warnings().then((ws) => {
    for (const w of Array.isArray(ws) ? ws : []) handle({ type: 'warning', seq: app.state.seq, warning: w });
  }).catch(() => {});
  api.cards().then((cs) => {
    for (const c of Array.isArray(cs) ? cs : []) handle({ type: 'card', seq: app.state.seq, card: c });
  }).catch(() => {});
}

async function openLine(live, base, lineParam) {
  const snap = await live.line(lineParam || undefined, LINE_TIMEOUT_MS);
  conns.clear();
  await startLive(live, base, snap, lineParam);
}

function coreError(e, base, retry) {
  clear(main).append(errorPanel(e, base || location.origin, retry, demoHref(location)));
  setConn({ state: 'error', http: Number(e?.status) || 0, detail: e?.detail || '' });
}

async function connect() {
  const params = new URLSearchParams(location.search);
  const base = resolveApiBase(location.search);
  const lineParam = params.get('line') || '';
  const live = withV16(createLiveApi(base, () => app.role?.token), base, () => app.role?.token);
  const retry = () => {
    clear(main).append(h('div', { class: 'placeholder big', text: 'Подключаюсь к ядру…' }));
    connect();
  };
  try {
    // роли рабочих мест: режим dev — список с токенами; ядро ответило 404 — вход по токену роли
    let roles = [];
    let why = '';
    try {
      roles = await live.roles(CORE_TIMEOUT_MS);
    } catch (e) {
      const next = rolesFallback(e, params.has('api'));
      if (next !== 'token') throw e;
      why = e?.detail && e.detail !== 'Not Found' ? e.detail
        : 'GET /v1/demo/roles ответил 404 (режим strict или ядро без API v1.3)';
    }
    app.mode = 'live';
    setRoles(Array.isArray(roles) ? roles : []);
    if (!app.roles.length && !app.role?.token) {
      tokenScreen(why, base);
      return;
    }
    if (workplace(app.role?.id).cabinet) {
      // держатель КД, заказчик, администратор: права читать линию нет — экран «в кабинете», линия — при смене роли
      deferred = { live, base, lineParam };
      app.api = live;
      route();
      return;
    }
    await openLine(live, base, lineParam);
  } catch (e) {
    if (bootFallback(e, params.has('api')) === 'demo') {
      await startDemo('Ядра по этому адресу нет — табло проигрывает демо-сюжет. Для живой линии откройте с ?api=адрес ядра.');
    } else {
      coreError(e, base, retry);
    }
  }
}

function tokenScreen(why, base) {
  clear(main).append(tokenPanel(why, base || location.origin, demoHref(location)));
  setConn({ state: 'wait' });
  $('role-menu').hidden = false;
  $('token')?.focus();
}

function boot() {
  bindStatusBar(app, {
    log,
    demo: () => demo,
    // продолжили после паузы показа: накопленное — одним обновлением
    resume(ch) {
      if (ch) {
        pending = mergeChanges(pending || emptyChanges(), ch);
        if (!raf) raf = requestAnimationFrame(flush);
      }
      paintStatus();
    },
  });
  paintStatus(); // значки — прочерками, пока нет снимка линии
  addEventListener('hashchange', route);
  app.onLapFilter = () => { remount(); paintStatus(); }; // «вся смена / текущий круг» — из «О стенде»
  route();
  renderClock();
  let tick = 0;
  setInterval(() => {
    renderClock(); // часы ЧЧ:ММ: текст меняется раз в минуту
    tick += 1;
    // «нет связи N с» — каждую секунду; «обновлено N с назад» в подсказке — раз в 5 с
    if (tick % 5 === 0 || [...conns.values()].some((c) => c.lostAt)) paintConn();
  }, 1000);
  if (isDemoForced(location.search)) startDemo();
  else connect();
}

boot();
