// Обращения к ядру по контракту API v1.4. Базовый адрес — тот же источник (ядро раздаёт табло по /board)
// или ?api=http://127.0.0.1:8100. Каждый запрос — с токеном выбранной роли (Authorization: Bearer); роли и токены
// рабочих мест — GET /v1/demo/roles (режим dev). Решения — POST /v1/decisions с ключом идемпотентности.

export class ApiError extends Error {
  constructor(status, detail, body = null) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

export function resolveApiBase(search) {
  const p = new URLSearchParams(search || '');
  const api = p.get('api');
  if (!api) return '';
  try {
    const u = new URL(api);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function isDemoForced(search) {
  const v = new URLSearchParams(search || '').get('demo');
  return v === '1' || v === 'true';
}

// detail ответа ядра: строка, список ошибок проверки (422 FastAPI: [{loc, msg}]) или объект
export function detailOf(body) {
  const d = body?.detail;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d.map((x) => {
      if (typeof x === 'string') return x;
      const field = Array.isArray(x?.loc) ? x.loc.filter((k) => k !== 'body').join('.') : '';
      return [field, x?.msg].filter(Boolean).join(': ');
    }).filter(Boolean).join('; ');
  }
  if (typeof d === 'object') return String(d.msg || d.message || '');
  return String(d);
}

// Снимок линии не получен: в демо — только когда ядра нет (сеть, тайм-аут, статический сервер без API)
// и адрес ядра не задан явно; ответ ядра с ошибкой (401, 403, 5xx…) — экран с кодом и причиной
export function bootFallback(error, explicitApi = false) {
  const status = Number(error?.status) || 0;
  const noCore = status === 0 || ([404, 405, 501].includes(status) && !error?.body);
  return noCore && !explicitApi ? 'demo' : 'error';
}

// Роли рабочих мест не получены (GET /v1/demo/roles): что делать табло.
//   token — ответило само ядро (JSON-ответ; режим strict, ядро без API v1.3 или запрос не с самого сервера):
//           ядро работает, нужен токен роли — показать поле токена, а не запись;
//   demo  — ядра нет (сеть, тайм-аут, статический сервер отдал 404 без JSON) и адрес ядра не задан явно;
//   error — всё остальное: экран с кодом и причиной.
export function rolesFallback(error, explicitApi = false) {
  const status = Number(error?.status) || 0;
  if (status === 404 && error?.body && typeof error.body === 'object') return 'token';
  if (bootFallback(error, explicitApi) === 'demo') return 'demo';
  return [404, 405, 501].includes(status) && explicitApi ? 'token' : 'error';
}

export async function request(base, path, { method = 'GET', token, body, timeoutMs = 5000, fetchImpl, headers: extra } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = { Accept: 'application/json', ...(extra || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const r = await f(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal,
    });
    let data = null;
    const text = await r.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: r.status, ok: r.ok, data };
  } catch (e) {
    // таймаут чаще всего — занятые соединения браузера (много вкладок табло держат потоки), а не сбой ядра
    throw new ApiError(0, e?.name === 'AbortError'
      ? `нет ответа за ${Math.round(timeoutMs / 1000)} с — возможно, открыто много вкладок табло` : 'нет связи с ядром');
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(base, path, opts = {}) {
  const r = await request(base, path, opts);
  if (!r.ok) throw new ApiError(r.status, detailOf(r.data) || `ядро ответило ${r.status}`, r.data);
  return r.data;
}

// Решение записано: 2xx и статус accepted (или статуса нет)
export function decisionOk(http, result) {
  return http >= 200 && http < 300 && (!result?.status || result.status === 'accepted');
}

const BY_STATUS = { forbidden: 403, stale: 409, rejected: 422 };
const CODES_IN_DETAIL = /\b[a-z_]+\/[a-z_]+\b|\([a-z_]+\)|\b[a-z]+_[a-z_]+\b|\b[A-Z]{2}-\d{2}\b/;

// Понятное сообщение по ответу на решение (401 / 403 / 409 / 422 / 5xx и 2xx с отказом в статусе)
export function decisionMessage(http, result) {
  const d = detailOf(result);
  const detail = d ? ` ${d}` : '';
  // ответ ядра с кодами («решение записано: hold/hold, FM-01 (foreman)») на экран не идёт (QA В-25)
  if (decisionOk(http, result)) return d && !CODES_IN_DETAIL.test(d) ? d : 'Решение записано в журнал.';
  const code = http >= 200 && http < 300 ? BY_STATUS[result?.status] || -1 : http;
  if (code === 401) return `Ядро не приняло токен роли (401) — решение не записано. Нужен действующий токен.${detail}`;
  if (code === 403) return `Нет прав на это решение — отказ записан в журнал критических действий.${detail}`;
  if (code === 409) return `Решение устарело: пока вы смотрели, данные изменились. Профиль обновлён — проверьте и повторите.${detail}`;
  if (code === 422) return `Решение не принято — нарушены правила.${detail}`;
  // без повтора: «Нет связи с ядром — решение не отправлено. (нет связи с ядром)» (QA В-38)
  if (code === 0) return `Нет связи с ядром — решение не отправлено.${d && !/^нет связи/i.test(d) ? ` ${d[0].toUpperCase()}${d.slice(1)}.` : ''}`;
  if (code === -1) return `Ядро не записало решение: статус «${result?.status}».${detail}`;
  if (code >= 500) return `Сбой ядра (${code}) — решение не записано, повторите.${detail}`;
  return `Ядро ответило ${code} — решение не записано.${detail}`;
}

const enc = encodeURIComponent;

export function createLiveApi(base, getToken, fetchImpl) {
  const opt = (extra = {}) => ({ token: getToken?.(), fetchImpl, ...extra });
  return {
    mode: 'live',
    // роли рабочих мест (режим dev); без токена — выбрать роль ещё не из чего
    roles: (timeoutMs) => getJSON(base, '/v1/demo/roles', { fetchImpl, timeoutMs }),
    version: () => getJSON(base, '/v1/version', opt()),
    card: (id) => getJSON(base, `/v1/cards/${enc(id)}`, opt()),
    line: (lineId, timeoutMs) => getJSON(base, `/v1/line${lineId ? `?line_id=${enc(lineId)}` : ''}`, opt({ timeoutMs })),
    profile: (id) => getJSON(base, `/v1/items/${enc(id)}/profile`, opt()),
    dossier: (id) => getJSON(base, `/v1/items/${enc(id)}/dossier`, opt()),
    verify: (id) => getJSON(base, `/v1/items/${enc(id)}/verify`, opt()),
    cards: () => getJSON(base, '/v1/cards', opt()),
    warnings: () => getJSON(base, '/v1/warnings?active=true', opt()),
    // оповещения с адресатами и сроками эскалации (API v1.4); allowed_actions — для роли токена. Без active=true:
    // у ядра «активно» — ещё не подтверждено, а строке полосы после «Принял» нужно показать, кто и когда принял
    notifications: () => getJSON(base, '/v1/notifications', opt()),
    // сводка монитора приёма ядра (карантин и отказы по источнику) — экран «Входные данные»
    ingestStats: () => getJSON(base, '/v1/ingest/stats', opt()),
    // изображение-доказательство (API v1.4): <img> не умеет заголовок Authorization — файл берётся с токеном
    // роли и показывается из памяти браузера. 409 — файл не совпал с отпечатком в событии
    async evidence(ref) {
      if (!ref?.evidence_id) return null;
      const f = fetchImpl || globalThis.fetch;
      const token = getToken?.();
      const r = await f(`${base}/v1/evidence/${enc(ref.evidence_id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new ApiError(r.status, r.status === 409 ? 'файл не совпадает с отпечатком в событии' : `ядро ответило ${r.status}`);
      return URL.createObjectURL(await r.blob());
    },
    async decide(req, _role, { idempotencyKey } = {}) {
      try {
        const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
        const r = await request(base, '/v1/decisions', opt({ method: 'POST', body: req, timeoutMs: 8000, headers }));
        return { http: r.status, result: r.data && typeof r.data === 'object' ? r.data : null };
      } catch (e) {
        return { http: 0, result: { status: 'rejected', detail: e.detail || e.message } };
      }
    },
  };
}
