// Плитка участка и метки деталей на табло линии. Норма — серым; цвет — только у отклонения: зона участка
// хуже нормы, точка кривой вне нормы, удержанная или отклонившаяся деталь.

import { clear, h, zoneBadge } from './dom.js';
import {
  coverageText, fmtPct, isAbnormal, itemSkipped, itemTitle, MACHINE, machineTone, shortItem, statusTitle, ZONES, zoneKey,
} from './format.js';
import { clean } from './group.js';
import { distanceText, itemMarginLine, learnLimits, marginLine, pointMargin, profileMargins } from './margin.js';
import { sliceSig } from './hold.js';
import { createSpark } from './spark.js';
import { lapKeep, warningFact } from './attention.js';
import { itemsAt, stationKey } from './state.js';
import { isAcceptance, machineName } from './words.js';

// ---------- метки деталей ----------

function chipTitle(it, limits) {
  const z = zoneKey(it.zone);
  const parts = [itemTitle(it.item_id), statusTitle(it), ZONES[z].label];
  if (Number.isFinite(it.min_margin_pct)) parts.push(`${itemMarginLine(it, limits)} (${it.min_margin_characteristic || ''})`);
  if (it.coverage) parts.push(`покрытие ${coverageText(it.coverage)}`);
  if (it.on_hold) parts.push('удержано');
  if (it.open_cards) parts.push(`открытых карточек: ${it.open_cards}`);
  return parts.filter(Boolean).join('; ');
}

// Метка серая; цвет — при отклонении зоны, удержании или открытой карточке; принятая ОТК — приглушённая с ✓
const skippedOf = itemSkipped;

// Деталь отклонилась — её метка видна на плитке «Линии»: удержана, пропуск проверки, открытая карточка, зона хуже
// «запас снижен» (у границы, признаки несоответствия, оценка невозможна); остальные метки не рисуются (SPEC.md 3.2)
export function chipOdd(it) {
  const z = zoneKey(it.zone);
  return !!it.on_hold || !!skippedOf(it) || !!it.open_cards || ['near_limit', 'beyond_limit', 'not_assessable'].includes(z);
}

export function chipClass(it) {
  const z = zoneKey(it.zone);
  const odd = isAbnormal(z);
  const hold = !!it.on_hold;
  return ['chip', odd ? `z-${z} chip-odd` : '', skippedOf(it) ? 'chip-skip' : '', hold ? 'chip-hold' : '',
    it.open_cards ? 'chip-card' : '', it.accepted ? 'chip-done' : ''].filter(Boolean).join(' ');
}

// Знак метки: принято ✓, пропуск контроля ✕ (это «стоп», а не «не проверено»), удержано ⏸, иначе знак зоны — только
// вне нормы
export function chipGlyph(it) {
  if (it.accepted) return '✓';
  if (skippedOf(it)) return '✕';
  if (it.on_hold) return '⏸';
  const z = zoneKey(it.zone);
  return isAbnormal(z) ? ZONES[z].icon : '';
}

export function chipEl(app, it) {
  const el = h('button', { class: 'chip', type: 'button', dataset: { id: it.item_id },
    onclick: () => app.go(`#/item/${encodeURIComponent(it.item_id)}`) },
  [h('span', { class: 'chip-g', 'aria-hidden': 'true' }), h('span', { class: 'chip-n' })]);
  updateChip(el, it, app.limits);
  return el;
}

// Метка меняется только когда меняется то, что на ней видно (К35: без «мнимых» перерисовок)
const chipSigs = new WeakMap();

export function updateChip(el, it, limits) {
  const cls = `${chipClass(it)}${el.dataset.leaving ? ' chip-out' : ''}`;
  const title = chipTitle(it, limits);
  const sig = `${cls}|${chipGlyph(it)}|${it.item_id}|${title}`;
  if (chipSigs.get(el) === sig) return;
  chipSigs.set(el, sig);
  el.className = cls;
  el.firstChild.textContent = chipGlyph(it);
  el.lastChild.textContent = shortItem(it.item_id);
  el.title = title;
  el.setAttribute('aria-label', title);
}

