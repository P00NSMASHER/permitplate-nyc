import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PAYMENT_HEADER_CHARS,
  MAX_QUERY_CHARS,
  classifyVerifyResult,
  classifySettleResult,
  settleWithRecovery,
  shouldEmitFreshPaymentChallenge,
  validatePaidRequestInput,
  paymentHttpPolicy,
} from '../scripts/pa-entity-payment-state.mjs';

test('verify accepts only explicit isValid=true', () => {
  assert.equal(
    classifyVerifyResult({ httpStatus: 200, body: { isValid: true } }).kind,
    'valid',
  );
  assert.equal(
    classifyVerifyResult({ httpStatus: 200, body: { success: true } }).kind,
    'unavailable',
  );
});

test('verify parses structured invalid payment even on HTTP 400', () => {
  const result = classifyVerifyResult({
    httpStatus: 400,
    body: {
      isValid: false,
      invalidReason: 'invalid_payload',
      invalidMessage: 'x402Version: Invalid input',
    },
  });
  assert.equal(result.kind, 'invalid');
  assert.equal(result.reason, 'invalid_payload');
  assert.equal(shouldEmitFreshPaymentChallenge(result), true);
  assert.equal(paymentHttpPolicy(result).status, 402);
});

test('verify transport/5xx/429 are outages, not bad buyer payments', () => {
  for (const result of [
    classifyVerifyResult({ httpStatus: 503, body: {} }),
    classifyVerifyResult({ httpStatus: 429, body: {} }),
    classifyVerifyResult({ httpStatus: 0, body: undefined, transportError: true }),
  ]) {
    assert.equal(result.kind, 'unavailable');
    const policy = paymentHttpPolicy(result);
    assert.equal(policy.status, 503);
    assert.equal(policy.emitPaymentRequired, false);
  }
});

test('settlement success is terminal success regardless of HTTP status', () => {
  const result = classifySettleResult({
    httpStatus: 202,
    body: { success: true, transaction: '0xabc' },
  });
  assert.equal(result.kind, 'settled');
  assert.equal(paymentHttpPolicy(result).serveResult, true);
});

test('settlement_pending never emits a fresh payment challenge', () => {
  const result = classifySettleResult({
    httpStatus: 200,
    body: { success: false, errorReason: 'settlement_pending' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
  const policy = paymentHttpPolicy(result);
  assert.equal(policy.status, 503);
  assert.equal(policy.emitPaymentRequired, false);
  assert.equal(policy.body.retrySamePayment, true);
});

test('duplicate_settlement is treated as unresolved/reconcile', () => {
  const result = classifySettleResult({
    httpStatus: 409,
    body: { success: false, errorReason: 'duplicate_settlement' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
  assert.equal(paymentHttpPolicy(result).emitPaymentRequired, false);
});

test('settlement transport loss is ambiguous and never creates a new authorization', () => {
  const result = classifySettleResult({
    httpStatus: 0,
    body: undefined,
    transportError: true,
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
  assert.equal(paymentHttpPolicy(result).status, 503);
});

test('known terminal settlement failure may require a new payment', () => {
  const result = classifySettleResult({
    httpStatus: 400,
    body: { success: false, errorReason: 'invalid_exact_evm_payload' },
  });
  assert.equal(result.kind, 'terminal_failure');
  assert.equal(shouldEmitFreshPaymentChallenge(result), true);
  assert.equal(paymentHttpPolicy(result).status, 402);
});

test('unknown settlement shape fails safe as reconcile', () => {
  const result = classifySettleResult({
    httpStatus: 418,
    body: { hello: 'world' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
  assert.equal(paymentHttpPolicy(result).emitPaymentRequired, false);
});

test('recovery retries identical unresolved settlement then accepts success', async () => {
  let calls = 0;
  const result = await settleWithRecovery(
    async () => {
      calls += 1;
      if (calls === 1) {
        return {
          httpStatus: 200,
          body: { success: false, errorReason: 'settlement_pending' },
        };
      }
      return {
        httpStatus: 200,
        body: { success: true, transaction: '0xabc' },
      };
    },
    { sleep: async () => {}, maxAttempts: 3 },
  );

  assert.equal(calls, 2);
  assert.equal(result.kind, 'settled');
  assert.equal(result.attempts, 2);
});

test('recovery stops after bounded attempts and preserves same-payment retry state', async () => {
  let calls = 0;
  const result = await settleWithRecovery(
    async () => {
      calls += 1;
      return {
        httpStatus: 200,
        body: { success: false, errorReason: 'settlement_pending' },
      };
    },
    { sleep: async () => {}, maxAttempts: 3 },
  );

  assert.equal(calls, 3);
  assert.equal(result.kind, 'reconcile');
  assert.equal(result.reason, 'settlement_pending');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
  assert.equal(paymentHttpPolicy(result).emitPaymentRequired, false);
});

test('no payment header preserves the public 402-first discovery path', () => {
  const result = validatePaidRequestInput({
    q: '',
    limit: undefined,
    paymentHeader: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'payment_required');
});

test('oversized payment headers are rejected before facilitator work', () => {
  const result = validatePaidRequestInput({
    q: 'OpenAI',
    limit: '1',
    paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_CHARS + 1),
  });
  assert.equal(result.status, 431);
});

test('invalid paid query is rejected before facilitator work', () => {
  for (const q of ['A', '%_', ' '.repeat(4), 'A'.repeat(MAX_QUERY_CHARS + 1)]) {
    const result = validatePaidRequestInput({
      q,
      limit: '1',
      paymentHeader: 'e30=',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
});

test('invalid limit is rejected rather than silently coerced', () => {
  for (const limit of ['0', '26', '10garbage', '-1', '1.5']) {
    const result = validatePaidRequestInput({
      q: 'OpenAI',
      limit,
      paymentHeader: 'e30=',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
});

test('valid paid request input is normalized deterministically', () => {
  const result = validatePaidRequestInput({
    q: '  OpenAI  ',
    limit: '5',
    paymentHeader: 'e30=',
  });
  assert.equal(result.ok, true);
  assert.equal(result.query, 'OpenAI');
  assert.equal(result.normalizedForSearch, 'OpenAI');
  assert.equal(result.limit, 5);
});
