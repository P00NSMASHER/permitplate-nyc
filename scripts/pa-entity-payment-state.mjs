export const TRANSIENT_SETTLEMENT_REASONS = new Set([
  'settlement_pending',
  'duplicate_settlement',
]);

export const MAX_PAYMENT_HEADER_CHARS = 16_384;
export const MAX_QUERY_CHARS = 120;

export function classifyVerifyResult({ httpStatus, body, transportError = false }) {
  if (transportError) {
    return { kind: 'unavailable', reason: 'payment_verifier_unavailable' };
  }

  if (body && body.isValid === true) {
    return { kind: 'valid', body };
  }

  if (body && body.isValid === false) {
    return {
      kind: 'invalid',
      reason: String(body.invalidReason || 'payment_verification_failed'),
      message: body.invalidMessage ? String(body.invalidMessage) : undefined,
      body,
    };
  }

  // PayAI verification success is isValid=true. Never treat generic
  // success=true as a verified payment.
  if (httpStatus === 429 || httpStatus >= 500) {
    return { kind: 'unavailable', reason: 'payment_verifier_unavailable', body };
  }

  return {
    kind: 'unavailable',
    reason: 'unexpected_verifier_response',
    body,
  };
}

export function classifySettleResult({ httpStatus, body, transportError = false }) {
  if (transportError) {
    return {
      kind: 'reconcile',
      reason: 'settlement_transport_unknown',
      body,
    };
  }

  if (body && body.success === true) {
    return { kind: 'settled', body };
  }

  const reason = body?.errorReason ? String(body.errorReason) : undefined;

  if (
    (reason && TRANSIENT_SETTLEMENT_REASONS.has(reason)) ||
    httpStatus === 429 ||
    httpStatus >= 500
  ) {
    return {
      kind: 'reconcile',
      reason: reason || `settlement_http_${httpStatus}`,
      body,
    };
  }

  if (body && body.success === false && reason) {
    return {
      kind: 'terminal_failure',
      reason,
      message: body.errorMessage ? String(body.errorMessage) : undefined,
      body,
    };
  }

  return {
    kind: 'reconcile',
    reason: 'unexpected_settlement_response',
    body,
  };
}

export async function settleWithRecovery(
  sendSettlement,
  {
    maxAttempts = 3,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    backoffMs = [250, 500],
  } = {},
) {
  let last;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await sendSettlement();
      last = classifySettleResult(response);
    } catch {
      last = classifySettleResult({
        httpStatus: 0,
        body: undefined,
        transportError: true,
      });
    }

    if (last.kind !== 'reconcile') {
      return { ...last, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 500;
      await sleep(delay);
    }
  }

  return {
    ...last,
    kind: 'reconcile',
    attempts: maxAttempts,
  };
}

export function shouldEmitFreshPaymentChallenge(result) {
  return result.kind === 'invalid' || result.kind === 'terminal_failure';
}

export function validatePaidRequestInput({ q, limit, paymentHeader }) {
  if (typeof paymentHeader !== 'string' || paymentHeader.length === 0) {
    return { ok: false, kind: 'payment_required' };
  }

  if (paymentHeader.length > MAX_PAYMENT_HEADER_CHARS) {
    return {
      ok: false,
      kind: 'payment_header_too_large',
      status: 431,
      reason: 'payment header is too large',
    };
  }

  const query = String(q ?? '').trim();

  if (query.length < 2) {
    return {
      ok: false,
      kind: 'invalid_query',
      status: 400,
      reason: 'q must contain at least 2 characters',
    };
  }

  if (query.length > MAX_QUERY_CHARS) {
    return {
      ok: false,
      kind: 'invalid_query',
      status: 400,
      reason: `q must contain at most ${MAX_QUERY_CHARS} characters`,
    };
  }

  const normalizedForSearch = query
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalizedForSearch.length < 2) {
    return {
      ok: false,
      kind: 'invalid_query',
      status: 400,
      reason: 'q must contain at least 2 searchable characters',
    };
  }

  let parsedLimit = 10;
  if (limit !== undefined && limit !== null && String(limit).trim() !== '') {
    const raw = String(limit).trim();
    if (!/^\d+$/.test(raw)) {
      return {
        ok: false,
        kind: 'invalid_limit',
        status: 400,
        reason: 'limit must be an integer from 1 to 25',
      };
    }
    parsedLimit = Number(raw);
  }

  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 25) {
    return {
      ok: false,
      kind: 'invalid_limit',
      status: 400,
      reason: 'limit must be an integer from 1 to 25',
    };
  }

  return {
    ok: true,
    query,
    normalizedForSearch,
    limit: parsedLimit,
  };
}

export function paymentHttpPolicy(result) {
  switch (result.kind) {
    case 'valid':
      return { status: 200, emitPaymentRequired: false };
    case 'invalid':
      return { status: 402, emitPaymentRequired: true };
    case 'unavailable':
      return {
        status: 503,
        emitPaymentRequired: false,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
      };
    case 'settled':
      return { status: 200, emitPaymentRequired: false, serveResult: true };
    case 'reconcile':
      return {
        status: 503,
        emitPaymentRequired: false,
        serveResult: false,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
        body: {
          error: 'payment_settlement_pending',
          retrySamePayment: true,
          reason: result.reason,
        },
      };
    case 'terminal_failure':
      return {
        status: 402,
        emitPaymentRequired: true,
        serveResult: false,
      };
    default:
      return {
        status: 503,
        emitPaymentRequired: false,
        serveResult: false,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
      };
  }
}
