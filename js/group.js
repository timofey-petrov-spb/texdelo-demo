// Одинаковые сообщения — одной строкой с числом: «первая деталь после наладки ещё без результата ×10».
// Десятки повторов не должны вытеснять с экрана то, что случилось один раз. Без DOM — проверяется node --test.

import { ITEM_ID_G, itemsInText, itemTitle, shortItem } from './format.js';
import { humanText } from './names.js';
import { plainText } from './plain.js';

// составные части; у живого стенда с повтором сюжета — с меткой прогона и круга
const COMPONENT = /\b(?:K|KR|DD|PE)-01-\d{4}(?:-R[0-9A-Za-z]+-C\d+)?\b/g;

// Текст без номеров деталей: по нему повторы узнаются как одно и то же сообщение
export function normalizeText(s) {
  return String(s ?? '').replace(ITEM_ID_G, '№').replace(COMPONENT, '№').replace(/\s+/g, ' ').trim();
}

// Разделитель «·» из текстов ядра — запятой: строка читается как фраза, а не как список меток
export function tidy(s) {
  return String(s ?? '').replace(/\s+·\s+/g, ', ').replace(/\s+/g, ' ').trim();
}

// Текст ядра для экрана: фразой (без «·»), с номерами деталей, как на метках (без метки прогона эмулятора),
// участками и характеристиками словами и карточками по порядку (names.js)
// и без служебных значений: флагов, кодов статусов, номеров решений, ссылок на пункты документов (plain.js)
export function clean(s) {
  return humanText(itemsInText(tidy(plainText(s))));
}

// Номера деталей в тексте по местам: slots[i] — какие номера стояли i-м в повторах одного сообщения
export function addMentions(slots, text) {
  (String(text ?? '').match(ITEM_ID_G) || []).forEach((id, i) => {
    if (!slots[i]) slots[i] = [];
    if (!slots[i].includes(id)) slots[i].push(id);
  });
  return slots;
}

function listOf(ids) {
  const sorted = [...ids].sort((a, b) => shortItem(a).localeCompare(shortItem(b)) || a.localeCompare(b));
  const head = itemTitle(sorted[0]);
  const tail = sorted.slice(1).map(shortItem);
  return sorted.length <= 3 ? [head, ...tail].join(', ') : `${head}…${tail.at(-1)}`;
}

// Текст сгруппированных повторов: место, где повторы называют разные детали, — со всеми номерами
// («БД-01-0104, 0105, 0106»; больше трёх — «БД-01-0101…0110»), а не с номером последней; одинаковое — как есть
export function mentionText(text, slots = []) {
  let i = 0;
  return humanText(itemsInText(tidy(plainText(text)).replace(ITEM_ID_G, (id) => {
    const ids = slots[i++] || [];
    return ids.length > 1 ? listOf(ids) : itemTitle(id);
  })));
}

// Какие события ленты сворачиваются по смыслу (без номеров деталей): предупреждения, карточки, квитанции.
// Ход деталей по участкам — нет: там номер детали и есть содержание строки.
const BY_MEANING = new Set(['warning', 'card']);

export function feedKey(e) {
  const text = BY_MEANING.has(e?.type) || e?.event_type === 'external.receipt' ? normalizeText(e?.summary) : String(e?.summary ?? '');
  return [e?.type || '', e?.level || '', e?.code || '', text].join('|');
}

// Лента от новых к старым → группы от новых к старым; у группы — число повторов, детали, упомянутые в тексте
// номера по местам и время первого и последнего повтора. limit — сколько строк показать.
export function groupFeed(entries, limit = 60) {
  const groups = new Map();
  const out = [];
  for (const e of entries || []) {
    if (!e) continue;
    const k = feedKey(e);
    let g = groups.get(k);
    if (!g) {
      if (out.length >= limit) continue;
      g = { ...e, group: k, count: 0, items: [], slots: [], last_at: e.at || null, first_at: e.at || null };
      groups.set(k, g);
      out.push(g);
    }
    g.count += 1;
    if (e.item_id && !g.items.includes(e.item_id)) g.items.push(e.item_id);
    addMentions(g.slots, e.summary);
    if (e.at) g.first_at = e.at;
  }
  return out;
}

// Строка группы ленты: повторы про разные детали — со всеми номерами
export function groupText(g) {
  return mentionText(g?.summary, g?.slots);
}

// «×10» — только для повторов
export function countMark(n) {
  return n > 1 ? `×${n}` : '';
}
