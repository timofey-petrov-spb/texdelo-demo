// Роли рабочих мест: с ядром — GET /v1/demo/roles (режим dev, DemoRole контракта API v1.3); ядра нет —
// демо-режим с ролями из demo/roles.json. Токенов в коде табло нет: токен роли приходит от ядра, и с ним
// уходит каждый запрос (Authorization: Bearer). В режиме strict ядро ролей не раздаёт — вход по токену.
// Без DOM — проверяется node --test.

import { roleTitle } from './texts.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// DemoRole → роль табло: key различает двух инженеров ОТК (QC-01 и QC-02)
export function normalizeRoles(list) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.role !== 'string' || typeof r.token !== 'string' || !r.token) continue;
    const actor = String(r.actor_id || '');
    const key = `${r.role}:${actor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = String(r.title || roleTitle(r.role));
    const line = roleLine(title);
    // title — для сообщений ядра и табло («у роли «QC-01, инженер ОТК» права нет»); в строке статуса — name и
    // lineLabel («Инженер ОТК», «линия 1»), код человека — в подсказке
    out.push({ key, id: r.role, actor, title: actor ? `${actor}, ${title}` : cap(title), token: r.token,
      start: startScreen(r.start_screen), name: cap(roleTitle(r.role) || title.split(',')[0]),
      line: line ? `L-${line}` : '', lineLabel: line ? `линия ${line}` : '' });
  }
  // два одинаковых рабочих места без линии в подписи (демо) различаются кодом человека
  for (const r of out) {
    if (!r.lineLabel && r.actor && out.some((x) => x !== r && x.name === r.name)) r.lineLabel = r.actor;
  }
  return out;
}

// «инженер ОТК, линия Л-1» → «1»; линии в подписи нет — пусто
export function roleLine(title) {
  const m = /линия\s+(?:Л|L)?-?\s*(\d+)/i.exec(String(title || ''));
  return m ? m[1] : '';
}

// start_screen: «otk», «#/otk», «/board/#/line» → «#/otk»; метролога — «#/metrology» (К34); неизвестное — пусто
export function startScreen(v) {
  const m = /(?:^|#\/?)(line|otk|metrology)\b/.exec(String(v || ''));
  return m ? `#/${m[1]}` : '';
}

// Сохранённая роль, иначе инженер ОТК, иначе первая
export function pickRole(roles, savedKey) {
  if (!roles.length) return null;
  // ключ «controller:QC-01», код роли «controller» или код человека «QC-01» (?role= в адресе)
  return roles.find((r) => r.key === savedKey) || roles.find((r) => r.id === savedKey) || roles.find((r) => r.actor && r.actor === savedKey)
    || roles.find((r) => r.id === 'controller') || roles[0];
}

// Роль «вход по токену» (ядро в режиме strict): кто это — знает только ядро
export function tokenRole(token) {
  return { key: 'token', id: 'token', actor: '', title: 'Вход по токену', token: String(token || '').trim(), start: '',
    name: 'Вход по токену', line: '', lineLabel: '' };
}
