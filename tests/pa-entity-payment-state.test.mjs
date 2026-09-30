import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVerifyResult,
  classifySettleResult,
  settleWithRecovery,
  shouldEmitFreshPaymentChallenge,
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
});

test('verify transport/5xx/429 are outages, not bad buyer payments', () => {
  assert.equal(
    classifyVerifyResult({ httpStatus: 503, body: {} }).kind,
    'unavailable',
  );
  assert.equal(
    classifyVerifyResult({ httpStatus: 429, body: {} }).kind,
    'unavailable',
  );
  assert.equal(
    classifyVerifyResult({ httpStatus: 0, body: undefined, transportError: true }).kind,
    'unavailable',
  );
});

test('settlement success is terminal success regardless of HTTP status', () => {
  const result = classifySettleResult({
    httpStatus: 202,
    body: { success: true, transaction: '0xabc' },
  });
  assert.equal(result.kind, 'settled');
});

test('settlement_pending never emits a fresh payment challenge', () => {
  const result = classifySettleResult({
    httpStatus: 200,
    body: { success: false, errorReason: 'settlement_pending' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
});

test('duplicate_settlement is treated as unresolved/reconcile', () => {
  const result = classifySettleResult({
    httpStatus: 409,
    body: { success: false, errorReason: 'duplicate_settlement' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
});

test('settlement transport loss is ambiguous and never creates a new authorization', () => {
  const result = classifySettleResult({
    httpStatus: 0,
    body: undefined,
    transportError: true,
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
});

test('known terminal settlement failure may require a new payment', () => {
  const result = classifySettleResult({
    httpStatus: 400,
    body: { success: false, errorReason: 'invalid_exact_evm_payload' },
  });
  assert.equal(result.kind, 'terminal_failure');
  assert.equal(shouldEmitFreshPaymentChallenge(result), true);
});

test('unknown settlement shape fails safe as reconcile', () => {
  const result = classifySettleResult({
    httpStatus: 418,
    body: { hello: 'world' },
  });
  assert.equal(result.kind, 'reconcile');
  assert.equal(shouldEmitFreshPaymentChallenge(result), false);
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
});
