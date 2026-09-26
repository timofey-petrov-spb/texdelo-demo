// Пауза показа (SPEC 5.2, 5.3; поток К37): клавиша P или кнопка в строке статуса — рабочая зона застывает,
// изменения потока копятся (mergeChanges), строка статуса (значки, часы, «❚❚ Пауза · N новых — продолжить») идёт.
// Второе P или «продолжить» — экран догоняет одним обновлением. Состояние табло (app.state) при этом живёт как
// обычно: копятся только сведения «что изменилось» для экранов. Без DOM (кроме bindPauseKey) — node --test.
//
// Встраивание (ui.js, К38) — две строки:
//   attachLive(app, (ch) => view?.update?.(ch));                       // после создания app: app.live и клавиша P
//   if (app.live?.paused()) app.live.stash(ch); else view?.update?.(ch); // в flush() вместо view?.update?.(ch)
// Строка статуса: liveText(app.live) — «● Живое» / «❚❚ Пауза · 7 новых — продолжить»; app.live.onChange(fn) —
// перерисовать значок (зовётся при паузе, продолжении и не чаще раза в секунду при новых событиях).

import { plural } from './format.js';
import { emptyChanges, mergeChanges } from './state.js';

export const PAUSE_NOTIFY_MS = 1000;

// Сколько событий журнала в изменениях: новые записи ленты (у каждой — summary; снимки линии и heartbeat — нет)
function eventsIn(ch) {
  return Array.isArray(ch?.feed) ? ch.feed.length : 0;
}

// opts: функция onChange или { onChange, onResume, clock, later, cancel }
export function createLive(opts = {}) {
  const o = typeof opts === 'function' ? { onChange: opts } : opts || {};
  const clock = o.clock || (() => Date.now());
  const later = o.later || ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.cancel || ((t) => clearTimeout(t));
  const listeners = new Set();
  if (typeof o.onChange === 'function') listeners.add(o.onChange);
  let apply = typeof o.onResume === 'function' ? o.onResume : null; // как экран получает изменения
  let isPaused = false;
  let stashed = null;
  let count = 0;
  let since = null;
  let lastNotify = 0;
  let timer = null;

  const api = {
    paused: () => isPaused,
    isPaused: () => isPaused,
    pending: () => count,
    since: () => since,
    pause() {
      if (isPaused) return;
      isPaused = true;
      since = clock();
      notify(true);
    },
    // Продолжить: отдаёт накопленное (или null) и передаёт его onResume — экран догоняет одним обновлением
    resume() {
      if (!isPaused) return null;
      isPaused = false;
      const ch = take();
      notify(true);
      if (ch && apply) apply(ch);
      return ch;
    },
    toggle() {
      if (isPaused) api.resume();
      else api.pause();
      return isPaused;
    },
    // Изменения, пришедшие во время паузы; не на паузе — сразу отдаются экрану (apply), ничего не копится
    stash(ch) {
      if (!ch) return;
      if (!isPaused) {
        apply?.(ch);
        return;
      }
      count += eventsIn(ch);
      stashed = mergeChanges(stashed || emptyChanges(), ch);
      notify(false);
    },
    take,
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onResume(fn) {
      apply = typeof fn === 'function' ? fn : null;
    },
  };

  function take() {
    const ch = stashed;
    stashed = null;
    count = 0;
    since = isPaused ? since : null;
    return ch;
  }

  // Пауза и продолжение — сразу; число новых — не чаще раза в секунду (SPEC 3.1)
  function notify(now) {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    const t = clock();
    const wait = PAUSE_NOTIFY_MS - (t - lastNotify);
    if (now || wait <= 0) {
      lastNotify = t;
      for (const fn of [...listeners]) fn(api);
      return;
    }
    timer = later(() => {
      timer = null;
      lastNotify = clock();
      for (const fn of [...listeners]) fn(api);
    }, wait);
  }

  return api;
}

// Надпись значка связи в строке статуса
export function liveText(live) {
  if (!live?.paused?.()) return '● Живое';
  const n = live.pending();
  return n ? `❚❚ Пауза · ${n} ${plural(n, 'новое', 'новых', 'новых')} — продолжить` : '❚❚ Пауза — продолжить';
}

export function liveHint(live) {
  return live?.paused?.()
    ? 'Показ на паузе: экран не меняется, события копятся. P или нажатие — продолжить'
    : 'Экран обновляется вживую. P — пауза показа (например, чтобы рассказать о том, что на экране)';
}

// P — не в поле ввода и без Ctrl/Alt/⌘; «З» — та же клавиша в русской раскладке
export function isPauseKey(e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return false;
  const t = e.target;
  const tag = String(t?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return false;
  return e.code === 'KeyP' || ['p', 'P', 'з', 'З'].includes(e.key);
}

export function bindPauseKey(app, target = globalThis.document) {
  if (!target?.addEventListener || !app?.live) return () => {};
  const on = (e) => {
    if (!isPauseKey(e)) return;
    e.preventDefault?.();
    app.live.toggle();
  };
  target.addEventListener('keydown', on);
  return () => target.removeEventListener?.('keydown', on);
}

// app.live + клавиша P. apply(ch) — как экран получает изменения (view.update); продолжение отдаёт ему
// накопленное одним обновлением
export function attachLive(app, apply) {
  if (app.live) return app.live;
  app.live = createLive({ onResume: (ch) => apply?.(ch) });
  bindPauseKey(app);
  return app.live;
}
