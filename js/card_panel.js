// Панель карточки несоответствия (SPEC.md 3.6; К40, П6б): справа 560 px поверх детали, на уровне body. Путь статусов,
// «Следующий шаг делает», «Что увидели», «Что будет, если пропустить», решение: варианты — из allowed_actions, подписи —
// decisionText, категория обязательна при «Подтвердить», причина — кнопками и полем; выбор — в черновике drafts.js
// (К39). Открывается app.openCard(nc_id) — из чек-листа, раздела «Карточки» и строки полосы.

import { cardSig, decisionRequest, missingText, panelOptions } from './actions.js';
import { decisionMessage, decisionOk } from './api.js';
import { clear, h, toast } from './dom.js';
import { seenBlock } from './evidence.js';
import { fmtTime } from './format.js';
import { gateLine, ladderLineBlock } from './ladder.js';
import {
  CARD_STEPS, cabinetUrl, cardFromAddress, cardHint, cardNextStep, cardStatus, cardTitle, cpTitle, rememberCards,
} from './names.js';
import { CATEGORY_ORDER, categoryTitle } from './texts.js';

// Черновики — drafts.js К39 (ключ card:<nc_id>:decision); пока модуля нет в ветке — в памяти вкладки
const mem = new Map();
let D = { draftKey: (t) => `card:${t.id}:decision`, savedText: () => '',
  isEmptyDraft: (d) => !d || (!String(d.reason || '').trim() && !d.category),
  drafts: { get: (k) => (mem.has(k) ? { ...mem.get(k) } : null), drop: (k) => mem.delete(k),
    save: (k, p) => { mem.set(k, { ...(mem.get(k) || {}), ...p }); return { ...mem.get(k) }; } } };
const DRAFTS = './drafts.js';
import(DRAFTS).then((m) => { if (m?.drafts) D = m; }).catch(() => {});

const POLL_MS = 1500;
const OPEN_KEY = 'texdelo:card-panel:ladder-open';

let current = null;

// «Что будет, если пропустить» раскрыто при первом открытии, дальше помнит (хранилище может быть запрещено)
let ladderOpen = true;
function ladderOpenPref() {
  try {
    const v = globalThis.sessionStorage?.getItem(OPEN_KEY);
    return v === null || v === undefined ? ladderOpen : v === '1';
  } catch {
    return ladderOpen;
  }
}
function saveLadderPref(open) {
  ladderOpen = open;
  try { globalThis.sessionStorage?.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* помним в памяти вкладки */ }
}

function pathView(status) {
  const st = cardStatus(status);
  return h('ol', { class: 'cp-path', 'aria-label': 'Путь карточки' }, CARD_STEPS.map((t, i) => h('li', {
    class: i < st.step ? 'cp-done' : i === st.step ? 'cp-now' : '', 'aria-current': i === st.step ? 'step' : null,
  }, [h('span', { class: 'cp-dot', 'aria-hidden': 'true', text: i < st.step || (st.closed && i === st.step) ? '✓' : String(i + 1) }), t])));
}

function headView(card) {
  const st = cardStatus(card.status);
  const facts = [
    h('span', { class: `cp-badge tone-${st.tone}`, text: st.badge }),
    h('span', { text: card.defect_category ? `Категория: ${categoryTitle(card.defect_category)}` : 'Категория не установлена' }),
    card.opened_at ? h('span', { text: `Открыта ${fmtTime(card.opened_at).slice(0, 5)}` }) : null,
    card.control_point_id ? h('span', { text: cpTitle(card.control_point_id, card.control_point_id) }) : null,
  ];
  const next = cardNextStep(card.status, card.defect_category);
  return [
    h('div', { class: 'cp-facts' }, facts),
    pathView(card.status),
    next ? h('p', { class: 'cp-next' }, [h('span', { class: 'muted', text: 'Следующий шаг делает: ' }), h('b', { text: next })]) : null,
  ];
}

function section(title, body, cls = '') {
  return h('section', { class: `cp-sec ${cls}`.trim() }, [h('h3', { class: 'cp-h', text: title }), body]);
}

