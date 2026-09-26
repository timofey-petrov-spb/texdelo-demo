// Блок «Что увидел анализатор» в профиле детали: по каждой карточке детали — пара изображений «эталон | с признаками»
// (рамка — место, которое назвал анализатор), пометка «синтетическое изображение», проверка отпечатка файла и ступени
// анализатора-ансамбля. Изображений нет — «материала нет», без заглушек. Логика — analyzer.js.

import { analyzerStages, barWidth, cardClosed, evidenceCaption, evidencePair, seenFacts } from './analyzer.js';
import { clear, h } from './dom.js';
import { fmtNum, isNum } from './format.js';
import { cardHint, cardLabel, cpTitle } from './names.js';
import { enumTitle } from './plain.js';

const KEEP = 48; // изображений в памяти табло: профиль перерисовывается часто — файл не скачивается заново

// Адрес изображения — один раз на evidence_id: у живого ядра это адрес в памяти браузера (файл берётся с токеном
// роли), перерисовка профиля его переиспользует, и экран не мигает. Не получилось — в следующий раз снова
export function evidenceSrc(app, ref) {
  const cache = app.evidenceCache || (app.evidenceCache = new Map());
  const key = ref.evidence_id;
  if (cache.has(key)) return cache.get(key);
  const p = Promise.resolve(app.api.evidence ? app.api.evidence(ref) : ref.url).then((src) => {
    if (!src) throw new Error('нет адреса');
    return src;
  });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > KEEP) {
    const [old, oldP] = cache.entries().next().value;
    cache.delete(old);
    oldP.then((src) => (String(src).startsWith('blob:') ? URL.revokeObjectURL(src) : null), () => null);
  }
  return p;
}

function figure(app, ref, side) {
  const img = h('img', { alt: evidenceCaption(ref), loading: 'lazy', decoding: 'async' });
  const fig = h('figure', { class: `ev-fig ev-${side}` }, [img, h('figcaption', { text: side === 'ref' ? 'эталон' : 'с признаками' })]);
  evidenceSrc(app, ref).then((src) => {
    img.src = src;
  }).catch(() => {
    clear(fig).append(h('p', { class: 'ev-miss', text: 'файл недоступен' }));
  });
  return fig;
}

function barList(bars) {
  return h('ul', { class: 'an-bars' }, bars.map((b) => h('li', { class: b.main ? 'an-main' : '' }, [
    h('span', { class: 'an-bt', text: b.title }),
    h('span', { class: 'an-bar', role: 'img', 'aria-label': `${b.title}: ${isNum(b.p) ? fmtNum(b.p, 2) : 'нет'}` },
      [h('span', { class: 'an-fill', style: { width: `${barWidth(b.p)}%` } })]),
    h('span', { class: 'an-p', text: isNum(b.p) ? fmtNum(b.p, 2) : '—' }),
  ])));
}

function stageRow(s) {
  const groups = s.groups || [];
  // классификатор: у каждого несовершенства — свой заголовок с кодом и свои полосы
  const shown = s.stage === 'classifier' && groups.length ? [] : s.facts || [];
  const facts = shown.map((f) => h('span', { class: `an-f${f.tone ? ` tone-${f.tone}` : ''}` }, [
    h('span', { class: 'muted', text: `${f.label}: ` }), f.plain ? f.value : h('b', { text: f.value }), f.note ? h('span', { class: 'an-note', text: ` — ${f.note}` }) : null]));
  const bars = groups.map((g) => h('div', { class: 'an-group' }, [
    h('p', { class: 'an-gt' }, [h('b', { text: g.title }), g.note ? h('span', { class: 'an-note', text: ` — ${g.note}` }) : null]),
    barList(g.bars)]));
  return h('li', { class: `an-stage an-${s.stage}` }, [
    // фраза источника — подсказкой: на экране те же сведения разобраны по полям; ступень без полей — фразой
    h('div', { class: 'an-h', title: s.summary || null }, [h('b', { text: s.title }), s.version ? h('span', { class: 'muted', text: ` модель ${s.version}` }) : null]),
    s.summary && !facts.length && !bars.length ? h('p', { class: 'an-sum', text: s.summary }) : null,
    facts.length ? h('div', { class: 'an-facts' }, facts) : null,
    ...bars,
  ]);
}

