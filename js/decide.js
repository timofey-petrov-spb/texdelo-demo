// Окно решения и окно удержания (К39, П4в; SPEC 3.5, 3.5.1, 4). <dialog> на уровне body, вне перерисовываемого
// #view: обновление детали, «стоп» по ней и смена вкладки табло окно не трогают. Что человек выбрал и написал —
// в черновике drafts.js (ключ item:<id>:acceptance / item:<id>:hold), а не в DOM: ушёл на «Линию» и вернулся —
// окно и текст на месте.
// Варианты — только из allowed_actions; у каждого — подпись, «когда нажимать», «что будет» и «дальше» (подписи —
// decisionText от К40, пока её нет — словарь ниже по SPEC 4.2). «Принять ОТК» недоступно серым с причиной;
// других недоступных нет. Причина — готовыми кнопками и своими словами; срок — кнопками. «Подписать решение»
// неактивна, пока не хватает обязательного, и под ней сказано, чего. Ответ ядра «данные изменились» — окно
// остаётся, ключ повтора тот же: повторная подпись не создаст второго решения.

import { actionLabel, decisionRequest, dueAt, isStamp, parseActions } from './actions.js';
import { decisionMessage, decisionOk } from './api.js';
import { clear, h, toast } from './dom.js';
import { SEP } from './checklist.js';
import { draftKey, drafts, isEmptyDraft, savedText } from './drafts.js';
import { itemParts } from './names.js';
import * as TEXTS from './texts.js';

// ---------- без DOM: варианты, причины, чего не хватает ----------

// Подписи и пояснения по SPEC 4.2 — запасной словарь, пока К40 не опубликовал decisionText(target, code, role)
export const VARIANT_TEXTS = {
  'acceptance:accept': { label: 'Принять ОТК', when: 'все условия выполнены.',
    what: 'Клеймо с вашей подписью, квитанции в MES и 1С, деталь уходит на склад.', next: '', reason: 'none' },
  'acceptance:accept_after_rework': { label: 'Принять ОТК после доработки', when: 'карточки закрыты доработкой, новая проверка чистая.',
    what: 'Клеймо «принято после доработки», квитанции в MES и 1С.', next: '', reason: 'none' },
  'acceptance:return_for_rework': { label: 'Вернуть на доработку', when: 'дефект устраним переделкой на участке, деталь предъявят заново.',
    what: 'В дело записан исход «возврат на доработку». Деталь не удерживается, карточка не открывается.', next: 'мастер участка', reason: 'required' },
  'correction:start_correction': { label: 'Поручить исправить на месте, со сроком', when: 'мелочь, которую исправят здесь же за часы.',
    what: 'Поручение мастеру; деталь не удерживается, карточки нет. Не отмечено «Исправлено» к сроку — придёт предупреждение «исправление просрочено».',
    next: 'мастер участка', reason: 'required', due: true },
  'hold:hold': { label: 'Удержать деталь', when: 'есть сомнение — деталь не должна идти дальше, пока не разберутся.',
    what: 'Деталь остановится на месте: MES не даст следующую операцию, клеймо поставить нельзя. Это не решение о качестве.',
    next: 'снять удержание может инженер ОТК', reason: 'required' },
  'hold:release': { label: 'Снять удержание', when: 'сомнение разрешено.',
    what: 'MES снова пустит деталь. Карточки и предупреждения останутся.', next: '', reason: 'required' },
  'containment:stop_operation': { label: 'Остановить операцию и вызвать технолога', when: 'в идущей операции что-то не так.',
    what: 'Операция остановлена, технолог получает оповещение.', next: 'технолог', reason: 'required' },
};

// Готовые причины (SPEC 3.5, 3.5.1; ui/texts.py REASON_HINTS)
export const REASON_CHIPS = {
  'acceptance:return_for_rework': ['Зачистить и предъявить повторно', 'Размер у границы — перемерить и предъявить', 'Нет документа в пакете', 'Другое'],
  'correction:start_correction': ['Зачистить заусенец', 'Дотянуть крепёж', 'Приложить документ', 'Другое'],
  'hold:hold': ['Пропуск контроля', 'Ждём повторный замер', 'Сомнение в приборе', 'Ждём решения технолога', 'До решения по карточке', 'Другое'],
  'hold:release': ['Повторный замер в норме', 'Решение по карточке принято', 'Прибор проверен', 'Другое'],
  'containment:stop_operation': ['Параметр режима вне нормы', 'Другое'],
};
export const OTHER = 'Другое';

