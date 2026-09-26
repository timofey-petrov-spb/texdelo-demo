// Поток /v1/stream (SSE): переподключение с since_seq и нарастающей паузой, сторож тишины.
// Логика без DOM: EventSource и таймеры подставляются — так её проверяет node --test.

export const HEARTBEAT_S = 15;
export const SILENCE_MS = HEARTBEAT_S * 1000 * 2.5;
export const MAX_DELAY_MS = 30000;
// Скрытая вкладка не держит поток (QA Ф13): у браузера 6 соединений на один адрес ядра, у вкладки табло — поток на
// каждую линию; две-три открытые вкладки табло забирают все соединения, и в видимой запросы профиля не проходят.
// Через HIDDEN_CLOSE_MS после скрытия вкладки поток закрывается; вкладку снова показали — открывается с since_seq и
// дочитывает пропущенное (как после обрыва связи)
export const HIDDEN_CLOSE_MS = 15000;
const TYPES = ['hello', 'line', 'item', 'warning', 'decision', 'card', 'heartbeat'];

export function streamUrl(base, { lineId, sinceSeq } = {}) {
  const q = new URLSearchParams();
  if (lineId) q.set('line_id', lineId);
  if (Number.isFinite(sinceSeq) && sinceSeq > 0) q.set('since_seq', String(sinceSeq));
  const s = q.toString();
  return `${base || ''}/v1/stream${s ? `?${s}` : ''}`;
}

// Пауза перед попыткой attempt (0, 1, 2…): 1 с, 2 с, 4 с… не больше 30 с, с разбросом ±25 %
export function backoff(attempt, rand = Math.random) {
  const base = Math.min(MAX_DELAY_MS, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + 0.5 * rand()));
}

// Стенд перезапущен с чистым журналом (`run.ps1 -Fresh`): ядро выдало ролям новые ключи, старый ключ вкладки — 401,
// и табло «висело» с «Нет связи … Ядро ответило 401» (QA Н-22). Поток, который уже был живым, на 401 перезагружает
// страницу — табло заново берёт роли и снимок; не чаще раза в минуту (без петли, если ключ и правда неверный)
export const RELOAD_GAP_MS = 60000;

export function reloadAfterRestart(win = globalThis, now = Date.now()) {
  try {
    const last = Number(win.sessionStorage?.getItem('texdelo.board.reloadAt')) || 0;
    if (now - last < RELOAD_GAP_MS) return false;
    win.sessionStorage?.setItem('texdelo.board.reloadAt', String(now));
  } catch {
    // хранилище недоступно — перезагрузка всё равно поможет
  }
  if (typeof win.location?.reload !== 'function') return false;
  win.location.reload();
  return true;
}

export function parseMessage(data) {
  try {
    const ev = JSON.parse(data);
    return ev && typeof ev === 'object' && typeof ev.type === 'string' && Number.isFinite(ev.seq) ? ev : null;
  } catch {
    return null;
  }
}

export class StreamClient {
  // opts: base, lineId, getSeq() — последний применённый seq этого потока, onEvent(ev), onStatus({state, seq, attempt,
  // retryMs, http, detail}), EventSourceImpl — EventSource или совместимый (FetchEventSource с токеном, поток демо),
  // init() — второй аргумент конструктора (заголовки для FetchEventSource), doc — документ со свойством hidden и
  // событием visibilitychange (по умолчанию document; pauseHidden: false — держать поток и в скрытой вкладке)
  constructor(opts) {
    this.o = {
      EventSourceImpl: globalThis.EventSource,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      now: () => Date.now(),
      rand: Math.random,
      doc: globalThis.document,
      pauseHidden: true,
      ...opts,
    };
    this.es = null;
    this.attempt = 0;
    this.retryTimer = null;
    this.watchTimer = null;
    this.hiddenTimer = null;
    this.parked = false;
    this.stopped = true;
    this.lastMessageAt = 0;
    this.bad = 0;
  }

  start() {
    this.stopped = false;
    this.parked = false;
    this.bindVisibility();
    this.open();
  }

  stop() {
    this.stopped = true;
    this.parked = false;
    this.close();
    if (this.retryTimer) this.o.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.hiddenTimer) this.o.clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
  }

  bindVisibility() {
    const d = this.o.doc;
    if (this.visBound || !this.o.pauseHidden || typeof d?.addEventListener !== 'function') return;
    this.visBound = true;
    d.addEventListener('visibilitychange', () => this.visibility());
  }

  // Вкладку скрыли — поток закроется через HIDDEN_CLOSE_MS; показали — откроется снова с since_seq
  visibility() {
    const hidden = !!this.o.doc?.hidden;
    if (hidden) {
      if (this.stopped || this.hiddenTimer) return;
      this.hiddenTimer = this.o.setTimeout(() => {
        this.hiddenTimer = null;
        if (this.o.doc?.hidden && !this.stopped) {
          this.stop();
          this.parked = true;
        }
      }, HIDDEN_CLOSE_MS);
      return;
    }
    if (this.hiddenTimer) this.o.clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    if (this.parked) {
      this.attempt = 0;
      this.start();
    }
  }

  close() {
    if (this.es) {
      this.es.onopen = null;
      this.es.onerror = null;
      this.es.onmessage = null;
      this.es.close();
    }
    this.es = null;
    if (this.watchTimer) this.o.clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  status(state, extra = {}) {
    this.o.onStatus?.({ state, seq: this.o.getSeq?.() ?? 0, attempt: this.attempt, ...extra });
  }

  open() {
    if (this.stopped) return;
    const since = this.o.getSeq?.() ?? 0;
    this.url = streamUrl(this.o.base, { lineId: this.o.lineId, sinceSeq: since });
    this.status(this.attempt ? 'reconnecting' : 'connecting');
    const es = new this.o.EventSourceImpl(this.url, this.o.init?.());
    this.es = es;
    const handle = (e) => this.message(e);
    es.onmessage = handle;
    if (typeof es.addEventListener === 'function') for (const t of TYPES) es.addEventListener(t, handle);
    es.onopen = () => {
      this.lastMessageAt = this.o.now();
      this.watch();
    };
    es.onerror = (e) => this.fail(e);
  }

  message(e) {
    this.lastMessageAt = this.o.now();
    const ev = parseMessage(e?.data);
    if (!ev) {
      this.bad += 1;
      return;
    }
    if (this.attempt || !this.live) {
      this.attempt = 0;
      this.live = true;
      this.wasLive = true;
    }
    this.o.onEvent(ev);
    this.status('live');
    this.watch();
  }

  watch() {
    if (this.watchTimer) this.o.clearTimeout(this.watchTimer);
    this.watchTimer = this.o.setTimeout(() => {
      if (this.o.now() - this.lastMessageAt >= SILENCE_MS) this.fail();
    }, SILENCE_MS);
  }

  fail(e) {
    if (this.stopped) return;
    this.close();
    this.live = false;
    const retryMs = backoff(this.attempt, this.o.rand);
    this.attempt += 1;
    const http = Number.isFinite(e?.status) && e.status > 0 ? e.status : 0;
    this.status('lost', { retryMs, http, detail: e?.detail || '' });
    // ключ роли перестал подходить у потока, который уже работал, — стенд перезапущен: страницу заново
    if (http === 401 && this.wasLive && this.o.onUnauthorized !== false) {
      const handler = typeof this.o.onUnauthorized === 'function' ? this.o.onUnauthorized : () => reloadAfterRestart();
      if (handler() === true) return;
    }
    if (this.retryTimer) this.o.clearTimeout(this.retryTimer);
    this.retryTimer = this.o.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, retryMs);
  }
}
