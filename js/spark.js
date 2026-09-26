// Живая кривая запаса участка (SVG) по принципам ISA-101: кривая и пороги — серые и тонкие, точки в норме —
// маленькие серые; цвет и форма — только у точек вне нормы (◐ кольцо, ! ромб, ✕ крест, ? квадрат).
// Где сработал критерий ухода режима — отметка и короткая подпись «уход режима, критерий 3».
// Перерисовка — только при новых точках и не чаще раза в SPARK_MIN_MS (SPEC 5.4); узлы точек, линии, порогов и
// отметки переиспользуются — меняются атрибуты, новых узлов почти нет (К37).

import { clear, onResize, reducedMotion, s } from './dom.js';
import { fmtPct, itemTitle, ZONES, zoneKey } from './format.js';
import { driftMark, newPointCount, sparkLayout } from './geometry.js';

export const SPARK_MIN_MS = 2000;
// Большой график участка: пороги подписаны внутри поля у правого края (SPEC 3.3) — кривая кончается раньше
export const BIG_LABEL_W = 88;

// Форма точки по зоне: второй признак, кроме цвета. Тег и атрибуты — узел переиспользуется, если тег тот же
export function pointSpec(z, x, y, r) {
  if (z === 'beyond_limit') return { tag: 'path', attrs: { d: `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}` } };
  if (z === 'near_limit') {
    const k = r * 1.25;
    return { tag: 'path', attrs: { d: `M${x} ${y - k}L${x + k} ${y}L${x} ${y + k}L${x - k} ${y}Z` } };
  }
  if (z === 'not_assessable') return { tag: 'rect', attrs: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } };
  return { tag: 'circle', attrs: { cx: x, cy: y, r } };
}

function setAttr(el, k, v) {
  const str = String(v);
  if (el.getAttribute(k) !== str) el.setAttribute(k, str);
}

