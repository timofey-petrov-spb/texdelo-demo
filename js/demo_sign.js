// Клеймо в демо подписывается по-настоящему. Ключ Ed25519 инженера ОТК создаётся в браузере на время сеанса
// (WebCrypto), решение подписывается им и сразу проверяется открытым ключом — «подпись проверена ✓» на клейме
// означает проверенную подпись, а не надпись из заготовки. Голова цепочки изделия — SHA-256 от головы по
// истории детали и подписи решения. Ключ демо-сеанса — не ключ ядра: так и написано в key_id.
// Нет WebCrypto с Ed25519 (старый браузер, страница не с localhost по http) — клеймо без отметки о проверке,
// табло пишет «подпись не проверялась».

const enc = new TextEncoder();

export function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Канонический JSON: ключи по алфавиту, без пробелов — одинаковая запись даёт одинаковые байты
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export async function sha256hex(subtle, text) {
  return hex(await subtle.digest('SHA-256', enc.encode(text)));
}

export function createSigner(subtle = globalThis.crypto?.subtle) {
  const keys = new Map();

  async function keyFor(author) {
    if (!keys.has(author)) {
      keys.set(author, (async () => {
        const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
        const raw = await subtle.exportKey('raw', pair.publicKey);
        return { ...pair, fp: hex(raw).slice(0, 8) };
      })().catch((e) => {
        keys.delete(author);
        throw e;
      }));
    }
    return keys.get(author);
  }

  return {
    available: !!subtle,
    // Подписать решение: вернуть поля клейма (голова цепочки, ключ, алгоритм, результат проверки)
    async stamp(author, decision, history) {
      if (!subtle) return { unverified: 'нет WebCrypto: страница открыта не с localhost' };
      const prev = await sha256hex(subtle, canonical(history || []));
      try {
        const k = await keyFor(author);
        const payload = enc.encode(canonical({ ...decision, author_id: author, prev_head: prev }));
        const sig = await subtle.sign({ name: 'Ed25519' }, k.privateKey, payload);
        const verified = await subtle.verify({ name: 'Ed25519' }, k.publicKey, sig, payload);
        return { item_hash: await sha256hex(subtle, prev + hex(sig)), key_id: `${author}-ed25519-демо-сеанс-${k.fp}`,
          signature_alg: 'Ed25519', verified };
      } catch {
        return { item_hash: await sha256hex(subtle, prev + canonical(decision)),
          unverified: 'браузер не умеет Ed25519 — подпись не сформирована' };
      }
    },
  };
}
