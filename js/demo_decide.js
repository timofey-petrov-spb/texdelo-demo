// Решения человека в демо (POST /v1/decisions без ядра): права по роли, клеймо с настоящей подписью WebCrypto,
// удержание, снятие удержания, возврат на доработку — и квитанции MES и 1С на решение через 1,5 с, как их
// прислал бы обмен с внешними системами (события v1.2 external.receipt, API v1.3 DecisionView.receipts).

import { dropEntry, itemFlags, setEntry } from './demo_overlay.js';

// Права ролей на решения по изделию в демо (в эксплуатации — config/roles.yaml ядра)
export const DEMO_RIGHTS = {
  controller: new Set(['acceptance:accept', 'acceptance:accept_after_rework', 'acceptance:return_for_rework', 'hold:hold', 'hold:release']),
  foreman: new Set(['hold:hold']),
  customer_rep: new Set(['approval:approve']),
};

// Что отвечают внешние системы на решение — как в генераторе сюжета (demo/demo_receipts.py)
const RECEIPTS = {
  hold: [['MES', 'accepted', 'item_on_hold', 'операции над изделием заблокированы до снятия удержания'],
    ['1C', 'delivered', 'queued', 'удержание получено, проведение — после решения ОТК']],
  release: [['MES', 'accepted', 'item_released', 'операции над изделием снова разрешены']],
  accept: [['MES', 'accepted', 'moved_to_store', 'изделие передано на склад готовой продукции'],
    ['1C', 'accepted', 'release_posted', 'выпуск изделия проведён']],
  return_for_rework: [['MES', 'accepted', 'rework_order', 'выдан наряд на доработку']],
};
const SYS = { MES: 'MES', '1C': '1С' };
export const RECEIPT_DELAY_MS = 1500;

export function demoReceipts(decision, seq, at) {
  const rows = RECEIPTS[decision.action] || [];
  return rows.map(([system, status, code, detail], i) => ({ system, status, code, detail,
    receipt_no: `${SYS[system]}-${String(seq - rows.length + 1 + i).padStart(6, '0')}`,
    event_id: `${decision.event_id}-${system}`, seq: seq - rows.length + 1 + i, received_at: at }));
}