// ---------- границы характеристик для «мм до границы» ----------
// Точка кривой несёт только запас в %; границы той же характеристики берутся из профиля любой детали (один раз).

export function ensureLimits(app, points, onLearned) {
  app.limits = app.limits || new Map();
  app.limitTries = app.limitTries || new Map();
  const byChar = new Map();
  for (const p of [...(points || [])].reverse()) {
    if (p?.characteristic_id && p.item_id && !app.limits.has(p.characteristic_id)) {
      if (!byChar.has(p.characteristic_id)) byChar.set(p.characteristic_id, []);
      byChar.get(p.characteristic_id).push(p.item_id);
    }
  }
  for (const [cid, ids] of byChar) {
    const tried = app.limitTries.get(cid) || new Set();
    app.limitTries.set(cid, tried);
    const id = ids.find((x) => !tried.has(x));
    if (!id || tried.size >= 4 || tried.busy) continue;
    tried.add(id);
    tried.busy = true;
    app.api.profile(id).then((p) => {
      if (learnLimits(app.limits, profileMargins(p))) onLearned?.();
    }).catch(() => {}).finally(() => {
      tried.busy = false;
    });
  }
}

// ---------- статус участка — худшее по его деталям (SPEC.md 6.3, свёртка вверх) ----------
// Пропуск контроля или «стоп» по детали участка — «✕ Стоп»; удержание или открытая карточка — «! Решение»; уход режима —
// «◐ Уход режима»; иначе — зона запаса (null). Только детали текущего круга
export const WORST = {
  critical: { tone: 'critical', icon: '✕', label: 'Стоп' },
  serious: { tone: 'serious', icon: '!', label: 'Решение' },
  caution: { tone: 'caution', icon: '◐', label: 'Уход режима' },
};

export function stationWorst(app, lineId, stationId, st = {}) {
  const keep = lapKeep(app);
  const here = itemsAt(app.state, lineId, stationId).filter((it) => !keep || keep(it.item_id));
  // предупреждение по детали — там, где деталь сейчас (ядро кладёт его и на участок пропущенной точки, и на обе линии)
  const ids = new Set(here.map((it) => it.item_id));
  const stop = (st.warnings || []).some((w) => (w.item_id ? ids.has(w.item_id) : true) && warningFact(w).severity === 'critical');
  if (stop || here.some((it) => skippedOf(it))) return WORST.critical;
  if (here.some((it) => it.on_hold || it.open_cards)) return WORST.serious;
  if (st.drift) return WORST.caution;
  return null;
}

export function worstBadge(w, { label = false, cls = '' } = {}) {
  return h('span', { class: `zbadge sev-${w.tone} ${cls}`.trim(), title: w.label }, [
    h('span', { class: 'zic', 'aria-hidden': 'true', text: w.icon }), label ? w.label : null]);
}

// ---------- плитка участка ----------
function setAttr(node, key, value) {
  if (node[key] !== value) node[key] = value;
}

// Около 150×110 px на 1280: знак и крупное число — запас последней детали; кривая запаса; одна нижняя строка —
// в норме «N в работе», при отклонении — что именно («уход режима», «⏸ удержано 1», станок словами, метки деталей
// у границы). Станки, пороги и номера деталей — в подсказке. Клик по плитке — «Участок».

function machineWords(line, st) {
  return (st.equipment_ids || []).map((e) => {
    const ms = line?.equipment.get(e)?.machine_state;
    return { id: e, ms, word: MACHINE[ms] || ms || '', tone: machineTone(ms) };
  });
}

