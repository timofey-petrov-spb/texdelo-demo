// Режим демо: без ядра табло проигрывает demo/stream.jsonl (StreamEvent по строкам с задержкой after_ms)
// и отвечает на запросы профилей и решений из demo/*. Табло при этом работает с тем же контрактом и тем же
// клиентом потока, что и с ядром: демо лишь подставляет «ядро» — журнал событий и EventSource к нему.
// Обрыв связи («⚡ обрыв») рвёт этот EventSource по-настоящему: переподключение, since_seq и досылку
// делает настоящий StreamClient.

import { createCoreRecord } from './demo_core.js';
import { maskProfile } from './demo_mask.js';
import { createDecide } from './demo_decide.js';
import { demoAck, demoNotifications } from './demo_notify.js';
import { clearOverlay, createOverlay, patchEvent, patchLine } from './demo_overlay.js';
import { createSigner } from './demo_sign.js';
import { applyEvent, createState, lineSnapshot, resetState, stationKey } from './state.js';

export { maskProfile };

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t);
      if (rec && rec.event && typeof rec.event.type === 'string') out.push(rec);
    } catch {
      // битая строка сюжета пропускается — табло не должно падать
    }
  }
  return out;
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const HEARTBEAT_MS = 15000;
const JOURNAL_MAX = 6000;

