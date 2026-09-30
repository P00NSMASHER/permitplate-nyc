export const TRANSIENT_SETTLEMENT_REASONS = new Set([
  'settlement_pending',
  'duplicate_settlement',
]);

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
    } catch (error) {
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