// Срок исправления на месте — кнопками (минуты от нажатия «Подписать»)
export const DUE_CHIPS = [[60, '1 ч'], [120, '2 ч'], [240, '4 ч'], [480, 'до конца смены']];

export const MIN_REASON = 5;

// Какие решения показывать в окне: приёмка — всё по детали, кроме удержания; окно удержания — только удержание
const SCOPE_KINDS = { acceptance: ['acceptance', 'correction'], hold: ['hold'] };

function textsOf(a, role) {
  const own = VARIANT_TEXTS[a.code] || {};
  let k40 = null;
  try {
    k40 = typeof TEXTS.decisionText === 'function' ? TEXTS.decisionText('item', a.code, role) : null;
  } catch {
    k40 = null;
  }
  // словарь К40 не знает кода — своё по SPEC 4.2
  if (!k40?.label || k40.known === false || /без названия/i.test(k40.label)) k40 = null;
  const label = k40?.label || own.label || actionLabel(a);
  return {
    label, when: k40?.when || own.when || '', what: k40?.what || own.what || '', next: k40?.next ?? own.next ?? '',
    reason: k40?.reason || own.reason || (TEXTS.NEEDS_REASON?.has(a.action) ? 'required' : 'none'),
    due: !!(k40?.due ?? own.due ?? a.action === 'start_correction'),
    reasons: k40?.reasons?.length ? [...k40.reasons, OTHER] : REASON_CHIPS[a.code] || [OTHER],
    prompt: k40?.prompt || '',
  };
}

// Варианты окна: [{ code, action, label, when, what, next, reason, due, disabled, why }]. «Принять ОТК» без права
// сейчас (есть препятствия) — серым с причиной, только если роль вообще может ставить клеймо (canStamp)
export function variants(actions, scope = 'acceptance', { acceptWhy = '', canStamp = false, role = null } = {}) {
  const kinds = SCOPE_KINDS[scope] || SCOPE_KINDS.acceptance;
  const list = parseActions(actions).filter((a) => kinds.includes(a.kind));
  const out = list.map((a) => ({ code: a.code, action: a, ...textsOf(a, role), disabled: false, why: '' }));
  if (scope === 'acceptance' && !list.some(isStamp) && canStamp) {
    const a = { kind: 'acceptance', action: 'accept', disposition: null, code: 'acceptance:accept' };
    out.unshift({ code: a.code, action: a, ...textsOf(a, role), disabled: true, why: acceptWhy || 'есть препятствия' });
  }
  // клеймо — первым, как в окне SPEC 3.5; остальные — в порядке ядра
  return out.sort((x, y) => Number(isStamp(y.action)) - Number(isStamp(x.action)));
}

// Чего не хватает, чтобы подписать: «выберите решение», «нужна причина», «нужен срок»
export function missing(v, { reason = '', due = null } = {}) {
  if (!v || v.disabled) return ['выберите решение'];
  const out = [];
  if (v.reason === 'required' && String(reason || '').trim().length < MIN_REASON) out.push('нужна причина');
  if (v.due && !(Number(due) > 0)) out.push('нужен срок');
  return out;
}

// Нажата готовая причина: пустое поле или поле с прошлой готовой причиной — заменить, своё — дописать через «; »
export function applyChip(value, chip, lastChip = '') {
  const v = String(value || '').trim();
  if (chip === OTHER) return v;
  if (!v || v === lastChip) return chip;
  if (v.includes(chip)) return v;
  return `${v}; ${chip[0].toLowerCase()}${chip.slice(1)}`;
}

// «Решение записано 14:06, MES: ждём квитанцию»
export function recordedText(at = Date.now()) {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `Решение записано ${pad(d.getHours())}:${pad(d.getMinutes())}${SEP}MES: ждём квитанцию`;
}

