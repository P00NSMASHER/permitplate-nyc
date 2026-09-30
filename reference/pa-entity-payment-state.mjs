export const MAX_PAYMENT_HEADER_CHARS = 16_384;

export function classifyVerifyResponse(httpStatus, body) {
  if (body && body.isValid === true) {
    return { kind: 'valid' };
  }

  if (body && body.isValid === false) {
    return {
      kind: 'invalid_payment',
      reason: String(body.invalidReason ?? 'payment_verification_failed'),
      message: body.invalidMessage ? String(body.invalidMessage) : undefined,
    };
  }

  // Do not treat generic success:true as payment verification.
  // PayAI's verification contract is specifically isValid:boolean.
  if (httpStatus === 429 || httpStatus >= 500) {
    return { kind: 'facilitator_unavailable', retryable: true };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: 'facilitator_unavailable', retryable: true };
  }

  return { kind: 'facilitator_protocol_error', retryable: true };
}

export function classifySettleResponse(httpStatus, body) {
  if (body && body.success === true) {
    return {
      kind: 'settled',
      transaction: body.transaction ?? null,
      network: body.network ?? null,
      payer: body.payer ?? null,
    };
  }

  const reason = body?.errorReason ? String(body.errorReason) : '';

  if (
    reason === 'settlement_pending' ||
    reason === 'duplicate_settlement' ||
    httpStatus === 429 ||
    httpStatus >= 500
  ) {
    return {
      kind: 'settlement_unresolved',
      reason: reason || `http_${httpStatus}`,
      retryable: true,
      retrySamePayment: true,
      transaction: body?.transaction ?? null,
    };
  }

  if (body && body.success === false) {
    return {
      kind: 'settlement_failed',
      reason: reason || 'payment_settlement_failed',
      message: body.errorMessage ? String(body.errorMessage) : undefined,
      retryable: false,
      retrySamePayment: false,
    };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: 'settlement_unresolved',
      reason: `http_${httpStatus}`,
      retryable: true,
      retrySamePayment: true,
      transaction: body?.transaction ?? null,
    };
  }

  return {
    kind: 'facilitator_protocol_error',
    retryable: true,
    retrySamePayment: true,
  };
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

  if (query.length > 160) {
    return {
      ok: false,
      kind: 'invalid_query',
      status: 400,
      reason: 'q must contain at most 160 characters',
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

export function settlementHttpResponse(classification) {
  switch (classification.kind) {
    case 'settled':
      return { status: 200, serveResult: true };
    case 'settlement_unresolved':
      return {
        status: 503,
        serveResult: false,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
        body: {
          error: 'settlement_unresolved',
          reason: classification.reason,
          retrySamePayment: true,
          transaction: classification.transaction ?? null,
        },
      };
    case 'settlement_failed':
      return {
        status: 402,
        serveResult: false,
        body: {
          error: classification.reason,
          retrySamePayment: false,
        },
      };
    default:
      return {
        status: 503,
        serveResult: false,
        headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' },
        body: {
          error: 'payment_facilitator_protocol_error',
          retrySamePayment: true,
        },
      };
  }
}