export function createDemo({ base = 'demo/', onEvent, onStatus, fetchImpl = globalThis.fetch?.bind(globalThis), loop = false,
  subtle = globalThis.crypto?.subtle, getRole = () => null } = {}) {
  const mirror = createState(); // что видит табло (сюжет с решениями человека)
  const story = createState(); // сюжет как записан — из него поправки берут «как считает сюжет»
  const overlay = createOverlay();
  const signer = createSigner(subtle);
  const human = new Map(); // решения человека по детали — в историю дела
  const subs = new Set();
  let journal = [];
  let frames = [];
  let decisions = {};
  let idx = 0;
  let timer = null;
  let hb = null;
  let speed = 1;
  let paused = false;
  let down = false;
  let recovering = false;
  let lastAt = 0;
  const profiles = new Map();
  const dossiers = new Map();
  const fullCards = new Map(); // карточки с наблюдением (Card.signal) — demo/cards/<nc_id>.json
  const acks = new Map(); // «Принял» по оповещениям — поправки поверх сюжета

  const status = () => onStatus?.({ demo: true, seq: mirror.seq, idx, total: frames.length, speed, paused,
    ended: idx >= frames.length && frames.length > 0 });
  // Часы демо — часы сюжета: время последнего кадра плюс прошедшее с него (с учётом скорости, не больше
  // минуты). Решения человека и квитанции получают время сюжета, а не компьютера — клеймо не «раньше» проверок.
  let storyMs = null;
  let storyWall = 0;
  const now = () => {
    if (storyMs === null) return new Date().toISOString();
    const run = paused ? 0 : Math.min(60000, (Date.now() - storyWall) * speed);
    return new Date(storyMs + run).toISOString();
  };
  function tickClock(at) {
    const t = Date.parse(at);
    if (Number.isFinite(t)) {
      storyMs = t;
      storyWall = Date.now();
    }
  }

  function deliver(ev) {
    applyEvent(mirror, ev);
    lastAt = Date.now();
    if (ev.type !== 'heartbeat') {
      journal.push(ev);
      if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX);
    }
    const data = JSON.stringify(ev);
    for (const s of [...subs]) s.emit(data);
    onEvent?.(ev);
  }

  // EventSource к журналу демо: hello (seq = since_seq, как у ядра), досылка после since_seq, снимок линий
  class DemoEventSource {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      this.since = Number(/[?&]since_seq=(\d+)/.exec(this.url)?.[1] || 0);
      setTimeout(() => this.connect(), 20);
    }

    connect() {
      if (this.closed) return;
      if (down) {
        this.fail();
        return;
      }
      this.readyState = 1;
      subs.add(this);
      this.onopen?.({});
      const replay = journal.filter((ev) => ev.seq > this.since);
      const hello = { type: 'hello', seq: this.since || mirror.seq, at: now() };
      if (this.since && recovering) {
        hello.summary = `Связь восстановлена — поток продолжен с seq ${this.since}: дослано событий ${replay.length}, без потерь`;
        recovering = false;
      }
      const first = [hello, ...replay];
      for (const l of mirror.lines.values()) {
        if (l.stations.size) first.push({ type: 'line', seq: mirror.seq, at: now(), line: lineSnapshot(mirror, l) });
      }
      for (const ev of first) this.emit(JSON.stringify(ev));
    }

    emit(data) {
      if (!this.closed) this.onmessage?.({ data });
    }

    fail() {
      subs.delete(this);
      this.readyState = 2;
      if (!this.closed) this.onerror?.({ status: 0 });
    }

    close() {
      this.closed = true;
      this.readyState = 2;
      subs.delete(this);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (paused || idx >= frames.length) {
      if (idx >= frames.length) {
        status();
        if (loop) timer = setTimeout(restart, 15000);
      }
      return;
    }
    timer = setTimeout(tick, Math.max(0, frames[idx].after_ms) / speed);
  }

  function tick() {
    // кадры с одинаковым временем — одной пачкой
    do {
      const f = frames[idx++];
      tickClock(f.event.at);
      applyEvent(story, f.event);
      const ev = patchEvent(f.event, f.item_id, overlay, story.items);
      if (ev) deliver({ ...ev, at: now() });
    } while (idx < frames.length && frames[idx].after_ms === 0);
    status();
    schedule();
  }

  async function getJson(path) {
    const r = await fetchImpl(`${base}${path}`);
    if (!r.ok) {
      const e = new Error(r.status === 404 ? 'нет в демо-данных' : `демо: ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  async function cached(map, path, id) {
    if (!map.has(id)) map.set(id, getJson(path).catch((e) => { map.delete(id); throw e; }));
    return map.get(id);
  }

  // Решение записано: событие decision, деталь такой, какой её оставило решение, и линия с поправками
  function publish(decision, summary, shown, lineId) {
    const seq = mirror.seq + 1;
    const evs = [{ type: 'decision', seq, summary, event_type: 'decision.recorded', decision: { ...decision, seq } }];
    if (shown) evs.push({ type: 'item', seq, event_type: 'decision.recorded', item: shown });
    const sl = story.lines.get(lineId);
    if (sl) {
      const raw = { line_id: lineId, totals: { ...sl.totals }, zone_counts: { ...sl.zone_counts }, stations: [...sl.stations.values()] };
      evs.push({ type: 'line', seq, line: patchLine(raw, overlay, story.items) });
    }
    for (const ev of evs) deliver({ ...ev, at: now() });
    status();
    return seq;
  }

  function remember(id, entry) {
    if (!human.has(id)) human.set(id, []);
    human.get(id).push(entry);
  }

  function restart() {
    clearTimeout(timer);
    idx = 0;
    storyMs = null;
    clearOverlay(overlay);
    human.clear();
    acks.clear();
    journal = [];
    resetState(story);
    resetState(mirror);
    paused = false;
    schedule();
  }

  const api = {
    mode: 'demo',
    // экраны К33: записанные ответы настоящего ядра (demo/core/answers.json), для роли из шапки
    ...createCoreRecord({ base, fetchImpl, getRole }),
    line: async () => {
      const l = [...mirror.lines.values()][0];
      return l ? lineSnapshot(mirror, l) : {};
    },
    async profile(id) {
      const p = await cached(profiles, `profiles/${encodeURIComponent(id)}.json`, id);
      const out = maskProfile(p, mirror.seq, mirror.items.get(id), overlay, getRole()?.id);
      // карточки — как их видит поток сейчас, а не как в конце сюжета
      if (out && Array.isArray(out.cards)) out.cards = [...mirror.cards.values()].filter((c) => c.item_id === id);
      return out;
    },
    async dossier(id) {
      const d = clone(await cached(dossiers, `dossiers/${encodeURIComponent(id)}.json`, id));
      const cut = overlay.holds.get(id)?.seq ?? mirror.seq;
      d.timeline = (d.timeline || []).filter((e) => !Number.isFinite(e.seq) || e.seq <= Math.min(cut, mirror.seq));
      if (overlay.stamps.has(id) && d.matrix?.cells?.[id]) {
        d.matrix.cells[id]['CP-ACCEPT'] = { mandatory: true, empty: false, stamp: 'accepted', decision: 'принято ОТК' };
      }
      d.timeline.push(...(human.get(id) || []));
      return d;
    },
    async verify(id) {
      const p = await api.profile(id);
      const c = p.chain || { code: 'OK' };
      const own = overlay.stamps.get(id);
      return { ...c, detail: own ? `Демо: клеймо подписано ключом демо-сеанса ${own.author_id} и проверено в браузере; `
        + 'остальные звенья собраны сюжетом — их пересчитывает ядро.' : 'Демо: цепочку собрал сюжет; пересчитывает её ядро.' };
    },
    async cards() {
      return [...mirror.cards.values()];
    },
    async warnings() {
      return [];
    },
    async card(id) {
      // карточку в демо ведёт сюжет: решения по ней видны, кнопок нет
      const c = mirror.cards.get(id);
      if (!c) throw Object.assign(new Error('нет в демо-данных'), { status: 404 });
      const decs = journal.filter((ev) => ev.type === 'decision' && ev.decision?.target_id === id).map((ev) => ev.decision);
      const byId = new Map(decs.map((d) => [d.event_id, d]));
      // наблюдение и изображения — из файла карточки; статус и решения — как их видит поток сейчас
      const full = await cached(fullCards, `cards/${encodeURIComponent(id)}.json`, id).catch(() => ({}));
      return { ...clone(full), ...c, decisions: [...byId.values()], allowed_actions: [], based_on_seq: mirror.seq };
    },
    async roles() {
      return getJson('roles.json');
    },
    async version() {
      return { mode: 'demo', rules_version: 'rules-1' };
    },
    // оповещения — из активных предупреждений и карточек сюжета, по часам сюжета (demo_notify.js)
    async notifications() {
      return demoNotifications(mirror, { acks, now: Date.parse(now()), role: getRole()?.id });
    },
    // изображение-доказательство: в демо — файл demo/evidence/<evidence_id>.png
    async evidence(ref) {
      return ref?.evidence_id ? `${base}evidence/${encodeURIComponent(ref.evidence_id)}.png` : null;
    },
    now: () => Date.parse(now()),
    decide: (req, role) => (req.action === 'take_review' && req.target_kind !== 'item' ? ack(req, role) : decide(req, role)),
  };

  async function ack(req, role) {
    const at = now();
    const res = demoAck(req, role, await api.notifications(), { acks, at });
    if (res.http === 202 && res.result.detail !== 'Оповещение уже принято.') {
      const who = role?.actor || role?.id || '—';
      const decision = { event_id: `demo-ack-${req.target_id}-${Date.now()}`, kind: 'review', action: 'take_review', author_id: who,
        role: role?.id, decided_at: at, signed: true, target_kind: req.target_kind, target_id: req.target_id };
      deliver({ type: 'decision', seq: mirror.seq + 1, at, event_type: 'decision.recorded', decision,
        summary: `${who}: оповещение принято — ${req.target_kind === 'nonconformance' ? 'карточка' : 'предупреждение'} взято на рассмотрение` });
      res.result.seq = mirror.seq;
    }
    return res;
  }

  const decide = createDecide({ mirror, story, overlay, signer, templates: () => decisions, now, publish, deliver, remember,
    profile: (id) => api.profile(id), dossier: (id) => api.dossier(id) });

  return {
    api,
    mirror,
    story,
    overlay,
    EventSource: DemoEventSource,
    async load() {
      const text = await (await fetchImpl(`${base}stream.jsonl`)).text();
      frames = parseJsonl(text);
      decisions = await getJson('decisions.json').catch(() => ({}));
      overlay.templates = new Set(Object.keys(decisions));
      if (!frames.length) throw new Error('демо-сюжет пуст');
    },
    start() {
      paused = false;
      schedule();
      clearInterval(hb);
      hb = setInterval(() => {
        if (Date.now() - lastAt >= HEARTBEAT_MS - 50) deliver({ type: 'heartbeat', seq: mirror.seq, at: now() });
      }, HEARTBEAT_MS / 3);
      status();
    },
    stop() {
      clearTimeout(timer);
      clearInterval(hb);
      for (const s of [...subs]) s.close();
    },
    pause(v = !paused) {
      if (v && !paused && storyMs !== null) tickClock(now()); // пауза останавливает и часы сюжета
      paused = v;
      if (!paused && storyMs !== null) storyWall = Date.now();
      if (!paused) schedule();
      else clearTimeout(timer);
      status();
    },
    setSpeed(v) {
      if (storyMs !== null) tickClock(now());
      speed = v;
      schedule();
      status();
    },
    restart,
    // Обрыв связи на ms: открытые потоки рвутся, новые подключения отклоняются; журнал копится,
    // StreamClient переподключается сам (пауза 1→2→4 с) с since_seq и получает всё пропущенное
    outage(ms = 6000) {
      if (down) return false;
      down = true;
      recovering = true;
      for (const s of [...subs]) s.fail();
      setTimeout(() => {
        down = false;
      }, ms);
      return true;
    },
    get down() {
      return down;
    },
    stationKey,
  };
}
