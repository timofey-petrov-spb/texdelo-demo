// #/item/<id> и правая часть «Приёмки ОТК» — объектная страница детали (К39, SPEC 3.4). Сверху — «стоп» по детали
// (если есть) и шапка: номер, наименование, плашка статуса, четыре факта, «⏸ Удержать деталь» и «⋯». Под ней —
// чек-лист «Можно ли принять» из шести условий (checklist.js) или клеймо у принятой, строка свёрнутых разделов
// «Проверки / Карточки / История / Документы и подпись» и нижняя панель с одной главной кнопкой. Решения — в окне
// поверх страницы (decide.js), черновик — в drafts.js: обновление детали окно не трогает.

import { decisionRequest, idempotencyKey, isStamp, parseActions, receiptsFor } from './actions.js';
import { checklistView, confirmStamp, footerBar, stampRecord, stampTop } from './accept.js';
import { decisionMessage, decisionOk } from './api.js';
import { CARD_STATUS, checklist, defaultCardName, diffRows, GONE_MS, SEP } from './checklist.js';
import { openDecision, openDialog } from './decide.js';
import { clear, h, toast } from './dom.js';
import {
  cardsSection, chainBlock, checksList, documentsList, isSkipped, matrixTable, trendOf, typeTitle, warningsList,
} from './dossier.js';
import { draftKey, drafts } from './drafts.js';
import { analyzerPanel } from './evidence.js';
import { itemTitle } from './format.js';
import { createHistory } from './history.js';
import { sliceSig } from './hold.js';
import {
  backLink, cardNameOf, changesText, coverageOf, createItemExtras, factsOf, holdInfo, moreMenu, paintStop, pillOf, showHere, stepOf, typeLabel,
} from './item_more.js';
import { learnLimits, profileMargins } from './margin.js';
import * as NAMES from './names.js';
import { rememberDecisions } from './plain.js';
import { mergeStamp, needsVerify } from './stamp.js';
import { activeWarnings, decisionsFor } from './state.js';

export { coverageOf, cardNameOf, holdInfo, isSkipped, pillOf, trendOf, typeLabel };

const { itemParts, rememberCards } = NAMES;
const SECTIONS = [['checks', 'Проверки'], ['cards', 'Карточки'], ['history', 'История'], ['docs', 'Документы и подпись']];
// на какую запись журнала смотрит человек — based_on_seq решения
const seqOf = (p) => (Number.isFinite(p?.acceptance?.based_on_seq) ? p.acceptance.based_on_seq : p?.as_of_seq);
const SEC_OPEN = new Set(); // раскрытые разделы переживают перерисовку и смену детали (постоянные ключи)

