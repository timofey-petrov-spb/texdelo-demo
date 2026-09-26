// Клеймо ОТК на экране: что известно о подписи. Профиль детали (Stamp) может прийти без ключа и без проверки
// подписи, хотя решение подписано: тогда берутся ответ ядра на само решение (DecisionResult.stamp) и проверка
// цепочки изделия (GET /v1/items/{id}/verify: подписанты «автор (ключ)»). «Подпись не сходится» — только когда
// проверка действительно была и не прошла; без ключа — «подпись не проверялась». Без DOM — node --test.

const SIGN_FIELDS = ['key_id', 'signature_alg', 'verified', 'verification', 'key_version', 'profile_id'];

// Клеймо профиля + клеймо из ответа на решение (то же решение): недостающее — из ответа
export function mergeStamp(fromProfile, fromDecision) {
  if (!fromProfile) return fromDecision || null;
  if (!fromDecision) return fromProfile;
  const a = fromProfile.decision_event_id;
  const b = fromDecision.decision_event_id;
  if (a && b && a !== b) return fromProfile;
  const out = { ...fromProfile };
  for (const k of ['item_hash', 'seq', 'author_title', 'statement']) if (out[k] == null && fromDecision[k] != null) out[k] = fromDecision[k];
  // подпись: у профиля без ключа — сведения о подписи из ответа на решение целиком
  if (!out.key_id && fromDecision.key_id) for (const k of SIGN_FIELDS) if (fromDecision[k] != null) out[k] = fromDecision[k];
  return out;
}

// Подписант решения в проверке цепочки: «QC-01 (QC-01-ed25519-2026)» → ключ
function signerKey(verdict, author) {
  if (!author || !Array.isArray(verdict?.signers)) return null;
  for (const s of verdict.signers) {
    const m = /^(.+?) \((.+)\)$/.exec(String(s));
    if (m && m[1] === author) return m[2];
  }
  return null;
}

// state: ok — подпись проверена; bad — проверка была и не прошла; unknown — не проверялась
export function stampSignature(stamp, verdict = null) {
  if (!stamp) return { state: 'unknown', text: 'подпись не проверялась', key: null };
  const here = verdict?.seq == null || stamp.seq == null || verdict.seq === stamp.seq; // не сошлась подпись этой записи
  if (verdict?.code === 'SIGNATURE_INVALID' && here) {
    return { state: 'bad', text: 'подпись не сходится', key: stamp.key_id || null, detail: verdict.detail || '' };
  }
  if (stamp.verified === true) return { state: 'ok', text: 'подпись проверена', key: stamp.key_id || null, detail: stamp.verification || '' };
  if (stamp.verified === false && stamp.key_id) return { state: 'bad', text: 'подпись не сходится', key: stamp.key_id, detail: stamp.verification || '' };
  const key = verdict?.code === 'OK' ? signerKey(verdict, stamp.author_id) : null;
  if (key) return { state: 'ok', text: 'подпись проверена при проверке цепочки', key, detail: verdict.detail || '' };
  return { state: 'unknown', text: 'подпись не проверялась', key: stamp.key_id || null, detail: '' };
}

// Нужна ли проверка цепочки, чтобы сказать о подписи клейма
export function needsVerify(stamp, verdict = null) {
  return !!stamp && !verdict && stampSignature(stamp).state === 'unknown';
}
