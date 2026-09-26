// Демо без ядра для экранов К33: ответы НАСТОЯЩЕГО ядра, записанные ui/board/demo/build.py (demo_core.py) прогоном
// сюжета живой линии dataset/live/story.jsonl через приём ядра — demo/core/answers.json. Ничего не выдумывается:
// на что ядро ответило ошибкой (точки ещё нет — 404, нет права — 403, недопустимая настройка — 422), то демо и
// показывает с тем же кодом; чего в записи нет — «данных нет». Ответ — для роли, выбранной в шапке: запись сделана
// токенами тех же ролей.

import { ApiError, detailOf } from './api.js';
import { requestKey } from './sandbox_form.js';
import { roleTitle } from './texts.js';

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export function missing(text) {
  const e = new ApiError(0, text);
  e.demoMissing = true;
  return e;
}

// Ответ записи для роли: 2xx — тело, иначе — та же ошибка, что дало ядро
export function answerFor(list, roleId) {
  const hit = (Array.isArray(list) ? list : []).find((a) => (a.roles || []).includes(roleId));
  if (!hit) throw missing(`в записи ядра нет ответа для роли «${roleTitle(roleId) || 'без роли'}»`);
  if (hit.status >= 200 && hit.status < 300) return clone(hit.body);
  throw new ApiError(hit.status, detailOf(hit.body) || `ядро ответило ${hit.status}`, clone(hit.body));
}

const STORY_ONLY = 'Демо-сюжет табло собран генератором, а это считает ядро по своему журналу; в записи ядра этой '
  + 'детали нет. Настоящий расчёт ядра — на экранах «Уберегли», «Машина времени», «Метрология», «Поставщики».';

export function createCoreRecord({ base = 'demo/', fetchImpl = globalThis.fetch?.bind(globalThis), getRole = () => null } = {}) {
  let rec = null;
  const load = () => {
    if (!rec) {
      rec = fetchImpl(`${base}core/answers.json`).then((r) => {
        if (!r.ok) throw missing(`запись ответов ядра не загрузилась (${r.status})`);
        return r.json();
      }).catch((e) => {
        rec = null;
        throw e.demoMissing ? e : missing(`запись ответов ядра не загрузилась: ${e.message}`);
      });
    }
    return rec;
  };
  const role = () => getRole?.()?.id || '';
  async function answer(key, why) {
    const r = await load();
    if (!(key in (r.answers || {}))) throw missing(why || `в записи ядра нет ответа на ${key}`);
    return answerFor(r.answers[key], role());
  }
  return {
    coreRecord: async () => clone((await load()).meta),
    // «Входные данные»: ответ ядра живого стенда (LineState.sources и сводка приёма), записанный build.py
    async sourcesRecord() {
      const r = await fetchImpl(`${base}core/sources.json`).catch(() => null);
      if (!r || !r.ok) throw missing('запись источников живого стенда не загрузилась');
      return r.json();
    },
    escapeCards: () => answer('GET /v1/cards'),
    coreCard: (nc) => answer(`GET /v1/cards/${nc}`),
    escapeLadder: (nc) => answer(`GET /v1/cards/${nc}/escape`, STORY_ONLY),
    escapeSummary: () => answer('GET /v1/escape/summary'),
    escapePoints: () => answer('GET /v1/escape/points'),
    // ворота детали демо-сюжета — не из записи (там другой журнал); ворота из записи — на экране «Уберегли»
    gates: async () => {
      throw missing(STORY_ONLY);
    },
    coreGates: (id) => answer(`GET /v1/items/${id}/gates`),
    capability: () => answer('GET /v1/metrology/capability'),
    suspect: (id) => answer(`GET /v1/instruments/${id}/suspect`),
    suppliers: () => answer('GET /v1/suppliers/quality'),
    lotIncoming: (lot) => answer(`GET /v1/lots/${lot}/incoming`),
    sandboxPresets: async () => ((await load()).sandbox || []).map((v) => clone(v.request)),
    async sandbox(body) {
      const r = await load();
      const want = requestKey(body);
      const v = (r.sandbox || []).find((x) => requestKey(x.request) === want);
      if (!v) {
        throw missing('Этот вариант в записи ядра не прогонялся: демо показывает только записанные прогоны настоящего '
          + 'ядра — выберите вариант из списка. Любые настройки прогоняет ядро.');
      }
      return answerFor(v.answers, role());
    },
    async evidencePackFile() {
      throw missing('Пакет доказательств собирает и подписывает ядро по токену роли — в демо без ядра его нет. '
        + 'Подключите ядро: пакет проверяется командой python verify/verify_pack.py <файл>.');
    },
  };
}