function openPanel(app, nc, opts = {}) {
  if (!nc) return;
  if (current?.nc === nc) {
    current.el.focus?.();
    return;
  }
  closePanel(true);
  const key = D.draftKey({ kind: 'nonconformance', id: nc });
  const titleEl = h('h2', { class: 'cp-title', id: 'cp-title', title: cardHint(nc), text: cardTitle(opts.card || nc) });
  const closeBtn = h('button', { class: 'cp-x', type: 'button', 'aria-label': 'Закрыть панель карточки', title: 'Закрыть (Esc)', text: '×' });
  const ask = h('div', { class: 'cp-ask', hidden: true });
  const head = h('div', { class: 'cp-top' });
  const seen = h('div', { class: 'cp-seen-box' });
  const risk = h('details', { class: 'cp-risk', open: ladderOpenPref() });
  const decide = h('div', { class: 'cp-decide' });
  const body = h('div', { class: 'cp-body' }, [head, seen, risk, decide]);
  const el = h('aside', { class: 'cp', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cp-title', tabindex: '-1' }, [
    h('header', { class: 'cp-hd' }, [titleEl, closeBtn]), ask, body]);
  document.body.append(el);
  document.body.classList.add('cp-open');
  const st = { app, nc, key, el, card: opts.card || null, sig: '', roleKey: '', seenId: null, riskLoaded: false, busy: false };
  current = st;

  risk.addEventListener('toggle', () => saveLadderPref(risk.open));
  closeBtn.addEventListener('click', () => requestClose());
  st.onKey = (ev) => {
    if (ev.key !== 'Escape' || current !== st) return;
    if (document.querySelector('dialog[open]')) return; // окно решения поверх — сначала оно
    ev.preventDefault();
    requestClose();
  };
  document.addEventListener('keydown', st.onKey);
  // ушли с детали этой карточки (не на её страницу и не туда, откуда открыли) — панель закрывается, черновик остаётся
  st.from = globalThis.location?.hash || '';
  st.onHash = () => {
    const hsh = globalThis.location?.hash || '';
    const item = st.card?.item_id || opts.card?.item_id || '';
    const toItem = decodeURIComponent(hsh).startsWith(`#/item/${item}`); // деталь карточки ещё не знаем — любая деталь
    if (hsh !== st.from && !toItem) closePanel();
  };
  globalThis.addEventListener?.('hashchange', st.onHash);

  function requestClose() {
    const d = D.drafts.get(key);
    if ((D.isEmptyDraft(d) && !d?.code) || !ask.hidden) {
      closePanel();
      return;
    }
    clear(ask).append(h('span', { text: 'Черновик решения сохранён. Закрыть панель?' }),
      h('button', { class: 'btn btn-small', type: 'button', text: 'Остаться', onclick: () => { ask.hidden = true; } }),
      h('button', { class: 'btn btn-small', type: 'button', text: 'Закрыть', onclick: () => closePanel() }));
    ask.hidden = false;
  }

  function load() {
    const get = app.api?.card || app.api?.coreCard;
    if (typeof get !== 'function') {
      clear(head).append(h('p', { class: 'muted', text: 'Карточку ядро не отдаёт.' }));
      return;
    }
    if (st.loading) return; // запрос уже идёт — второй не нужен
    st.loading = true;
    get(nc).then((c) => {
      st.loading = false;
      if (current !== st || !c) return;
      rememberCards([c]);
      render(c);
    }).catch((e) => {
      st.loading = false;
      if (current !== st) return;
      if (!st.card) clear(head).append(h('p', { class: 'mo-fail', text: `Карточка не получена: ${e?.detail || e?.message || e}. Спрашиваю ещё раз…` }));
    });
  }

  function render(c) {
    const sig = `${cardSig(c)}${c.partial ? '|partial' : ''}`;
    const roleKey = app.role?.key || app.role?.id || '';
    if (sig === st.sig && roleKey === st.roleKey) {
      st.card = c; // тот же срез, свежий номер записи
      return;
    }
    const changedWhileWriting = st.card && st.card.status !== c.status && !D.isEmptyDraft(D.drafts.get(key));
    st.card = c;
    st.sig = sig;
    st.roleKey = roleKey;
    titleEl.textContent = cardTitle(c);
    titleEl.title = cardHint(c);
    clear(head).append(...headView(c).filter(Boolean));
    const obsId = c.signal?.event_id || c.signal?.seq || null;
    if (obsId !== st.seenId || !seen.firstChild) {
      st.seenId = obsId;
      const b = seenBlock(app, c.signal, app.thresholds || {});
      clear(seen).append(b ? section('Что увидели', b) : h('p', { class: 'muted cp-small', text: 'Наблюдения с изображением нет.' }));
    }
    // ворота — строкой, которая есть всегда (пустая скрыта): карточка из чек-листа приходит без gate_step, полная — с ним.
    // Element.append(null) пишет «null» текстом — поэтому без пустых частей
    if (!st.riskLoaded) {
      st.riskLoaded = true;
      st.gateEl = h('p', { class: 'cp-gate' });
      clear(risk).append(h('summary', { class: 'cp-h', text: 'Что будет, если пропустить' }), st.gateEl, ladderLineBlock(app, nc));
    }
    st.gateEl.textContent = gateLine(c);
    st.gateEl.hidden = !st.gateEl.textContent;
    renderDecision(c, changedWhileWriting);
  }

  function renderDecision(c, changedWhileWriting = false) {
    const role = app.role?.id || '';
    const options = panelOptions(c, role);
    const focused = decide.contains(document.activeElement) ? document.activeElement?.dataset?.f : null;
    clear(decide);
    if (c.partial) {
      decide.append(h('p', { class: 'muted', text: 'Загружаю решения по карточке…' }));
      return;
    }
    if (!options.length) {
      const closed = cardStatus(c.status).closed;
      decide.append(section('Решение по карточке', h('p', { class: 'muted', text: closed ? 'Карточка закрыта — решений больше нет.'
        : app.mode === 'demo' ? 'Демо: решения по карточке записываются на живом стенде.' : 'У вашей роли решений по этой карточке сейчас нет.' })),
      h('div', { class: 'cp-foot' }, [h('a', { class: 'btn', href: cabinetUrl(nc), target: '_blank', rel: 'noopener', text: 'Полностью в кабинете ↗' })]));
      return;
    }
    let d = D.drafts.get(key) || {};
    if (d.code && !options.some((o) => o.code === d.code)) d = D.drafts.save(key, { code: null, category: null }) || {};
    const status = h('p', { class: 'cp-status', role: 'status' });
    const saved = h('span', { class: 'cp-saved muted', text: D.savedText(d) });
    const need = h('p', { class: 'cp-need' });
    const ta = h('textarea', { rows: 2, maxlength: 1000, 'data-f': 'reason', 'aria-label': 'Причина решения',
      placeholder: 'Причина своими словами' });
    ta.value = d.reason || '';
    const chips = h('div', { class: 'cp-chips' });
    const catBox = h('div', { class: 'cp-cat' });
    const reasonBox = h('div', { class: 'cp-reason' }, [h('p', { class: 'cp-lbl' }), chips, ta]);
    const sign = h('button', { class: 'btn btn-primary', type: 'button', text: 'Подписать решение' });

    const opt = () => options.find((o) => o.code === (D.drafts.get(key) || {}).code) || null;
    const save = (patch) => {
      const x = D.drafts.save(key, patch);
      saved.textContent = D.savedText(x);
      if (!st.busy && status.className !== 'cp-status err') status.textContent = ''; // новый выбор — прежняя отметка не нужна
      refresh();
      return x;
    };

    function refresh() {
      const o = opt();
      const cur = D.drafts.get(key) || {};
      for (const inp of list.querySelectorAll('input[type=radio]')) inp.checked = inp.value === cur.code;
      for (const li of list.children) li.classList.toggle('cp-sel', li.dataset.code === cur.code);
      // категория — только у «Подтвердить несоответствие», сразу под ним
      catBox.hidden = !o?.category;
      if (o?.category) {
        const li = [...list.children].find((x) => x.dataset.code === o.code);
        if (li && catBox.parentNode !== li) li.append(catBox);
        for (const b of catBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.cat === cur.category));
      }
      reasonBox.hidden = !o || o.text.reason !== 'required';
      if (o && o.text.reason === 'required') {
        reasonBox.firstChild.textContent = `${o.text.prompt || 'Причина'} (обязательно):`;
        clear(chips).append(...o.text.reasons.map((r) => h('button', { class: 'cp-chip', type: 'button', text: r, onclick: () => {
          ta.value = r;
          save({ reason: r });
          ta.focus();
        } })), h('button', { class: 'cp-chip', type: 'button', text: 'Другое', onclick: () => {
          ta.value = '';
          save({ reason: '' });
          ta.focus();
        } }));
      }
      const miss = missingText(o, cur);
      need.textContent = miss ? `Чтобы подписать: ${miss}` : `Вы подписываете: «${o.text.label}»${o.category && cur.category
        ? `, ${categoryTitle(cur.category)}` : ''} — ${cardTitle(c)}`;
      sign.disabled = !!miss || st.busy;
    }

    const list = h('ul', { class: 'cp-opts', role: 'radiogroup', 'aria-label': 'Решение по карточке' }, options.map((o) => {
      const id = `cp-o-${o.code.replace(/[^a-z_]/g, '-')}`;
      const inp = h('input', { type: 'radio', name: 'cp-dec', id, value: o.code, 'data-f': `opt:${o.code}` });
      inp.addEventListener('change', () => save({ code: o.code, category: o.category ? (D.drafts.get(key) || {}).category || null : null }));
      return h('li', { class: 'cp-opt', 'data-code': o.code }, [
        h('label', { for: id }, [inp, h('span', { class: 'cp-ot' }, [h('b', { text: o.text.label }),
          o.text.what ? h('span', { class: 'cp-what', text: ` — ${o.text.what}` }) : null,
          o.text.next ? h('span', { class: 'cp-nx muted', text: ` Дальше: ${o.text.next}.`.replace(/\.\.$/, '.') }) : null])]),
      ]);
    }));
    catBox.append(h('p', { class: 'cp-lbl', text: 'Категория дефекта (обязательно):' }),
      h('div', { class: 'cp-chips' }, CATEGORY_ORDER.map((cat) => h('button', { class: 'cp-chip', type: 'button', 'data-cat': cat,
        'aria-pressed': 'false', text: categoryTitle(cat), onclick: () => save({ category: cat }) }))));
    ta.addEventListener('input', () => save({ reason: ta.value }));
    sign.addEventListener('click', () => send());

    decide.append(section('Решение по карточке', h('div', {}, [
      changedWhileWriting ? h('p', { class: 'cp-warn', text: `Пока вы писали, карточка перешла в «${cardStatus(c.status).badge.toLowerCase()}» — проверьте выбор.` }) : null,
      list, reasonBox, need, status]), 'cp-dec'),
    h('div', { class: 'cp-foot' }, [saved, h('a', { class: 'btn', href: cabinetUrl(nc), target: '_blank', rel: 'noopener', text: 'Полностью в кабинете ↗' }), sign]));
    refresh();
    if (focused === 'reason') ta.focus();

    if (st.flash) {
      status.className = `cp-status ${st.flash.kind}`;
      status.textContent = st.flash.text;
      st.flash = null;
    }

    function fail(text) {
      st.busy = false;
      st.flash = { kind: 'err', text };
      status.className = 'cp-status err';
      status.textContent = text;
      refresh();
    }

    // Перед подписью карточка сверяется с ядром: срез тот же — уходит свежий based_on_seq (записи по детали идут
    // каждую минуту); срез изменился — панель показывает новое и просит проверить выбор, решение не уходит
    async function send() {
      const o = opt();
      const cur = D.drafts.get(key) || {};
      if (!o || missingText(o, cur)) return;
      st.busy = true;
      sign.disabled = true;
      status.className = 'cp-status busy';
      status.textContent = 'Сверяю карточку и подписываю решение…';
      let fresh = null;
      try {
        fresh = await (app.api.card || app.api.coreCard)(nc);
      } catch {
        fresh = null;
      }
      if (current !== st) return;
      if (fresh && cardSig(fresh) !== cardSig(c)) {
        st.busy = false;
        st.flash = { kind: 'err', text: 'Пока вы решали, карточка изменилась — проверьте выбор и подпишите ещё раз.' };
        render(fresh);
        return;
      }
      const seq = Number.isFinite(fresh?.based_on_seq) ? fresh.based_on_seq : c.based_on_seq;
      const req = decisionRequest(o.a, o.target, { reason: o.text.reason === 'required' ? cur.reason : '',
        basedOnSeq: Number.isFinite(seq) ? seq : undefined, category: o.category ? cur.category : null });
      let http = 0;
      let result = null;
      try {
        ({ http, result } = await app.api.decide(req, app.role, { idempotencyKey: cur.idem }));
      } catch (e) {
        result = { detail: e?.message || String(e) };
      }
      if (current !== st) return;
      const ok = decisionOk(http, result);
      if (!ok) {
        fail(http === 409 || result?.status === 'stale'
          ? 'Пока вы решали, по детали пришла новая запись. Подпишите ещё раз — второго решения не будет.'
          : decisionMessage(http || 0, result));
        return;
      }
      st.busy = false;
      D.drafts.drop(key);
      st.flash = { kind: 'ok', text: `Решение записано ${fmtTime(new Date().toISOString()).slice(0, 5)}: «${o.text.label}».` };
      status.className = 'cp-status ok';
      status.textContent = st.flash.text;
      toast(`${cardTitle(c)}: ${o.text.label}`, 'ok');
      st.sig = '';
      setTimeout(load, 400);
    }
  }

  // спросить карточку снова: ещё не получена, сменилась роль или поток прислал новое состояние карточки
  const sigOf = (c) => (c ? `${c.status}|${c.defect_category || ''}` : '');
  st.timer = setInterval(() => {
    if (current !== st || st.busy) return;
    const s = app.state?.cards?.get?.(nc);
    const roleKey = app.role?.key || app.role?.id || '';
    if (!st.card || st.card.partial || roleKey !== st.roleKey || (s && sigOf(s) !== sigOf(st.card))) load();
  }, POLL_MS);

  if (opts.card) render({ ...opts.card, allowed_actions: [], partial: true }); // сразу имя и путь, решения — после ответа ядра
  load();
  el.focus({ preventScroll: true });
}