export function createSpark(container, opts = {}) {
  const big = !!opts.big;
  const svg = s('svg', { class: `spark${big ? ' spark-big' : ''}`, role: 'img', 'aria-label': opts.label || 'живая кривая запаса' });
  const back = s('g', { class: 'spark-back' });
  const plot = s('g', { class: 'spark-plot' });
  const front = s('g', { class: 'spark-front' });
  const line = s('path', { class: 'spark-line', d: '' });
  const dots = s('g', { class: 'spark-dots' });
  plot.append(line, dots);
  svg.append(back, plot, front);
  container.append(svg);
  let points = [];
  let args = {};
  let first = true;
  let lastKey = '';
  let backSig = '';
  let frontSig = '';
  let lastPaint = 0;
  let timer = 0;
  let pendingNew = 0;
  const slots = []; // точки по порядку: { el, tag, title, id }

  // Ширина подписи ухода режима — мерить в самой кривой (шрифт тот же); не вышло (скрыта) — оценка в driftMark
  function labelWidth(drift) {
    if (!drift) return null;
    const probe = s('text', { class: 'drift-lb', x: 0, y: -100, text: `уход режима, критерий ${drift.criterion}` });
    front.append(probe);
    let w = null;
    try {
      w = probe.getComputedTextLength?.() || null;
    } catch {
      w = null;
    }
    probe.remove();
    return w;
  }

  function pointNode(i, spec, cls, title, itemId) {
    let slot = slots[i];
    if (!slot || slot.tag !== spec.tag) {
      const el = s(spec.tag, {});
      const t = s('title', {});
      el.append(t);
      const next = { el, tag: spec.tag, title: t, id: null };
      if (opts.onPoint) {
        el.addEventListener('click', () => next.id && opts.onPoint(next.id));
        el.addEventListener('keydown', (e) => {
          if (next.id && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            opts.onPoint(next.id);
          }
        });
      }
      if (slot) slot.el.replaceWith(el);
      else dots.append(el);
      slots[i] = next;
      slot = next;
    }
    slot.id = itemId || null;
    for (const [k, v] of Object.entries(spec.attrs)) setAttr(slot.el, k, v);
    setAttr(slot.el, 'class', cls);
    // подсказка — текст того же узла (не новый узел на каждый сдвиг кривой)
    const tn = slot.title.firstChild;
    if (tn && tn.nodeType === 3) {
      if (tn.data !== title) tn.data = title;
    } else if (slot.title.textContent !== title) {
      slot.title.textContent = title;
    }
    if (opts.onPoint && itemId) {
      setAttr(slot.el, 'tabindex', big ? '0' : '-1');
      setAttr(slot.el, 'role', 'link');
      setAttr(slot.el, 'aria-label', `${title} — открыть профиль`);
    }
  }

  function render(animateNew) {
    lastPaint = Date.now();
    const width = Math.max(40, Math.round(container.clientWidth));
    const height = Math.max(30, Math.round(opts.height || container.clientHeight || 80));
    setAttr(svg, 'viewBox', `0 0 ${width} ${height}`);
    setAttr(svg, 'width', width);
    setAttr(svg, 'height', height);
    const plotW = big ? Math.max(40, width - BIG_LABEL_W) : width;
    const lay = sparkLayout(points, {
      width: plotW, height, thresholds: args.thresholds, slots: opts.slots || 30, padX: big ? 12 : 8, padY: big ? 12 : 7,
    });
    const bs = JSON.stringify([width, height, big, lay.lines.map((l) => [l.kind, l.y, l.value])]);
    if (bs !== backSig) {
      backSig = bs;
      clear(back);
      for (const l of lay.lines) {
        back.append(s('line', { class: `thr thr-${l.kind}`, x1: 0, x2: plotW, y1: l.y, y2: l.y }));
        if (big) {
          back.append(s('text', { class: 'thr-lb', x: plotW + 6, y: l.y + 4, 'text-anchor': 'start',
            text: l.value === 0 ? 'граница' : `запас ${l.value} %` }));
        }
      }
    }
    const mark = driftMark(lay, args.drift, labelWidth(args.drift));
    const fs = JSON.stringify(mark ? [mark.x, mark.tx, mark.anchor, mark.label, mark.full, height, big] : null);
    if (fs !== frontSig) {
      frontSig = fs;
      clear(front);
      if (mark) {
        front.append(s('line', { class: 'drift-mark', x1: mark.x, x2: mark.x, y1: 0, y2: height }));
        const lb = s('text', { class: 'drift-lb', x: mark.tx, y: big ? 14 : 10, 'text-anchor': mark.anchor, text: mark.label });
        if (mark.label !== mark.full) lb.append(s('title', { text: mark.full }));
        front.append(lb);
      }
    }
    setAttr(line, 'd', lay.path || '');
    const last = lay.points.length - 1;
    lay.points.forEach((p, i) => {
      const z = p.missing ? 'not_checked' : zoneKey(p.zone);
      const own = args.highlight && p.item_id === args.highlight;
      const odd = z !== 'with_margin';
      const r = (big ? (odd ? 5 : 3.2) : odd ? 3.4 : 1.9) + (i === last ? 0.8 : 0) + (own ? 1.5 : 0);
      const title = `${itemTitle(p.item_id || '')}: ${p.missing ? 'числа запаса нет' : `запас ${fmtPct(p.margin_pct)}`}, ${ZONES[z].label}`;
      const cls = `pt z-${z}${p.missing ? ' pt-miss' : ''}${i === last ? ' pt-last' : ''}${own ? ' pt-own' : ''}${animateNew && i === last ? ' pt-new' : ''}`;
      pointNode(i, pointSpec(z, p.x, p.y, r), cls, title, p.item_id);
    });
    while (slots.length > lay.points.length) slots.pop().el.remove();
    return lay;
  }

  function paint() {
    timer = 0;
    const k = pendingNew;
    pendingNew = 0;
    const lay = render(k > 0);
    if (k > 0 && !document.hidden && plot.animate && !reducedMotion()) {
      plot.animate([{ transform: `translateX(${(k * lay.step).toFixed(1)}px)` }, { transform: 'translateX(0)' }],
        { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  const stop = onResize(container, () => render(false));

  return {
    update(nextPoints, nextArgs = {}) {
      const pts = Array.isArray(nextPoints) ? nextPoints : [];
      const key = JSON.stringify([pts, nextArgs]);
      if (!first && key === lastKey) return; // те же точки — кривая не перерисовывается
      lastKey = key;
      pendingNew += first ? 0 : newPointCount(points, pts);
      points = pts;
      args = nextArgs;
      if (first) {
        first = false;
        paint();
        return;
      }
      if (timer) return; // перерисовка уже назначена — возьмёт последние точки
      const wait = SPARK_MIN_MS - (Date.now() - lastPaint);
      if (wait <= 0) paint();
      else timer = setTimeout(paint, wait);
    },
    destroy() {
      clearTimeout(timer);
      stop();
      svg.remove();
    },
  };
}