// ctx: mirror, story, overlay, signer, templates(), now(), profile(id), dossier(id), publish(), deliver(), remember()
export function createDecide(ctx) {
  const denied = (detail) => ({ http: 403, result: { status: 'forbidden', detail } });
  const rejected = (detail) => ({ http: 422, result: { status: 'rejected', detail } });

  // квитанции приходят позже решения: то же решение с receipts — в поток, строки квитанций — в дело изделия
  function receipts(decision, id, t) {
    if (!RECEIPTS[decision.action]) return;
    setTimeout(() => {
      const n = RECEIPTS[decision.action].length;
      const seq = ctx.mirror.seq + n;
      const at = ctx.now();
      const rs = demoReceipts(decision, seq, at);
      for (const r of rs) {
        ctx.remember(id, { seq: r.seq, occurred_at: at, event_type: 'external.receipt', source_id: `${r.system}-01`,
          signed_by: `${r.system}-01`, receipt_for: decision.event_id, summary: `${SYS[r.system]}, квитанция ${r.receipt_no}: ${r.detail}` });
      }
      ctx.deliver({ type: 'decision', seq, at, event_type: 'external.receipt', decision: { ...decision, receipts: rs },
        summary: `Квитанции по ${t}: ${rs.map((r) => `${SYS[r.system]} — ${r.detail}`).join('; ')}` });
    }, RECEIPT_DELAY_MS);
  }

  return async function decide(req, role) {
    const { mirror, story, overlay } = ctx;
    const id = req.target_id;
    const item = mirror.items.get(id);
    const who = role?.actor || 'QC-01';
    if (!item) return rejected('Деталь не найдена на линии.');
    const t = String(id).replace(/^BD-/, 'БД-');
    const at = ctx.now();
    const code = `${req.kind}:${req.action}`;
    const base = { event_id: `demo-${req.action}-${id}-${Date.now()}`, kind: req.kind, action: req.action, author_id: who,
      role: role?.id, reason: req.reason, decided_at: at, signed: true, target_kind: 'item', target_id: id };
    const entry = (item2, flags, extra = {}) => ({ item_id: id, line_id: item.line_id, base: story.items.get(id) || item,
      item: item2, flags, ...extra });
    const note = (seq, text) => ctx.remember(id, { seq, occurred_at: at, event_type: 'decision.recorded', source_id: who, signed_by: who, summary: text });
    if (!DEMO_RIGHTS[role?.id]?.has(code)) {
      const who2 = req.action === 'hold' ? 'инженер ОТК или мастер участка' : req.action === 'approve' ? 'представитель заказчика' : 'инженер ОТК';
      return denied(`Это решение принимает ${who2}; у роли «${role?.title || '—'}» права нет — отказ записан.`);
    }
    if (req.action === 'approve') {
      return { http: 202, result: { status: 'accepted', seq: mirror.seq,
        detail: `Приёмка согласована представителем заказчика ${who}; решение подписано его ключом.` } };
    }
    if (req.action === 'accept' || req.action === 'accept_after_rework') {
      const tpl = ctx.templates()[id];
      const profile = await ctx.profile(id).catch(() => null);
      if (!tpl || !profile?.acceptance?.allowed) {
        return rejected((profile?.acceptance?.blockers || [])[0] || 'Есть препятствия к приёмке.');
      }
      const history = (await ctx.dossier(id).catch(() => null))?.timeline || [];
      const eventId = tpl.stamp?.decision_event_id || tpl.event_id || base.event_id;
      const sig = await ctx.signer.stamp(who, { item_id: id, action: 'accept', statement: tpl.stamp?.statement || 'Принято ОТК',
        decided_at: at, decision_event_id: eventId }, history);
      const stamp = { ...tpl.stamp, author_id: who, decided_at: at, decision_event_id: eventId };
      for (const k of ['item_hash', 'key_id', 'verified']) delete stamp[k];
      for (const k of ['item_hash', 'key_id', 'signature_alg', 'verified']) if (sig[k] !== undefined) stamp[k] = sig[k];
      stamp.seq = mirror.seq + 1;
      setEntry(overlay, entry({ ...item, accepted: true, on_hold: false, status: 'accepted_qc', status_title: 'принято ОТК',
        station_id: 'STORE', location: 'Склад готовой продукции', progress: 1 }, { accepted: true, on_hold: false, at_otk: false }, { stamp }));
      const signed = stamp.verified === true ? `подписано ключом ${who} (Ed25519), подпись проверена` : 'подпись не проверялась';
      note(stamp.seq, `${who}: клеймо ОТК «Принято», ${signed}`);
      const decision = { ...base, event_id: eventId };
      ctx.publish(decision, `${who}: клеймо ОТК «Принято» на ${t}, ${signed}`, overlay.entries.get(id).item, item.line_id);
      receipts({ ...decision, seq: stamp.seq }, id, t);
      const detail = stamp.verified === true ? tpl.detail : `Клеймо поставлено; ${sig.unverified || 'подпись не проверялась'}.`;
      return { http: 202, result: { ...tpl, detail, stamp, seq: stamp.seq } };
    }
    if (req.action === 'hold') {
      if (item.on_hold) return rejected('Деталь уже удержана.');
      const hold = { reason: req.reason, author: who, seq: mirror.seq + 1, at };
      setEntry(overlay, entry({ ...item, on_hold: true, status: 'on_hold', status_title: 'удержано' },
        { accepted: false, on_hold: true, at_otk: itemFlags(item).at_otk }, { hold }));
      note(hold.seq, `${who}: удержано — ${req.reason}`);
      const seq = ctx.publish(base, `${who}: удержана ${t} — ${req.reason}`, overlay.entries.get(id).item, item.line_id);
      receipts({ ...base, seq }, id, t);
      return { http: 202, result: { status: 'accepted', seq, detail: 'Удержание записано и подписано.' } };
    }
    if (req.action === 'release') {
      if (!item.on_hold) return rejected('Деталь не удержана — снимать нечего.');
      let shown;
      if (overlay.holds.has(id)) {
        dropEntry(overlay, id); // удержание ставили здесь — деталь возвращается к сюжету
        shown = { ...(story.items.get(id) || item) };
      } else {
        shown = { ...item, on_hold: false, status: 'in_work', status_title: 'удержание снято' };
        setEntry(overlay, entry(shown, { accepted: false, on_hold: false, at_otk: false }));
      }
      note(mirror.seq + 1, `${who}: удержание снято — ${req.reason}`);
      const seq = ctx.publish(base, `${who}: снято удержание ${t} — ${req.reason}`, shown, item.line_id);
      receipts({ ...base, seq }, id, t);
      return { http: 202, result: { status: 'accepted', seq, detail: 'Удержание снято; решение записано и подписано.' } };
    }
    if (req.action === 'return_for_rework') {
      const sl = story.lines.get(item.line_id);
      const route = sl?.route || [];
      const i = route.indexOf(item.station_id);
      const back = i > 0 ? route[i - 1] : item.station_id;
      setEntry(overlay, entry({ ...item, status: 'in_work', status_title: 'возвращено на доработку', station_id: back,
        location: sl?.stations.get(back)?.title || item.location }, { accepted: false, on_hold: false, at_otk: false }));
      note(mirror.seq + 1, `${who}: возвращено на доработку — ${req.reason}`);
      const seq = ctx.publish(base, `${who}: ${t} возвращена на доработку — ${req.reason}`, overlay.entries.get(id).item, item.line_id);
      receipts({ ...base, seq }, id, t);
      return { http: 202, result: { status: 'accepted', seq, detail: 'Возврат на доработку записан.' } };
    }
    return rejected('Такое решение в демо не поддержано.');
  };
}
