// Придержка списков (К35): история детали, лента событий, «Требует действия». Пока человек прокрутил список от
// начала, новые записи в него не вставляются и не сдвигают то, что он читает, — считаются, и сверху плашка
// «новых записей: N — показать». Вернулся к началу или нажал «показать» — список снова живой.
// Экран перерисовывается только когда отрисовываемый срез данных действительно изменился (sliceSig).
// Без DOM — проверяется node --test.

// Список прокручен от начала — придерживать (пара пикселей — не прокрутка: дрожание колеса и масштаба)
export const HOLD_PX = 4;

export function isHeld(scrollTop) {
  return Number(scrollTop) > HOLD_PX;
}

// Записи с номером не новее frozen — те, что человек уже видит; остальные — новые (счёт на плашке)
export function holdSplit(rows, frozen, seqOf = (r) => r?.seq) {
  const list = Array.isArray(rows) ? rows : [];
  if (frozen === null || frozen === undefined) return { shown: list, fresh: 0 };
  const shown = list.filter((r) => (Number(seqOf(r)) || 0) <= frozen);
  return { shown, fresh: list.length - shown.length };
}

export function topSeq(rows, seqOf = (r) => r?.seq) {
  let top = null;
  for (const r of rows || []) {
    const s = Number(seqOf(r));
    if (Number.isFinite(s) && (top === null || s > top)) top = s;
  }
  return top;
}

// Строки по ключу: какие из новых ещё не видны (для полосы, где порядок — по тяжести, а не по времени)
export function freshKeys(nextKeys, shownKeys) {
  const seen = new Set(shownKeys || []);
  return (nextKeys || []).filter((k) => !seen.has(k));
}

export function freshText(n) {
  return `новых записей: ${n} — показать`;
}

// Подпись среза данных: объект без полей, которые меняются с каждой записью журнала, но на экране не видны
// (as_of_seq, based_on_seq, счётчик звеньев общей цепочки) — по ней профиль решает, перерисовываться ли
const VOLATILE = new Set(['as_of_seq', 'based_on_seq', 'generated_at']);

export function sliceSig(value) {
  return JSON.stringify(value, (k, v) => {
    if (VOLATILE.has(k)) return undefined;
    if (k === 'chain' && v && typeof v === 'object' && !Array.isArray(v)) return { code: v.code, signers: v.signers };
    return v;
  });
}
