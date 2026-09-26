// Точки ядра для экранов К33 — контракт API v1.5–v1.6 (DOMAIN §16–17). Каждый запрос — с токеном роли, как в api.js.
// Ядро без точки отвечает 404 {"detail": "Not Found"} или 405 — экран пишет «точка ядра недоступна» с кодом.
//   GET  /v1/cards/{nc_id}/escape            лестница утечки (card.read)
//   GET  /v1/escape/summary, /v1/escape/points  «от чего уберегли» и точки пропуска (escape.read)
//   POST /v1/sandbox/replay                  машина времени для правил (rules.sandbox)
//   GET  /v1/items/{item_id}/evidence-pack   пакет доказательств, zip; имя файла — из Content-Disposition
//   GET  /v1/items/{item_id}/gates           ворота по карточке
//   GET  /v1/metrology/capability, GET /v1/instruments/{id}/suspect   индекс Cm и прибор под сомнением
//   POST /v1/instruments/{id}/suspect        отметить прибор под сомнением — в контракте v1.6 записи нет: ядро
//                                            ответит 404/405, экран покажет ответ как есть
//   GET  /v1/suppliers/quality, /v1/lots/{lot_id}/incoming   ступень входного контроля

import { ApiError, detailOf, getJSON, request } from './api.js';

const enc = encodeURIComponent;

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Имя файла из Content-Disposition: сначала filename* (RFC 5987, UTF-8), затем filename; иначе — запасное
export function fileNameFrom(header, fallback) {
  const h = String(header || '');
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(h);
  if (star) {
    try {
      const name = decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
      if (name && !/[\\/]/.test(name)) return name;
    } catch {
      // битая кодировка — берём обычное имя
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(h);
  const name = plain ? (plain[2] ?? plain[1]).trim() : '';
  return name && !/[\\/]/.test(name) ? name : fallback;
}

// Добавить к клиенту ядра (createLiveApi) точки К33; клиент тот же — и токен роли тот же
export function withV16(api, base, getToken, fetchImpl) {
  const opt = (extra = {}) => ({ token: getToken?.(), fetchImpl, ...extra });
  async function post(path, body, timeoutMs = 60000) {
    const r = await request(base, path, opt({ method: 'POST', body, timeoutMs }));
    if (!r.ok) throw new ApiError(r.status, detailOf(r.data) || `ядро ответило ${r.status}`, r.data);
    return r.data;
  }
  return Object.assign(api, {
    escapeLadder: (nc) => getJSON(base, `/v1/cards/${enc(nc)}/escape`, opt()),
    escapeSummary: (p = {}) => getJSON(base, `/v1/escape/summary${query(p)}`, opt({ timeoutMs: 15000 })),
    escapePoints: (p = {}) => getJSON(base, `/v1/escape/points${query(p)}`, opt({ timeoutMs: 15000 })),
    // прогон по всей истории журнала — дольше обычного чтения
    sandbox: (body) => post('/v1/sandbox/replay', body, 120000),
    gates: (id) => getJSON(base, `/v1/items/${enc(id)}/gates`, opt()),
    capability: () => getJSON(base, '/v1/metrology/capability', opt()),
    suspect: (id) => getJSON(base, `/v1/instruments/${enc(id)}/suspect`, opt()),
    suppliers: (p = {}) => getJSON(base, `/v1/suppliers/quality${query(p)}`, opt()),
    lotIncoming: (lot) => getJSON(base, `/v1/lots/${enc(lot)}/incoming`, opt()),
    // пакет доказательств (DOMAIN §16.3): zip с токеном роли, из памяти браузера — как изображение-доказательство
    async evidencePackFile(id) {
      const token = getToken?.();
      if (!token) throw new ApiError(401, 'пакет доказательств выдаётся только по токену роли');
      const f = fetchImpl || globalThis.fetch;
      let r;
      try {
        r = await f(`${base}/v1/items/${enc(id)}/evidence-pack`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/zip' } });
      } catch {
        throw new ApiError(0, 'нет связи с ядром');
      }
      if (!r.ok) {
        let body = null;
        try {
          body = JSON.parse(await r.text());
        } catch {
          body = null;
        }
        throw new ApiError(r.status, detailOf(body) || `ядро ответило ${r.status}`, body);
      }
      const name = fileNameFrom(r.headers.get('content-disposition'), `Пакет_доказательств_${id}.zip`);
      return { blob: await r.blob(), name, asOfSeq: Number(r.headers.get('x-evidence-as-of-seq')) || null };
    },
  });
}
