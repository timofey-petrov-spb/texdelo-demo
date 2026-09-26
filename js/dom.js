// Помощники DOM: создание элементов без innerHTML (данные ядра не исполняются как разметка),
// плавные числа, FLIP-перемещение, всплывающие сообщения.

import { ZONES, zoneKey } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function fill(el, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children ?? [])) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function h(tag, attrs, children) {
  return fill(document.createElement(tag), attrs, children);
}

export function s(tag, attrs, children) {
  return fill(document.createElementNS(SVG_NS, tag), attrs, children);
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Значок зоны: цвет + знак + подпись — второй признак для различающих цвета хуже
export function zoneBadge(zone, { label = true, cls = '' } = {}) {
  const z = zoneKey(zone);
  return h('span', { class: `zbadge z-${z} ${cls}`.trim(), title: ZONES[z].label }, [
    h('span', { class: 'zic', 'aria-hidden': 'true', text: ZONES[z].icon }),
    label ? h('span', { class: 'zlb', text: ZONES[z].label }) : null,
  ]);
}

export function zoneIcon(zone) {
  const z = zoneKey(zone);
  return h('span', { class: `zic z-${z}`, title: ZONES[z].label, 'aria-label': ZONES[z].label, text: ZONES[z].icon });
}

const tweens = new WeakMap();

// Плавное изменение числа (easeOutCubic). format — как показать промежуточное значение
export function animateNumber(el, to, format = (v) => String(Math.round(v)), ms = 650) {
  if (!Number.isFinite(to)) {
    el.textContent = '—';
    el.dataset.v = '';
    return;
  }
  const from = Number.parseFloat(el.dataset.v);
  el.dataset.v = String(to);
  if (!Number.isFinite(from) || from === to || document.hidden || reducedMotion()) {
    el.textContent = format(to);
    return;
  }
  cancelAnimationFrame(tweens.get(el));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / ms));
    const e = 1 - (1 - k) ** 3;
    el.textContent = format(from + (to - from) * e);
    if (k < 1) tweens.set(el, requestAnimationFrame(step));
  };
  tweens.set(el, requestAnimationFrame(step));
  const bump = to > from ? 'up' : 'down';
  el.classList.remove('bump-up', 'bump-down');
  void el.offsetWidth;
  el.classList.add(`bump-${bump}`);
}

// Просьба системы «меньше движения»: CSS-анимации гасит board.css, анимации из кода — эта проверка
export function reducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// FLIP-сдвиг меток деталей убран (SPEC 3.2, 5.1: анимации переезда меток нет — на проекторе движение отвлекает).
// Имена оставлены, чтобы экраны не ломались: положения не меряются (без лишнего пересчёта раскладки), сдвиг не
// проигрывается (К37)
export function flipMeasure() {
  return new Map();
}

export function flipPlay() {}

let toastBox = null;

export function toast(text, kind = 'info', ms = 5200) {
  toastBox = toastBox || document.getElementById('toasts');
  if (!toastBox) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  toastBox.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

export function onResize(el, fn) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fn);
  });
  ro.observe(el);
  return () => ro.disconnect();
}

// «Основание» — ссылки на пункты документов и происхождение правила: на рабочем экране свёрнуто (К35)
export function basisBox(basis) {
  const list = (Array.isArray(basis) ? basis : [basis]).filter(Boolean);
  if (!list.length) return null;
  return h('details', { class: 'basis' }, [h('summary', { text: 'Основание' }), ...list.map((b) => h('p', { text: b }))]);
}

export function link(href, attrs, children) {
  return h('a', { href, ...attrs }, children);
}
