// Черновики решений (К39, П4а; SPEC 3.5 п. 2). Что человек начал решать — вариант, причина, срок, категория,
// открыто ли окно, ключ повтора и номер записи, на которую он смотрел, — живёт здесь, а не в DOM: перерисовка
// экрана, уход на другую вкладку табло и возврат, перезагрузка страницы его не стирают. Черновик уходит только
// после записи решения или явного «Удалить черновик» / «Отмена».
//
// Ключи (постоянные, одни и те же у детали, окна решения и панели карточки):
//   item:<полный номер>:acceptance — решение по приёмке детали (вернуть, исправить на месте, принять);
//   item:<полный номер>:hold       — удержание и снятие удержания (окно из шапки детали);
//   card:<nc_id>:decision          — решение по карточке несоответствия (панель карточки, К40).
//
// Копия — в sessionStorage (живёт, пока открыта вкладка браузера); каждое чтение и запись — в try/catch: в
// приватном окне и при запрете хранилища черновик остаётся в памяти модуля. Без DOM — проверяется node --test.

import { idempotencyKey } from './actions.js';

export const DRAFT_PREFIX = 'texdelo:draft:';
export const SCOPES = ['acceptance', 'hold', 'decision'];

// Поля черновика: всё остальное отбрасывается (в хранилище не попадает ни DOM, ни ответ ядра)
export const DRAFT_FIELDS = ['code', 'reason', 'due', 'category', 'open', 'idem', 'basedOnSeq', 'focus', 'savedAt'];

// Ключ черновика по цели решения: изделие — приёмка или удержание, карточка — решение по карточке
export function draftKey(target, scope = 'acceptance') {
  const id = target?.id ?? target?.item_id ?? target?.nc_id;
  if (id === undefined || id === null || id === '') return '';
  const kind = target?.kind;
  if (kind === 'nonconformance' || kind === 'card' || (!kind && target?.nc_id)) return `card:${id}:decision`;
  return `item:${id}:${scope === 'hold' ? 'hold' : 'acceptance'}`;
}

// К какому черновику относится решение: удержание и его снятие — отдельное окно из шапки детали
export function scopeOf(action, target = null) {
  if (target?.kind === 'nonconformance' || target?.kind === 'card') return 'decision';
  return action?.kind === 'hold' ? 'hold' : 'acceptance';
}

// Пустой черновик — человек ещё ничего не написал и не выбрал срок или категорию: окно можно закрыть без вопроса,
// а рабочая зона через 30 с без ввода снова живая (SPEC 3.4.10)
export function isEmptyDraft(d) {
  if (!d) return true;
  return !String(d.reason || '').trim() && !d.category && (d.due === null || d.due === undefined || d.due === '');
}

function pick(obj) {
  const out = {};
  for (const k of DRAFT_FIELDS) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function safeStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null; // доступ к хранилищу запрещён (приватный режим, песочница)
  }
}

// «черновик сохранён 14:05» — ЧЧ:ММ по часам компьютера (на стенде — МСК)
export function savedText(d) {
  const t = Number(d?.savedAt);
  if (!Number.isFinite(t) || t <= 0) return '';
  const x = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `черновик сохранён ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function createDrafts({ storage = safeStorage(), now = () => Date.now(), newKey = idempotencyKey } = {}) {
  const mem = new Map();
  const listeners = new Set();

  function read(key) {
    if (mem.has(key)) return mem.get(key);
    let d = null;
    try {
      const raw = storage?.getItem(DRAFT_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        d = parsed && typeof parsed === 'object' ? pick(parsed) : null;
      }
    } catch {
      d = null; // испорченная копия или запрет хранилища — черновика нет
    }
    if (d) mem.set(key, d);
    return d;
  }

  function write(key, d) {
    mem.set(key, d);
    try {
      storage?.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
    } catch {
      // хранилище переполнено или запрещено — черновик живёт в памяти модуля
    }
  }

  function emit(key, d) {
    for (const f of listeners) {
      try {
        f(key, d);
      } catch {
        // подписчик упал — остальные всё равно узнают
      }
    }
  }

  return {
    // копия черновика (менять — только через save), или null
    get(key) {
      if (!key) return null;
      const d = read(key);
      return d ? { ...d } : null;
    },
    has(key) {
      return !!key && !!read(key);
    },
    // слить поля в черновик; ключ повтора создаётся один раз и живёт до записи решения — повторная подпись
    // того же решения (после «данные изменились» или обрыва связи) не создаст второй записи
    save(key, patch = {}) {
      if (!key) return null;
      const old = read(key) || {};
      const d = { ...old, ...pick(patch), savedAt: now() };
      if (!d.idem) d.idem = newKey();
      write(key, d);
      emit(key, { ...d });
      return { ...d };
    },
    // решение записано, «Отмена» или «Удалить черновик»
    drop(key) {
      if (!key) return;
      const had = mem.has(key) || !!read(key);
      mem.delete(key);
      try {
        storage?.removeItem(DRAFT_PREFIX + key);
      } catch {
        // запрет хранилища — копии там и не было
      }
      if (had) emit(key, null);
    },
    // ключи черновиков в памяти и в хранилище (для «есть черновик» на экране)
    keys() {
      const out = new Set(mem.keys());
      try {
        for (let i = 0; i < (storage?.length || 0); i += 1) {
          const k = storage.key(i);
          if (k && k.startsWith(DRAFT_PREFIX)) out.add(k.slice(DRAFT_PREFIX.length));
        }
      } catch {
        // без хранилища — только память
      }
      return [...out];
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Один набор черновиков на страницу: окно решения (К39), панель карточки (К40) и старая форма (accept.js)
// видят одно и то же
export const drafts = createDrafts();

export const getDraft = (key) => drafts.get(key);
export const saveDraft = (key, patch) => drafts.save(key, patch);
export const dropDraft = (key) => drafts.drop(key);