// Наблюдение карточки (Observation API v1.4): изображения и ступени; opts.closed — карточка закрыта, без цвета тревоги
export function analyzerBlock(app, obs, thresholds = {}, opts = {}) {
  const pair = evidencePair(obs?.evidence_refs);
  const box = h('div', { class: 'an-block' });
  if (pair.empty) {
    box.append(h('p', { class: 'ev-none muted', text: 'Материала нет — источник не передал изображений.' }));
  } else {
    const marks = [
      pair.synthetic ? h('span', { class: 'ev-mark ev-synth', text: 'синтетическое изображение' }) : null,
      pair.verified === true ? h('span', { class: 'ev-mark ev-ok', text: '✓ подпись файла проверена' }) : null,
      pair.verified === false ? h('span', { class: 'ev-mark sev-critical', text: '✕ файл не совпадает с отпечатком в событии' }) : null,
    ].filter(Boolean);
    box.append(h('div', { class: 'ev-pair' }, [pair.reference ? figure(app, pair.reference, 'ref') : null, pair.shown ? figure(app, pair.shown, 'obs') : null]),
      ...(marks.length ? [h('p', { class: 'ev-marks' }, marks)] : [])); // append(null) пишет «null»
  }
  const stages = analyzerStages(obs, thresholds, opts);
  if (stages.length) box.append(h('ol', { class: `an-stages${opts.closed ? ' an-closed' : ''}` }, stages.map(stageRow)));
  if (obs?.analyzer_version) box.append(h('p', { class: 'an-ver muted', text: `Версия анализатора: ${obs.analyzer_version}` }));
  return box;
}

// «Что увидели» для панели карточки: эталон и снимок рядом и не больше двух чисел против порогов (SPEC.md 3.6)
export function seenBlock(app, obs, thresholds = {}) {
  const pair = evidencePair(obs?.evidence_refs);
  const facts = seenFacts(obs, thresholds);
  if (pair.empty && !facts.length) return null;
  return h('div', { class: 'cp-seen' }, [
    pair.empty ? h('p', { class: 'ev-none muted', text: 'Изображений нет — источник их не передал.' })
      : h('div', { class: 'ev-pair' }, [pair.reference ? figure(app, pair.reference, 'ref') : null, pair.shown ? figure(app, pair.shown, 'obs') : null]),
    facts.length ? h('ul', { class: 'cp-facts-n' }, facts.map((f) => h('li', { class: f.tone ? `tone-${f.tone}` : '', text: f.text }))) : null,
    pair.synthetic ? h('p', { class: 'muted cp-small', text: 'Синтетическое изображение стенда.' }) : null,
  ]);
}

// Панель профиля: по каждой карточке детали — «Что увидел анализатор» из карточки (GET /v1/cards/{id}).
// Карточка берётся один раз на статус: перерисовка профиля не шлёт запросов заново
export function analyzerPanel(app, cards, thresholds) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c?.nc_id);
  if (!list.length || typeof app.api?.card !== 'function') return null;
  const cache = app.cardCache || (app.cardCache = new Map());
  const body = h('div', { class: 'an-cards' });
  for (const c of list) {
    const closed = cardClosed(c);
    const slot = h('section', { class: `an-card${closed ? ' an-card-closed' : ''}` }, [
      h('h3', { class: 'an-ct', title: cardHint(c.nc_id) }, [cardLabel(c, { item: false }),
        c.control_point_id ? h('span', { class: 'muted', text: `, ${cpTitle(c.control_point_id)}` }) : null,
        c.status_title || c.status ? h('span', { class: 'an-status', text: `: ${c.status_title || enumTitle(c.status)}` }) : null]),
      h('p', { class: 'muted', text: 'Загружаю наблюдение…' })]);
    body.append(slot);
    const key = `${c.nc_id}|${c.status || ''}`;
    if (!cache.has(key)) cache.set(key, app.api.card(c.nc_id).catch((e) => ({ error: e })));
    cache.get(key).then((full) => {
      slot.lastChild.remove();
      if (full?.error) {
        cache.delete(key);
        slot.append(h('p', { class: 'muted', text: `Карточка не получена: ${full.error.detail || full.error.message || full.error}` }));
        return;
      }
      slot.append(analyzerBlock(app, full?.signal, thresholds, { closed: closed || cardClosed(full) }));
    });
  }
  return h('div', { class: 'panel an-panel' }, [h('h2', { class: 'panel-h', text: 'Что увидел анализатор' }), body]);
}
