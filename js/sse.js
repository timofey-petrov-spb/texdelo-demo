// Поток SSE через fetch: браузерный EventSource не умеет заголовок Authorization, а /v1/stream закрыт правом
// line.read. FetchEventSource ведёт себя как EventSource (onopen / onmessage / onerror / close), но шлёт
// токен роли и сообщает код ответа ядра (401, 403…) — табло пишет, в чём дело, а не молча переподключается.

// Разбор text/event-stream по кускам: поля data/id/event, пустая строка — конец события, «:» — комментарий
export function createSseParser(onEvent) {
  let buf = '';
  let data = [];
  let type = '';
  let id = '';
  function line(l) {
    if (l === '') {
      if (data.length) onEvent({ data: data.join('\n'), type: type || 'message', lastEventId: id });
      data = [];
      type = '';
      return;
    }
    if (l.startsWith(':')) return;
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') type = value;
    else if (field === 'id') id = value;
  }
  return (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      line(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  };
}

export function fetchStreamSupported() {
  return typeof globalThis.fetch === 'function' && typeof globalThis.ReadableStream === 'function'
    && typeof globalThis.TextDecoder === 'function' && typeof globalThis.AbortController === 'function';
}

export class FetchEventSource {
  // init: { headers, fetchImpl }
  constructor(url, init = {}) {
    this.url = String(url);
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    this.ctl = new AbortController();
    this.run(init.fetchImpl || globalThis.fetch, init.headers || {});
  }

  async run(f, headers) {
    try {
      const r = await f(this.url, { headers: { Accept: 'text/event-stream', ...headers }, signal: this.ctl.signal,
        cache: 'no-store' });
      if (!r.ok || !r.body) {
        let detail = '';
        try {
          const body = await r.json();
          detail = typeof body?.detail === 'string' ? body.detail : '';
        } catch {
          detail = '';
        }
        this.error(r.status || 0, detail);
        return;
      }
      if (this.closed) return;
      this.readyState = 1;
      this.onopen?.({});
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const parse = createSseParser((m) => {
        if (!this.closed) this.onmessage?.(m);
      });
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.closed) break;
        parse(dec.decode(value, { stream: true }));
      }
      this.error(0, 'ядро закрыло поток');
    } catch {
      this.error(0, '');
    }
  }

  error(status, detail) {
    if (this.closed) return;
    this.readyState = 2;
    this.onerror?.({ status, detail });
  }

  close() {
    this.closed = true;
    this.readyState = 2;
    this.ctl.abort();
  }
}