export function stationTile(app, lineId, stationId, onLearned) {
  const href = `#/station/${encodeURIComponent(lineId)}/${encodeURIComponent(stationId)}`;
  const title = h('a', { class: 't-title', href });
  const status = h('span', { class: 't-status' });
  const sparkBox = h('div', { class: 't-spark' });
  const margin = h('div', { class: 't-margin' });
  const counts = h('span', { class: 't-counts' });
  const lane = h('span', { class: 't-lane', role: 'list' });
  const el = h('article', { class: 'tile', dataset: { key: stationKey(lineId, stationId) } },
    [h('header', { class: 't-head' }, [status, margin, title]), sparkBox, h('div', { class: 't-foot' }, [counts, lane])]);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.chip, .pt, a')) return;
    app.go(href);
  });
  const spark = createSpark(sparkBox, { label: 'живая кривая запаса участка', onPoint: (id) => app.go(`#/item/${encodeURIComponent(id)}`) });
  let sig = '';
  return {
    el, lane,
    update() {
      const line = app.state.lines.get(lineId);
      const st = line?.stations.get(stationId) || { station_id: stationId };
      // плитка перерисовывается, только если изменился её участок, станки, пороги или выученные границы
      const eq = machineWords(line, st);
      const worst = stationWorst(app, lineId, stationId, st);
      const next = sliceSig([st, eq.map((e) => e.ms).join(','), line?.thresholds, app.limits?.size || 0, worst?.tone]);
      if (next === sig) return;
      sig = next;
      const z = zoneKey(st.zone);
      const odd = isAbnormal(z) || !!worst;
      // узлы трогаются, только если их вид сменился (QA В-36: шапки плиток не пересобираются при каждой точке)
      setAttr(el, 'className', `tile${odd ? ` tile-odd ${worst ? `sev-${worst.tone}` : `z-${z}`}` : ''}`);
      setAttr(title, 'textContent', st.title || stationId);
      const statusSig = `${worst?.tone || ''}|${z}`;
      if (status.dataset.sig !== statusSig) {
        status.dataset.sig = statusSig;
        clear(status).append(worst ? worstBadge(worst) : zoneBadge(z, { label: false }));
      }
      const pts = st.recent || [];
      spark.update(pts, { drift: st.drift, thresholds: line?.thresholds });
      const lastPt = pts.at(-1);
      let tip = '';
      if (lastPt) {
        const m = pointMargin(lastPt, app.limits);
        const pz = zoneKey(lastPt.zone);
        setAttr(margin, 'className', `t-margin${isAbnormal(pz) ? ` z-${pz} t-margin-odd` : ''}`);
        setAttr(margin, 'textContent', Number.isFinite(lastPt.margin_pct) ? fmtPct(lastPt.margin_pct) : '—');
        tip = [`Последняя деталь ${itemTitle(lastPt.item_id)}: ${marginLine(m)}`, distanceText(m), ZONES[pz].label,
          app.limits?.get(lastPt.characteristic_id)?.title].filter(Boolean).join(', ');
        ensureLimits(app, pts, onLearned);
      } else {
        setAttr(margin, 'className', 't-margin');
        setAttr(margin, 'textContent', '—');
        tip = 'Результатов пока нет';
      }
      // детали прошлых кругов сюжета не считаются (SPEC.md 5.6)
      const keep = lapKeep(app);
      const hold = (Array.isArray(st.on_hold) ? st.on_hold : []).filter((x) => !keep || keep(x?.item_id || x)).length;
      const inWork = (Array.isArray(st.items_in_work) ? st.items_in_work : []).filter((x) => !keep || keep(x?.item_id || x));
      const work = Array.isArray(st.items_in_work) ? inWork.length : Math.max(0, (st.wip ?? 0) - hold);
      const bad = eq.find((e) => e.tone);
      // нижняя строка: что именно не так, иначе — сколько в работе
      const foot = st.drift ? { t: 'уход режима', tone: 'caution' }
        : bad ? { t: `станок: ${bad.word}`, tone: bad.tone }
          : hold ? { t: `⏸ удержано ${hold}`, tone: 'serious' } : { t: isAcceptance(stationId, st.title) ? `${work} у ОТК` : `${work} в работе`, tone: '' };
      setAttr(counts, 'className', `t-counts${foot.tone ? ` t-counts-odd sev-${foot.tone}` : ''}`);
      setAttr(counts, 'textContent', foot.t);
      setAttr(el, 'title', [st.title || stationId, clean(st.operation_title || ''),
        eq.length ? eq.map((e) => `${machineName(e.id)}: ${e.word || 'нет данных'}`).join('; ') : '',
        inWork.length ? `в работе: ${inWork.map((x) => itemTitle(x?.item_id || x)).join(', ')}` : '', tip, 'Открыть участок'].filter(Boolean).join('\n'));
    },
    destroy() {
      spark.destroy();
    },
  };
}
