// Профиль детали в демо на текущий момент сюжета: профили demo/profiles собраны на конец сюжета, поэтому
// проверки позже текущего seq — «впереди», клеймо позже — снято, препятствия пересчитаны по живой детали,
// а решения человека (клеймо, удержание, снятие удержания) наложены поверх. allowed_actions — готовые решения
// kind:action (DOMAIN §8.1) по состоянию детали и праву роли, как их отфильтровало бы ядро. Чистая функция — node --test.

import { DEMO_RIGHTS } from './demo_decide.js';

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export function maskProfile(profile, seq, liveItem, overlay = {}, role = null) {
  const p = clone(profile);
  if (!p || !Array.isArray(p.checks)) return p;
  const id = p.item?.item_id;
  const hold = overlay.holds?.get(id);
  // удержанная на защите деталь стоит там, где её удержали: дальше сюжета для неё нет
  const cut = hold && Number.isFinite(hold.seq) ? Math.min(seq, hold.seq) : seq;
  const ahead = [];
  p.checks = p.checks.map((c) => {
    if (Number.isFinite(c.seq) && c.seq > cut) {
      ahead.push(c.title || c.control_point_id);
      const keep = ['control_point_id', 'title', 'station_id', 'order', 'mandatory', 'operation_id'];
      return { ...Object.fromEntries(keep.filter((k) => k in c).map((k) => [k, c[k]])), zone: 'not_checked',
        reason: 'деталь до этой точки ещё не дошла' };
    }
    return c;
  });
  if (ahead.length) {
    const done = p.checks.filter((c) => c.zone !== 'not_checked');
    const margins = done.flatMap((c) => c.margins || []).filter((m) => Number.isFinite(m.margin_pct));
    p.min_margin = margins.length ? margins.reduce((a, b) => (b.margin_pct < a.margin_pct ? b : a)) : undefined;
    const skipped = p.checks.filter((c) => c.zone === 'not_checked' && Number.isFinite(c.seq)).length;
    p.coverage = { ...p.coverage, reliable: done.filter((c) => c.reliable !== false).length,
      unreliable: done.filter((c) => c.reliable === false).length, skipped,
      pending: p.checks.length - done.length - skipped };
    p.trend = (p.trend || []).filter((t) => !Number.isFinite(t.seq) || t.seq <= cut);
  }
  const acc = p.acceptance || { allowed: false, blockers: [] };
  let blockers = (acc.blockers || []).filter((b) => !b.startsWith('Деталь ещё не прошла'));
  if (liveItem && !liveItem.on_hold) blockers = blockers.filter((b) => !b.startsWith('Действует удержание'));
  if (liveItem && !liveItem.open_cards) blockers = blockers.filter((b) => !b.startsWith('Открыта карточка'));
  if (ahead.length) blockers.unshift(`Деталь ещё не прошла обязательные точки: ${ahead.join(', ')}`);
  if (hold) blockers.push(`Действует удержание: ${hold.reason} (${hold.author})`);
  acc.blockers = blockers;
  if (acc.stamp && Number.isFinite(acc.stamp.seq) && acc.stamp.seq > seq) delete acc.stamp;
  const stamp = overlay.stamps?.get(id);
  if (stamp) {
    acc.stamp = stamp;
    // клеймо — новое звено цепочки изделия, подписанное личным ключом инженера ОТК
    const ch = p.chain || { code: 'OK' };
    p.chain = { ...ch, blocks: (ch.blocks || 0) + 1, seq: stamp.seq,
      signers: [...new Set([...(ch.signers || []), stamp.author_id])].sort() };
  }
  // клеймо в демо ставится, только если для детали есть заготовка ответа (demo/decisions.json)
  acc.allowed = !acc.stamp && blockers.length === 0 && !!overlay.templates?.has(id);
  const held = liveItem ? !!liveItem.on_hold : !!hold;
  const atOtk = liveItem ? liveItem.status === 'under_inspection' : !acc.stamp && !ahead.length;
  const actions = [];
  if (acc.stamp) {
    actions.push('approval:approve');
  } else {
    if (acc.allowed) actions.push('acceptance:accept');
    actions.push(held ? 'hold:release' : 'hold:hold');
    if (atOtk && !held) actions.push('acceptance:return_for_rework');
  }
  acc.allowed_actions = role ? actions.filter((a) => DEMO_RIGHTS[role]?.has(a)) : actions;
  acc.based_on_seq = seq;
  p.acceptance = acc;
  p.as_of_seq = seq;
  if (liveItem) p.item = { ...liveItem };
  return p;
}