export function createProfile(container, app, itemId, opts = {}) {
  const root = h('section', { class: 'profile pf-obj' });
  container.append(root);
  const extras = createItemExtras(app, itemId); // лестница утечки, ворота — пока нет панели карточки К40
  const stopEl = h('div', { class: 'pf-stop sev-critical', role: 'alert', hidden: true });
  const freshEl = h('button', { type: 'button', class: 'fresh-bar pf-fresh', hidden: true, text: 'Данные детали обновились — показать',
    onclick: () => { force = true; render(); } });
  let profile = null;
  let dossier = null;
  let error = null;
  let token = 0;
  let timer = 0;
  let goneTimer = 0;
  let sparks = [];
  let decSig = '';
  let verdict = null; // проверка цепочки изделия — если профиль не сказал, проверена ли подпись клейма
  let verifying = false;
  let shownSig = ''; // подпись отрисованного среза: тот же — экран не трогается (К35)
  let shownSeq = null; // на какую запись журнала человек смотрит — based_on_seq решения
  let shownCl = null; // чек-лист на экране — для зачёркивания снятого (diffRows)
  let shownP = null; // профиль на экране — «Пока вы писали: …»
  let dirty = false; // данные изменились, пока открыто окно решения или фокус в поле ввода
  let force = false;
  let alive = true;
  let reopened = false;
  let tries = 0; // повторы запроса профиля после отказа связи
  let sysOpen = false;
  const checkState = { filter: 'all', all: false };
  const openCards = new Set(); // раскрытые «Решения по карточке» переживают перерисовку
  const history = createHistory();
  const decisionSig = () => decisionsFor(app.state, itemId).map((d) => `${d.event_id}:${(d.receipts || []).length}`).join(',');

  async function load() {
    const my = ++token;
    try {
      const [p, d] = await Promise.all([app.api.profile(itemId), app.api.dossier(itemId).catch(() => null)]);
      if (my !== token) return;
      profile = p && typeof p === 'object' ? p : null;
      dossier = d;
      tries = 0;
      error = profile ? null : { status: 0, detail: 'пустой ответ ядра' };
      if (profile) {
        rememberCards(profile.cards);
        learnLimits(app.limits = app.limits || new Map(), profileMargins(profile));
        // клеймо из ответа ядра на само решение знает ключ и проверку подписи, даже если профиль их не отдал
        const stamp = mergeStamp(profile.acceptance?.stamp, app.stamps?.get(itemId));
        if (stamp) profile = { ...profile, acceptance: { ...profile.acceptance, stamp } };
        if (needsVerify(stamp, verdict)) verifyChain(my);
        paintStopLine();
        if (sliceSig([profile, dossier]) === shownSig && !error) {
          shownSeq = seqOf(profile); // видимое не изменилось — только номер записи, на которую опирается решение
          return;
        }
      }
    } catch (e) {
      if (my !== token) return;
      // ядро не ответило (стенд под нагрузкой): показанная деталь остаётся на экране, запрос повторяется сам
      if (tries < 5 && !(e?.status >= 400 && e?.status < 500)) schedule(3000 * ++tries);
      if (profile) return;
      error = e;
    }
    render();
  }

  async function verifyChain(my) {
    if (verifying) return;
    verifying = true;
    try {
      const v = await app.api.verify(itemId);
      if (my === token && v && typeof v === 'object') {
        verdict = v;
        render();
      }
    } catch {
      // проверка не удалась — клеймо остаётся «подпись не проверялась»
    } finally {
      verifying = false;
    }
  }

  // Окно решения по этой детали с непустым черновиком (или ввод в последние 30 с), открытая форма карточки или фокус
  // в поле — страница не пересобирается: пришло новое — строка «Данные детали обновились — показать» (К35, SPEC 3.4.10)
  function busy() {
    const dlg = openDialog();
    if (dlg && dlg.itemId === itemId && dlg.holding()) return true;
    const f = document.activeElement;
    return !!root.querySelector('.acc-reason:not([hidden])') || !!(f && root.contains(f) && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName));
  }

  function resume() {
    if (dirty && !busy()) render();
  }

  function schedule(ms = 350) {
    clearTimeout(timer);
    timer = setTimeout(load, ms);
  }

  function onDecided({ ok, result, refresh }) {
    if (ok && result?.stamp && profile) {
      (app.stamps = app.stamps || new Map()).set(itemId, result.stamp);
      verdict = null;
      profile = { ...profile, acceptance: { ...profile.acceptance, stamp: result.stamp, allowed: false, allowed_actions: [] } };
      force = true;
      render();
      schedule(1800);
      opts.onDecided?.();
      return;
    }
    if (ok) opts.onDecided?.();
    if (refresh || ok) {
      force = true;
      schedule(250);
    }
  }

  function paintStopLine() {
    const mine = activeWarnings(app.state).filter((w) => w.item_id === itemId);
    paintStop(stopEl, [...mine, ...(profile?.warnings || []).filter((w) => !w.item_id || w.item_id === itemId)]);
  }

  // Перед подписью — свежий профиль: видимое то же — свежий номер записи (деталь идёт, записи прибавляются каждые
  // секунды, старый номер ядро отклонит); изменилось — { changed: что }, решение не уходит, страница обновляется
  async function freshSeq() {
    try {
      const p = await app.api.profile(itemId);
      if (!p || typeof p !== 'object') return shownSeq;
      const key = (x) => sliceSig([x.acceptance?.allowed, x.acceptance?.allowed_actions, x.item?.on_hold, !!x.acceptance?.stamp,
        (x.cards || []).map((c) => [c.nc_id, c.status])]);
      if (shownP && key(p) !== key(shownP)) {
        const changed = changesText(shownP, p, cardNameOf);
        profile = p;
        force = true;
        render();
        return { changed };
      }
      return seqOf(p);
    } catch {
      return shownSeq;
    }
  }

  // «недоступно: открыта карточка «Подрез шва»» — первая причина чек-листа
  function whyNot(cl) {
    const row = cl.rows.find((r) => r.lines.some((x) => x.mark === '✕' || x.mark === '●'));
    const l = row?.lines.find((x) => x.mark === '✕' || x.mark === '●');
    if (row?.key === 'cards' && l?.action) return `открыта карточка «${l.text.split(/ \(|: /)[0]}»`;
    const t = l?.text || cl.extra[0] || '';
    return t ? t[0].toLowerCase() + t.slice(1) : '';
  }

  function openDec(scope) {
    if (!profile) return;
    const cl = shownCl || checklist(profile, { now: Date.now() });
    openDecision(app, { itemId, scope, actions: profile.acceptance?.allowed_actions, acceptWhy: whyNot(cl),
      canStamp: app.role?.id === 'controller', basedOnSeq: freshSeq,
      onDecided: (r) => (r.ok ? onDecided({ ok: true, result: r.result, refresh: true }) : r.stale && onDecided({ ok: false, refresh: true })),
      onClose: () => alive && resume() });
  }

  function doStamp(a) {
    const base = itemParts(itemId).base;
    confirmStamp(app, { itemId, onYes: async () => {
      const seq = await freshSeq();
      if (seq && typeof seq === 'object') return { ok: false, message: `Пока вы решали, деталь изменилась: ${seq.changed}. Проверьте и поставьте клеймо ещё раз.` };
      const req = decisionRequest(a, { kind: 'item', id: itemId }, { basedOnSeq: seq });
      let http = 0;
      let result = null;
      try {
        ({ http, result } = await app.api.decide(req, app.role, { idempotencyKey: idempotencyKey() }));
      } catch (e) {
        result = { detail: e?.message || String(e) };
      }
      const ok = decisionOk(http, result);
      if (ok) toast(`Клеймо ОТК поставлено: ${base}`, 'ok');
      onDecided({ ok, result, refresh: true });
      return { ok, message: ok ? '' : decisionMessage(http || 0, result) };
    } });
  }

  function openSection(name, selector = '') {
    SEC_OPEN.add(name);
    render();
    const el = selector ? root.querySelector(selector) : root.querySelector(`#sec-${name}`);
    showHere(el);
  }

  function onAction(act) {
    if (act.kind === 'card') {
      if (typeof app.openCard === 'function') app.openCard(act.target, { card: (profile?.cards || []).find((c) => c.nc_id === act.target) });
      else openSection('cards', act.target ? `[data-nc="${CSS.escape(act.target)}"]` : '');
    } else if (act.kind === 'check') openSection('checks', act.target ? `.chk[data-cp="${CSS.escape(act.target)}"]` : '');
    else if (act.kind === 'docs') openSection('docs');
    else if (act.kind === 'release') openDec('hold');
    else if (act.kind === 'chain') recheck();
  }

  async function recheck() {
    const v = await app.api.verify(itemId).catch(() => null);
    if (v && typeof v === 'object') verdict = v;
    force = true;
    render();
  }

  function render() {
    if (profile && !force && busy()) {
      dirty = true;
      freshEl.hidden = false;
      const dlg = openDialog();
      if (dlg?.itemId === itemId) dlg.notice(changesText(shownP, profile, cardNameOf));
      setTimeout(resume, 31000); // пустой черновик и 30 с без ввода — страница снова живая
      return;
    }
    force = false;
    dirty = false;
    freshEl.hidden = true;
    const view = root.closest('.view');
    const keep = { view: view?.scrollTop ?? 0, win: globalThis.scrollY || 0 };
    paint();
    // пересборка не должна сдвигать страницу: браузер обрезает прокрутку, пока узлы сняты
    if (view && view.scrollTop !== keep.view) view.scrollTop = keep.view;
    if ((globalThis.scrollY || 0) !== keep.win) globalThis.scrollTo?.(0, keep.win);
    history.restore();
    if (!reopened && profile) {
      reopened = true; // окно было открыто, человек ушёл и вернулся — окно и текст на месте
      for (const scope of ['acceptance', 'hold']) if (drafts.get(draftKey({ kind: 'item', id: itemId }, scope))?.open) openDec(scope);
    }
  }

  function header(p, cl) {
    const it = p.item || { item_id: itemId };
    const { base, cycleText } = itemParts(it.item_id || itemId);
    const acts = p.acceptance?.allowed_actions || [];
    const pill = pillOf(p, cl);
    let hold = null;
    if (it.on_hold && acts.includes('hold:release')) {
      hold = h('button', { type: 'button', class: 'btn pf-hold', text: `Удержана${SEP}Снять удержание…`, onclick: () => openDec('hold') });
    } else if (!it.on_hold && acts.includes('hold:hold')) {
      hold = h('button', { type: 'button', class: 'btn pf-hold', text: '⏸ Удержать деталь', title: 'Остановить деталь на месте — это не решение о качестве',
        onclick: () => openDec('hold') });
    }
    const back = backLink(app.role?.start);
    return h('header', { class: 'pf-head' }, [
      opts.back === false ? null : h('a', { class: 'back', href: back[0], text: back[1] }),
      h('div', { class: 'pf-row1' }, [
        h('h1', { title: it.item_id || itemId }, [base, cycleText ? h('small', { class: 'cyc', text: cycleText }) : null]),
        typeTitle(it.item_type_id) ? h('span', { class: 'pf-type', text: typeTitle(it.item_type_id) }) : null,
        h('span', { class: `pf-pill ${pill.cls}`, text: pill.text }),
        h('span', { class: 'pf-sp' }),
        hold,
        moreMenu(app, itemId, { onVerify: recheck }),
      ]),
      h('dl', { class: 'pf-facts' }, factsOf(app, p, cl)),
    ]);
  }

  function sections(p, decisions, timeline) {
    const counts = { checks: (p.checks || []).length, cards: (p.cards || []).length, history: history.count(), docs: null };
    const bar = h('nav', { class: 'pf-secs', 'aria-label': 'Разделы детали' }, SECTIONS.map(([k, t]) => h('button', {
      type: 'button', class: `sec-b${SEC_OPEN.has(k) ? ' on' : ''}`, 'aria-expanded': String(SEC_OPEN.has(k)), 'aria-controls': `sec-${k}`,
      text: `${SEC_OPEN.has(k) ? '▾' : '▸'} ${t}${counts[k] != null ? ` (${counts[k]})` : ''}`,
      onclick: () => { if (SEC_OPEN.has(k)) SEC_OPEN.delete(k); else SEC_OPEN.add(k); force = true; render(); } })));
    const build = {
      checks: () => checksList(app, p, sparks, checkState),
      cards: () => [cardsSection(app, p.cards, { cardName: (c) => cardNameOf(c) || defaultCardName(c), nextStep: stepOf,
        statusWord: (c) => CARD_STATUS[c.status], onDecided, onClose: resume, open: openCards }), warningsList(p.warnings),
      ...(typeof app.openCard === 'function' ? [] : [analyzerPanel(app, p.cards, p.thresholds), extras.ladderPanel(p), extras.gatesPanel(p)])],
      history: () => history.el,
      docs: () => [h('h3', { class: 'sec-h', text: 'Документы' }), documentsList(p.documents),
        h('h3', { class: 'sec-h', text: 'Записи детали' }), chainBlock(verdict || p.chain || dossier?.chain, () => app.api.verify(itemId)),
        h('details', { class: 'sec-mx' }, [h('summary', { text: 'Составные части и входной контроль' }), matrixTable(dossier, p)]),
        p.acceptance?.stamp ? [h('h3', { class: 'sec-h', text: 'Клеймо ОТК' }), stampRecord(p.acceptance.stamp,
          receiptsFor(p.acceptance.stamp.decision_event_id, { decisions: decisionsFor(app.state, itemId), timeline }), verdict)] : null].flat(),
    };
    const panes = SECTIONS.filter(([k]) => SEC_OPEN.has(k)).map(([k, t]) => h('section', { class: `panel sec sec-${k}`, id: `sec-${k}` }, [
      h('h2', { class: 'panel-h', text: t }), ...[].concat(build[k]()).filter(Boolean)]));
    return [bar, ...panes];
  }

  function paint() {
    for (const sp of sparks) sp.destroy();
    sparks = [];
    clear(root);
    if (!profile && !error) {
      root.append(h('div', { class: 'panel skeleton', text: `Загружаю деталь ${itemTitle(itemId)}…` }));
      return;
    }
    if (error) {
      const nf = error.status === 404;
      root.append(h('div', { class: 'panel pf-error' }, [
        h('h2', { text: nf ? `Деталь ${itemTitle(itemId)} не найдена` : 'Деталь не получена' }),
        h('p', { text: nf ? 'Ядро не знает такой детали (или в демо нет её профиля).' : String(error.detail || error.message || error) }),
        h('button', { class: 'btn', type: 'button', text: 'Повторить', onclick: () => { error = null; render(); load(); } }),
      ]));
      return;
    }
    const p = profile;
    shownP = p;
    shownSig = sliceSig([profile, dossier]);
    shownSeq = seqOf(profile);
    const timeline = dossier?.timeline || [];
    const decisions = decisionsFor(app.state, itemId);
    rememberDecisions(decisions);
    history.update(timeline, decisions);
    decSig = decisionSig();
    const now = Date.now();
    const { next: cl, gone } = diffRows(shownCl, checklist(p, { now, cardName: cardNameOf, nextStep: stepOf, hold: holdInfo(decisions) }), now);
    shownCl = cl;
    clearTimeout(goneTimer);
    if (gone.length) goneTimer = setTimeout(() => { force = !busy(); if (force) render(); }, GONE_MS + 100);
    const acc = p.acceptance || {};
    const acts = parseActions(acc.allowed_actions);
    const stamp = acts.find(isStamp) || null;
    const other = acts.some((a) => ['acceptance', 'correction'].includes(a.kind) && !isStamp(a));
    const top = cl.verdict === 'accepted' && acc.stamp
      ? stampTop(acc.stamp, { receipts: receiptsFor(acc.stamp.decision_event_id, { decisions, timeline }), verdict,
        where: /склад/i.test(p.item?.location || '') ? 'передано на склад' : '' })
      : checklistView(cl, { gone, onAction, openDetails: sysOpen, onToggleDetails: (o) => { sysOpen = o; } });
    const foot = footerBar(cl, { stamp, other, onStamp: () => doStamp(stamp), onDecide: () => openDec('acceptance'),
      onJump: (key) => showHere(root.querySelector(`#cl-${key}`)) });
    root.classList.toggle('has-foot', !!foot);
    paintStopLine();
    root.append(...[stopEl, header(p, cl), freshEl, top, ...sections(p, decisions, timeline), foot].filter(Boolean)); // без «null»
  }

  root.addEventListener('focusout', () => setTimeout(() => alive && resume(), 0));
  const tick = setInterval(() => alive && profile && paintStopLine(), 30000);
  app.openDecision = (key) => {
    const m = /^item:(.+):(acceptance|hold)$/.exec(String(key || ''));
    if (!m) return false;
    if (alive && m[1] === itemId && profile) {
      openDec(m[2]);
      return true;
    }
    drafts.save(draftKey({ kind: 'item', id: m[1] }, m[2]), { open: true });
    app.go(`#/item/${encodeURIComponent(m[1])}`);
    return true;
  };
  render();
  load();
  return {
    update(ch) {
      if (ch.warnings && profile) paintStopLine();
      if (ch.reset || ch.items.has(itemId)) schedule();
      else if (ch.decisions && profile && !busy() && decisionSig() !== decSig) render();
    },
    reload: () => schedule(0),
    destroy() {
      alive = false;
      token += 1;
      clearTimeout(timer);
      clearTimeout(goneTimer);
      clearInterval(tick);
      history.destroy();
      const dlg = openDialog();
      if (dlg?.itemId === itemId) dlg.close(true); // вернётся к детали — окно откроется с тем же черновиком
      for (const sp of sparks) sp.destroy();
      root.remove();
    },
  };
}
