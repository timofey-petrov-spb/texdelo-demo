// Текущий круг сюжета (SPEC 5.6; К37, П1). Без DOM — проверяется node --test (live.test.mjs).
// Номер детали живого стенда — «BD-01-0114-Ra427ea41-C3»: метка прогона эмулятора R… и круг сюжета C<n>.
// Повторы одной детали разных кругов не показываются (SPEC 3.2, 5.6): видна только деталь последнего круга с тем же
// номером; детали прежнего прогона эмулятора (перезапуск без чистого журнала) — не видны. Деталь прошлого круга
// видна, пока её двойник нового круга ещё не зарегистрирован, — на смене круга «стоп», очередь и полоса не
// пропадают разом, а сменяются деталь за деталью. Номер без круга (демо, ручной ввод) — всегда виден.
// Договорённость имён (PLAN.md, раздел 7): inView(app, itemId) — видна ли деталь; app.lapFilter = 'current' | 'all'.

const LAP = /(?:-R([0-9A-Za-z]+))?-C(\d+)$/;

// Круг детали по номеру: 3 для «…-C3», null — номер без круга
export function lapOf(itemId) {
  const m = LAP.exec(String(itemId ?? ''));
  return m ? Number(m[2]) : null;
}

function parse(itemId) {
  const s = String(itemId ?? '');
  const m = LAP.exec(s);
  return m ? { base: s.slice(0, m.index), run: m[1] || '', lap: Number(m[2]) } : null;
}

const lapMemo = new WeakMap();

// Сводка кругов по состоянию: прогон — у детали с самой свежей записью журнала; для каждого номера детали этого
// прогона — последний круг. Считается один раз на запись журнала.
function laps(state) {
  const memo = lapMemo.get(state.items);
  if (memo && memo.seq === state.seq && memo.size === state.items.size) return memo;
  let run = null;
  let top = -Infinity;
  const parsed = [];
  for (const id of state.items.keys()) {
    const p = parse(id);
    if (!p) continue;
    parsed.push(p);
    const s = state.itemSeq?.get(id) ?? 0;
    if (s > top) {
      top = s;
      run = p.run;
    }
  }
  const last = new Map();
  let lap = null;
  for (const p of parsed) {
    if (p.run !== run) continue;
    if (!(last.get(p.base) >= p.lap)) last.set(p.base, p.lap);
    if (lap === null || p.lap > lap) lap = p.lap;
  }
  const out = { seq: state.seq, size: state.items.size, run, lap, last };
  lapMemo.set(state.items, out);
  return out;
}

// Текущий круг: { run, lap } — прогон с самой свежей записью и наибольший круг в нём; null — кругов нет
export function currentLap(state) {
  if (!state?.items) return null;
  const l = laps(state);
  return l.lap === null ? null : { run: l.run, lap: l.lap };
}

// Видна ли деталь: lapFilter 'current' (по умолчанию) — последний круг своего номера в текущем прогоне; 'all' —
// «Вся смена», всё
export function lapVisible(state, itemId, lapFilter = 'current') {
  if (lapFilter === 'all' || !itemId || !state?.items) return true;
  const p = parse(itemId);
  if (!p) return true;
  const l = laps(state);
  if (l.lap === null) return true;
  if (p.run !== l.run) return false;
  const last = l.last.get(p.base);
  return last === undefined || p.lap >= last;
}

// Деталь текущего прогона эмулятора (или номер без круга)? Круг — не важен
export function runVisible(state, itemId) {
  const p = parse(itemId);
  if (!p || !state?.items) return true;
  const l = laps(state);
  return l.lap === null || p.run === l.run;
}

// Из набора деталей одного экрана (строки полосы, очередь ОТК) — по одной на номер детали: последнего круга среди
// них. Деталь прошлого круга остаётся, пока её двойник не появился в том же наборе: «стоп» прошлого круга виден
// (и эскалирует) до «стопа» нового, деталь у ОТК — пока двойник не дошёл до ОТК. Номер без круга — всегда
export function latestPerDetail(state, ids) {
  const best = new Map();
  const out = new Set();
  for (const id of ids || []) {
    const p = parse(id);
    if (!p) {
      out.add(id);
      continue;
    }
    if (!runVisible(state, id)) continue;
    const b = best.get(p.base);
    if (!b || p.lap > b.lap) best.set(p.base, { id, lap: p.lap });
  }
  for (const { id } of best.values()) out.add(id);
  return out;
}

// Детали, у которых есть строки «Требует действия», — их называет attn.js (setStripContext): для них «текущий
// круг» — по одной на номер среди строк (latestPerDetail), чтобы полоса, значки строки статуса и плитки считали
// одно и то же (значок «✕ 0 Стоп» при строке «Стоп» в полосе — QA волны 1). Считается раз на запись журнала
let entryIdsOf = null;
const ctxMemo = new WeakMap();

export function setStripContext(fn) {
  entryIdsOf = typeof fn === 'function' ? fn : null;
}

function stripContext(state) {
  if (!entryIdsOf || !state?.items) return null;
  const m = ctxMemo.get(state.items);
  if (m && m.seq === state.seq && m.size === state.items.size) return m;
  const ids = [...(entryIdsOf(state) || [])];
  const out = { seq: state.seq, size: state.items.size, ids: new Set(ids), latest: latestPerDetail(state, ids) };
  ctxMemo.set(state.items, out);
  return out;
}

// Видна ли деталь на экранах табло (app.lapFilter): у деталей со строками полосы — по одной на номер среди строк,
// у остальных — последний круг своего номера. Полоса, значки строки статуса и плитки (К38, lapKeep) зовут inView,
// очередь ОТК фильтрует сама (otkQueue)
export function inView(app, itemId) {
  const filter = app?.lapFilter || 'current';
  if (filter === 'all' || !itemId) return true;
  const ctx = stripContext(app?.state);
  if (ctx?.ids.has(itemId)) return ctx.latest.has(itemId);
  return lapVisible(app?.state, itemId, filter);
}
