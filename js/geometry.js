// Геометрия графики: полоса допуска, живая кривая, отметка ухода режима, покрытие. Чистые функции — node --test.

import { DEFAULT_THRESHOLDS, isNum } from './format.js';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function thr(t) {
  return {
    w: isNum(t?.with_margin_pct) ? t.with_margin_pct : DEFAULT_THRESHOLDS.with_margin_pct,
    r: isNum(t?.reduced_pct) ? t.reduced_pct : DEFAULT_THRESHOLDS.reduced_pct,
  };
}

// Полоса допуска по одной характеристике (Margin контракта).
// Возвращает положения в процентах ширины: поле допуска, оттенки зон запаса, полосы погрешности у границ,
// штрих номинала и маркер значения. kind: two — двусторонний, lower/upper — односторонний, none — границ нет.
export function bandLayout(m, thresholds) {
  const L = isNum(m?.lower_limit) ? m.lower_limit : null;
  const U = isNum(m?.upper_limit) ? m.upper_limit : null;
  const N = isNum(m?.nominal) ? m.nominal : null;
  const x = isNum(m?.value) ? m.value : null;
  const u = isNum(m?.uncertainty) && m.uncertainty > 0 ? m.uncertainty : 0;
  const { w, r } = thr(thresholds);
  let kind = 'none';
  let d0;
  let d1;
  const segs = [];
  const guards = [];
  const limits = [];
  if (L !== null && U !== null && U > L) {
    kind = 'two';
    const half = (U - L) / 2;
    const pad = (U - L) * 0.16;
    d0 = L - pad;
    d1 = U + pad;
    segs.push(['beyond_limit', d0, L], ['near_limit', L, L + (r / 100) * half],
      ['margin_reduced', L + (r / 100) * half, L + (w / 100) * half],
      ['with_margin', L + (w / 100) * half, U - (w / 100) * half],
      ['margin_reduced', U - (w / 100) * half, U - (r / 100) * half], ['near_limit', U - (r / 100) * half, U],
      ['beyond_limit', U, d1]);
    guards.push([L - u, L + u], [U - u, U + u]);
    limits.push({ side: 'lower', value: L }, { side: 'upper', value: U });
  } else if (L !== null || U !== null) {
    const lim = L !== null ? L : U;
    const dir = L !== null ? 1 : -1;
    let ref = N !== null && (N - lim) * dir > 0 ? N : null;
    if (ref === null) ref = x !== null && (x - lim) * dir > 0 ? x : lim + dir;
    const span = Math.abs(ref - lim);
    kind = L !== null ? 'lower' : 'upper';
    const ext = x !== null ? x + dir * span * 0.12 : ref;
    if (dir > 0) {
      d0 = lim - span * 0.2;
      d1 = Math.max(ref + span * 0.6, ext);
    } else {
      d0 = Math.min(ref - span * 0.6, ext);
      d1 = lim + span * 0.2;
    }
    const at = (p) => lim + dir * (p / 100) * span;
    if (dir > 0) {
      segs.push(['beyond_limit', d0, lim], ['near_limit', lim, at(r)], ['margin_reduced', at(r), at(w)],
        ['with_margin', at(w), d1]);
    } else {
      segs.push(['with_margin', d0, at(w)], ['margin_reduced', at(w), at(r)], ['near_limit', at(r), lim],
        ['beyond_limit', lim, d1]);
    }
    guards.push([lim - u, lim + u]);
    limits.push({ side: L !== null ? 'lower' : 'upper', value: lim });
  } else {
    const v = x ?? N ?? 0;
    d0 = v - 1;
    d1 = v + 1;
  }
  if (d1 - d0 <= 0) d1 = d0 + 1;
  const pos = (v) => clamp(((v - d0) / (d1 - d0)) * 100, 0, 100);
  const out = {
    kind,
    domain: [d0, d1],
    segments: segs.filter(([, a, b]) => b > a).map(([zone, a, b]) => ({ zone, from: pos(a), to: pos(b) })),
    guards: guards.map(([a, b]) => ({ from: pos(a), to: pos(b) })).filter((g) => g.to > g.from),
    limits: limits.map((l) => ({ ...l, at: pos(l.value) })),
    nominal: N !== null && kind !== 'none' ? pos(N) : null,
    marker: null,
  };
  if (x !== null) {
    const raw = ((x - d0) / (d1 - d0)) * 100;
    out.marker = { at: clamp(raw, 0, 100), overflow: raw < 0 ? 'below' : raw > 100 ? 'above' : null, value: x };
  }
  return out;
}