export function staleText(result) {
  const d = String(result?.detail || result?.message || '').trim();
  return `Пока вы решали, деталь изменилась${d ? `: ${d}` : ''}. Проверьте и подпишите ещё раз.`;
}

// ---------- окно ----------

let current = null; // одно окно решения на страницу

export function openDialog() {
  return current;
}

// Окно решения по детали. scope: 'acceptance' | 'hold'. actions — allowed_actions профиля.
// basedOnSeq() — запись журнала, на которую смотрит человек; onDecided({ ok, stale, result, req }) — профиль решает,
// перечитать ли себя; onClose() — окно закрыто (черновик остаётся)
export function openDecision(app, { itemId, scope = 'acceptance', actions = [], acceptWhy = '', canStamp = false,
  basedOnSeq = null, onDecided, onClose, preselect = null } = {}) {
  if (current && current.itemId === itemId && current.scope === scope) {
    current.focus();
    return current;
  }
  current?.close(true);
  const target = { kind: 'item', id: itemId };
  const key = draftKey(target, scope);
  const base = itemParts(itemId).base;
  const list = variants(actions, scope, { acceptWhy, canStamp, role: app?.role?.id });
  const saved = drafts.get(key) || {};
  const pick0 = list.find((v) => !v.disabled && v.code === (preselect || saved.code))
    || (list.filter((v) => !v.disabled).length === 1 ? list.find((v) => !v.disabled) : null);
  let d = drafts.save(key, { code: pick0?.code || saved.code || null, open: true });
  let lastChip = '';
  let lastInput = Date.now();
  let busy = false;
  let closeTimer = 0;

  const saveTag = h('span', { class: 'dlg-saved', 'aria-live': 'polite' });
  let saveTimer = 0;
  const put = (patch) => {
    lastInput = Date.now();
    d = drafts.save(key, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTag.textContent = isEmptyDraft(d) ? '' : savedText(d); }, 500);
    paintFoot();
  };
  if (!isEmptyDraft(saved)) saveTag.textContent = savedText(saved);

  const title = scope === 'hold'
    ? `${list.some((v) => v.action.action === 'release') ? 'Снять удержание' : '⏸ Удержать деталь'} ${base}`
    : `Решение по приёмке — ${base}`;
  const whileBox = h('p', { class: 'dlg-while', hidden: true, role: 'status' });
  const lead = scope === 'hold' && list[0] ? h('div', { class: 'dlg-lead' }, [h('p', { text: list[0].what }),
    list[0].next ? h('p', { class: 'muted', text: `Дальше: ${list[0].next}.` }) : null]) : null;

  const opts = h('div', { class: 'dec-opts', role: 'radiogroup', 'aria-label': 'Решение' });
  const name = `dec-${scope}-${Math.random().toString(36).slice(2, 8)}`;
  for (const v of list) {
    const input = h('input', { type: 'radio', name, value: v.code, disabled: v.disabled || null, checked: d.code === v.code || null,
      onchange: () => choose(v) });
    opts.append(h('label', { class: `dec-opt${v.disabled ? ' dec-off' : ''}${d.code === v.code ? ' on' : ''}`, dataset: { code: v.code } }, [
      input,
      h('span', { class: 'dec-body' }, [
        h('span', { class: 'dec-l' }, [h('b', { text: v.label }), v.disabled ? h('span', { class: 'dec-why', text: `недоступно: ${v.why}` }) : null]),
        v.when && !v.disabled ? h('span', { class: 'dec-when' }, [h('span', { class: 'muted', text: 'Когда: ' }), v.when.replace(/\.?$/, '.')]) : null,
        v.what ? h('span', { class: 'dec-what' }, [h('span', { class: 'muted', text: 'Что будет: ' }), v.what]) : null,
        v.next && !v.disabled ? h('span', { class: 'dec-next' }, [h('span', { class: 'muted', text: 'Дальше: ' }), v.next]) : null,
      ]),
    ]));
  }
  if (scope === 'hold' && list.length === 1) opts.hidden = true; // одно решение — выбирать нечего, пояснение сверху

  const reasonLabel = h('span', { class: 'dec-lab' });
  const chips = h('div', { class: 'chips' });
  const ta = h('textarea', { rows: 2, maxlength: 1000, 'aria-label': 'Причина решения', placeholder: 'Своими словами: что не так и что сделать',
    oninput: () => put({ reason: ta.value }) });
  ta.value = d.reason || '';
  const reasonBox = h('div', { class: 'dec-reason' }, [reasonLabel, chips, ta]);
  const dueChips = h('div', { class: 'chips' }, DUE_CHIPS.map(([m, t]) => h('button', { type: 'button', class: 'chip', dataset: { m: String(m) },
    'aria-pressed': String(Number(d.due) === m), text: t, onclick: () => { put({ due: m }); paintDue(); } })));
  const dueBox = h('div', { class: 'dec-due' }, [h('span', { class: 'dec-lab', text: 'Срок исправления (обязательно):' }), dueChips]);

  const signWhat = h('p', { class: 'dec-sign' });
  const miss = h('p', { class: 'dec-miss' });
  const status = h('p', { class: 'dec-status', role: 'status' });
  const signBtn = h('button', { type: 'button', class: 'btn btn-main', text: scope === 'hold' ? '' : 'Подписать решение', onclick: () => sign() });
  const dropBtn = h('button', { type: 'button', class: 'btn btn-link', text: 'Удалить черновик', onclick: () => {
    drafts.drop(key);
    close(true);
  } });
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Отмена', onclick: () => tryClose() });
  const ask = h('div', { class: 'dlg-ask', hidden: true, role: 'alertdialog' }, [
    h('span', { text: 'Черновик сохранён. Закрыть окно?' }),
    h('button', { type: 'button', class: 'btn', text: 'Остаться', onclick: () => { ask.hidden = true; ta.focus(); } }),
    h('button', { type: 'button', class: 'btn', text: 'Закрыть', onclick: () => close(false) }),
  ]);

  const dlg = h('dialog', { class: `dlg dec-dlg dec-${scope}`, 'aria-label': title }, [
    h('header', { class: 'dlg-h' }, [h('h2', { text: title }), saveTag,
      h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Закрыть окно', title: 'Закрыть (Esc)', text: '×', onclick: () => tryClose() })]),
    whileBox, lead, opts, reasonBox, dueBox,
    h('footer', { class: 'dlg-f' }, [signWhat, miss, status, h('div', { class: 'dlg-btns' }, [dropBtn, cancel, signBtn]), ask]),
  ]);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      tryClose();
    }
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    tryClose();
  });
  document.body.append(dlg);
  try {
    dlg.show();
  } catch {
    dlg.setAttribute('open', '');
  }

  function selected() {
    return list.find((v) => v.code === d.code && !v.disabled) || null;
  }

  function choose(v) {
    const old = selected();
    // другая причина у другого решения: готовая причина прошлого варианта не переносится
    const keep = old && ta.value.trim() && ta.value.trim() !== lastChip;
    put({ code: v.code, ...(keep ? {} : { reason: '' }) });
    if (!keep) {
      ta.value = '';
      lastChip = '';
    }
    for (const l of opts.querySelectorAll('.dec-opt')) l.classList.toggle('on', l.dataset.code === v.code);
    paintReason();
    paintDue();
  }

  function paintReason() {
    const v = selected();
    clear(chips);
    reasonBox.hidden = !v || v.reason !== 'required';
    if (reasonBox.hidden) return;
    reasonLabel.textContent = `${v.prompt || (v.action.action === 'return_for_rework' ? 'Что доработать'
      : v.action.action === 'start_correction' ? 'Что исправить' : 'Причина')} (обязательно):`;
    for (const c of v.reasons || [OTHER]) {
      chips.append(h('button', { type: 'button', class: 'chip', text: c, onclick: () => {
        ta.value = applyChip(ta.value, c, lastChip);
        if (c !== OTHER) lastChip = c;
        put({ reason: ta.value });
        ta.focus();
        ta.setSelectionRange?.(ta.value.length, ta.value.length);
      } }));
    }
  }

  function paintDue() {
    const v = selected();
    dueBox.hidden = !v?.due;
    for (const b of dueChips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(d.due) === Number(b.dataset.m)));
  }

  function paintFoot() {
    const v = selected();
    const m = missing(v, { reason: ta.value, due: d.due });
    signWhat.textContent = v ? `Вы подписываете: «${v.label}» — ${base}` : '';
    miss.textContent = busy ? '' : m.join(', ');
    signBtn.disabled = busy || m.length > 0;
    if (scope === 'hold') signBtn.textContent = v?.action.action === 'release' ? 'Снять удержание' : 'Удержать деталь';
    dropBtn.hidden = isEmptyDraft(d);
  }

  function tryClose() {
    if (busy) return;
    if (!isEmptyDraft(d)) {
      ask.hidden = false;
      ask.querySelector('button')?.focus();
      return;
    }
    drafts.drop(key); // пустой черновик не хранится
    close(false);
  }

  // force — закрыть без вопроса (решение записано, окно открыто по другой детали, страница ушла): черновик остаётся
  // открытым (open) только если окно закрыла страница, чтобы при возврате оно открылось снова
  function close(keepOpen = false) {
    clearTimeout(saveTimer);
    clearTimeout(closeTimer);
    if (drafts.has(key)) drafts.save(key, { open: !!keepOpen });
    try {
      dlg.close();
    } catch {
      dlg.removeAttribute('open');
    }
    dlg.remove();
    if (current === api) current = null;
    onClose?.();
  }

  async function sign() {
    const v = selected();
    if (!v || busy || missing(v, { reason: ta.value, due: d.due }).length) return;
    busy = true;
    paintFoot();
    // номер записи, на которую смотрит человек: деталь сверяется с ядром перед подписью — изменилось видимое
    // (карточка, удержание, приёмка) — решение не уходит, окно говорит, что именно
    status.className = 'dec-status busy';
    status.textContent = 'Сверяю деталь…';
    const got = typeof basedOnSeq === 'function' ? await basedOnSeq() : basedOnSeq;
    if (got && typeof got === 'object' && got.changed) {
      busy = false;
      status.className = 'dec-status err';
      status.textContent = staleText({ detail: got.changed });
      paintFoot();
      return;
    }
    const seq = got;
    const due = v.due ? dueAt(Number(d.due)) : null;
    const req = decisionRequest(v.action, target, { reason: ta.value, basedOnSeq: seq, due });
    d = drafts.save(key, { basedOnSeq: Number.isFinite(seq) ? seq : null });
    status.className = 'dec-status busy';
    status.textContent = 'Записываю…';
    let http = 0;
    let result = null;
    try {
      ({ http, result } = await app.api.decide(req, app.role, { idempotencyKey: d.idem }));
    } catch (e) {
      result = { detail: e?.message || String(e) };
    }
    busy = false;
    const ok = decisionOk(http, result);
    const stale = http === 409 || result?.status === 'stale';
    if (ok) {
      status.className = 'dec-status ok';
      status.textContent = recordedText();
      drafts.drop(key);
      for (const b of dlg.querySelectorAll('button, input, textarea')) b.disabled = true;
      miss.textContent = '';
      toast(`${v.label}: ${base} — записано`, 'ok');
      onDecided?.({ ok, stale: false, http, result, req });
      closeTimer = setTimeout(() => close(false), 2000);
      return;
    }
    status.className = 'dec-status err';
    status.textContent = stale ? staleText(result) : decisionMessage(http || 0, result);
    paintFoot();
    onDecided?.({ ok: false, stale, http, result, req });
  }

  const api = {
    itemId, scope, key, el: dlg,
    isOpen: () => dlg.isConnected,
    // человек в окне что-то делает: непустой черновик или ввод в последние 30 с (SPEC 3.4.10)
    holding: () => dlg.isConnected && (!isEmptyDraft(d) || Date.now() - lastInput < 30000),
    // «Пока вы писали: …» — выбор не сбрасывается
    notice(text) {
      if (!text) return;
      whileBox.hidden = false;
      whileBox.textContent = `Пока вы писали: ${text} — проверьте выбор.`;
    },
    focus() {
      (selected() && !reasonBox.hidden ? ta : dlg.querySelector('input:not([disabled])') || signBtn)?.focus();
    },
    close,
  };
  current = api;
  paintReason();
  paintDue();
  paintFoot();
  api.focus();
  return api;
}