function closePanel(silent = false) {
  if (!current) return;
  const st = current;
  current = null;
  clearInterval(st.timer);
  document.removeEventListener('keydown', st.onKey);
  globalThis.removeEventListener?.('hashchange', st.onHash);
  st.el.remove();
  document.body.classList.remove('cp-open');
  if (!silent) st.app.onCardClosed?.(st.nc);
}

// Регистрация: app.openCard(nc_id, { card }) — открыть панель, app.closeCard() — закрыть
export function installCardPanel(app) {
  if (!app || app.openCard) return;
  app.openCard = (nc, opts) => openPanel(app, typeof nc === 'object' ? nc?.nc_id : nc, typeof nc === 'object' ? { card: nc, ...opts } : opts);
  app.closeCard = () => closePanel();
  app.cardPanelOpen = () => current?.nc || null;
}

// ui.js ставит window.texdelo до первого ожидания — регистрируемся следующей микрозадачей (повторный вызов пустой)
if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const app = globalThis.texdelo;
    if (app && typeof document !== 'undefined') {
      installCardPanel(app);
      openFromAddress(app);
    }
  });
}

function openFromAddress(app, tries = 40) {
  if (!new URLSearchParams(globalThis.location?.search || '').get('card')) return;
  const nc = app.api ? cardFromAddress(location.search, location.hash, app.state?.cards?.values?.()) : null;
  if (nc) {
    app.openCard(nc);
    return;
  }
  // карточки детали приходят в поток не сразу — берём их из профиля детали
  const item = /^#\/item\/([^?]+)/.exec(location.hash || '');
  if (app.api?.profile && item && tries <= 36) {
    app.api.profile(decodeURIComponent(item[1])).then((p) => {
      const id = cardFromAddress(location.search, location.hash, p?.cards);
      if (id) app.openCard(id);
    }).catch(() => {});
    return;
  }
  if (tries > 0) setTimeout(() => openFromAddress(app, tries - 1), 500);
}