// Живая кривая запаса: последние slots точек, выровнены вправо — новая точка въезжает справа.
export function sparkLayout(points, opts = {}) {
  const width = opts.width ?? 200;
  const height = opts.height ?? 80;
  const padX = opts.padX ?? 6;
  const padY = opts.padY ?? 6;
  const yMin = opts.yMin ?? -20;
  const yMax = opts.yMax ?? 110;
  const slots = Math.max(2, opts.slots ?? 30);
  const { w, r } = thr(opts.thresholds);
  const list = (points || []).filter((p) => p && typeof p === 'object').slice(-slots);
  const step = (width - 2 * padX) / (slots - 1);
  const offset = slots - list.length;
  const y = (v) => padY + (1 - (clamp(v, yMin, yMax) - yMin) / (yMax - yMin)) * (height - 2 * padY);
  const pts = list.map((p, i) => {
    const has = isNum(p.margin_pct);
    return {
      x: padX + (offset + i) * step,
      y: has ? y(p.margin_pct) : y(yMin),
      missing: !has,
      clipped: has && (p.margin_pct > yMax || p.margin_pct < yMin),
      zone: p.zone || 'not_checked',
      item_id: p.item_id,
      seq: p.seq,
      margin_pct: has ? p.margin_pct : null,
    };
  });
  let path = '';
  let pen = false;
  for (const p of pts) {
    if (p.missing) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  const bands = [
    { zone: 'with_margin', y0: y(yMax), y1: y(w) },
    { zone: 'margin_reduced', y0: y(w), y1: y(r) },
    { zone: 'near_limit', y0: y(r), y1: y(0) },
    { zone: 'beyond_limit', y0: y(0), y1: y(yMin) },
  ];
  const lines = [
    { value: w, y: y(w), kind: 'with' },
    { value: r, y: y(r), kind: 'reduced' },
    { value: 0, y: y(0), kind: 'zero' },
  ];
  return { step, points: pts, path, bands, lines, width, height, y };
}

// Сколько новых точек въехало справа: сравнение по seq последней известной точки
export function newPointCount(prev, next) {
  if (!prev?.length || !next?.length) return 0;
  const last = prev[prev.length - 1]?.seq;
  if (!isNum(last)) return 0;
  let k = 0;
  for (let i = next.length - 1; i >= 0 && isNum(next[i]?.seq) && next[i].seq > last; i--) k++;
  return Math.min(k, next.length);
}

// Отметка ухода режима на кривой: вертикаль у первой точки серии и короткая подпись, которая целиком
// помещается в плитку. labelWidth — ширина подписи в пикселях (измерена в браузере; без неё — оценка).
// Сначала справа от отметки, потом слева; не влезает ни туда, ни туда — прижата к краю плитки; уже самой
// плитки — короткая «критерий 3» (полная — в подсказке).
export const DRIFT_CHAR_PX = 6.2; // средняя ширина знака подписи 10,5 px — для оценки без браузера

export function driftMark(lay, drift, labelWidth) {
  if (!drift || !isNum(drift.since_seq)) return null;
  const from = lay.points.find((p) => isNum(p.seq) && p.seq >= drift.since_seq);
  if (!from) return null;
  const x = Math.max(0, from.x - lay.step / 2);
  const full = `уход режима, критерий ${drift.criterion}`;
  const gap = 3;
  let label = full;
  let w = isNum(labelWidth) && labelWidth > 0 ? labelWidth : full.length * DRIFT_CHAR_PX;
  if (w > lay.width) {
    label = `критерий ${drift.criterion}`;
    w = isNum(labelWidth) && labelWidth > 0 ? (labelWidth * label.length) / full.length : label.length * DRIFT_CHAR_PX;
  }
  let anchor = 'start';
  let tx = x + gap;
  if (x + gap + w > lay.width) {
    if (x - gap - w >= 0) {
      anchor = 'end';
      tx = x - gap;
    } else {
      tx = Math.max(0, lay.width - w);
    }
  }
  return { x, label, full, anchor, tx, width: w };
}

// Полоса покрытия (две оси детали): доли ширины по частям — надёжно, ненадёжно, пропущено, впереди
export function coverageParts(cov) {
  const req = Math.max(0, Number(cov?.required) || 0);
  const reliable = Math.max(0, Number(cov?.reliable) || 0);
  const unreliable = Math.max(0, Number(cov?.unreliable) || 0);
  const skipped = Math.max(0, Number(cov?.skipped) || 0);
  const pending = Math.max(0, isNum(cov?.pending) ? cov.pending : req - reliable - unreliable - skipped);
  const total = Math.max(req, reliable + unreliable + skipped + pending) || 1;
  return [
    { key: 'reliable', n: reliable, pct: (reliable / total) * 100 },
    { key: 'unreliable', n: unreliable, pct: (unreliable / total) * 100 },
    { key: 'skipped', n: skipped, pct: (skipped / total) * 100 },
    { key: 'pending', n: pending, pct: (pending / total) * 100 },
  ];
}

// Кольцо покрытия: доли окружности по частям {value}
export function ringSegments(parts, radius) {
  const c = 2 * Math.PI * radius;
  const total = parts.reduce((s, p) => s + Math.max(0, p.value || 0), 0);
  let acc = 0;
  return parts.map((p) => {
    const len = total > 0 ? (Math.max(0, p.value || 0) / total) * c : 0;
    const seg = { ...p, length: len, dasharray: `${len.toFixed(2)} ${(c - len).toFixed(2)}`, offset: -acc };
    acc += len;
    return seg;
  });
}

// Положение на шкале наименьшего запаса: −25…100 % → 0…100 % ширины
export function gaugePos(pct, lo = -25, hi = 100) {
  if (!isNum(pct)) return null;
  return clamp(((pct - lo) / (hi - lo)) * 100, 0, 100);
}

// Подписи шкалы без наложения (К35): «нижн. 20,000» и «ном. 20,000» у одной точки не пишутся друг на друга.
// labels — [{ at: % ширины, prio: 0 — главнее }]; ближе gap % к уже поставленной в том же ряду — во второй ряд,
// и там тесно — подпись прячется (значение остаётся в подсказке). Возвращает ряд каждой подписи: 0, 1 или −1.
export function labelRows(labels, gap = 18) {
  const rows = [[], []];
  const out = new Array((labels || []).length).fill(-1);
  const order = (labels || []).map((l, i) => ({ ...l, i })).filter((l) => isNum(l.at))
    .sort((a, b) => (a.prio ?? 0) - (b.prio ?? 0) || a.at - b.at);
  for (const l of order) {
    const r = rows.findIndex((row) => row.every((x) => Math.abs(x - l.at) >= gap));
    if (r < 0) continue;
    rows[r].push(l.at);
    out[l.i] = r;
  }
  return out;
}

// Подписи шкалы допуска (К39, SPEC 3.4.4): границы и номинал. Номинал совпал с границей (то же значение или ближе
// 0,5 % шкалы) — одна подпись у границы («20,000 — нижняя и номинал»), а не две друг на друге
export function bandLabels(limits, nominalAt = null, nominalValue = null) {
  const out = (limits || []).map((l) => ({ at: l.at, side: l.side, value: l.value, nominal: false }));
  if (nominalAt === null || nominalAt === undefined) return out;
  const same = out.find((l) => (Number.isFinite(nominalValue) && Math.abs(l.value - nominalValue) < 1e-9) || Math.abs(l.at - nominalAt) < 0.5);
  if (same) same.nominal = true;
  else out.push({ at: nominalAt, side: 'nom', value: nominalValue, nominal: true });
  return out;
}
