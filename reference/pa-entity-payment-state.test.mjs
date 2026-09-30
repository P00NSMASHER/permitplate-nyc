import assert from 'node:assert/strict';
import {
  MAX_PAYMENT_HEADER_CHARS,
  classifyVerifyResponse,
  classifySettleResponse,
  validatePaidRequestInput,
  settlementHttpResponse,
} from './pa-entity-payment-state.mjs';

assert.deepEqual(
  classifyVerifyResponse(200, { isValid: true }),
  { kind: 'valid' }
);

assert.deepEqual(
  classifyVerifyResponse(400, {
    isValid: false,
    invalidReason: 'invalid_payload',
    invalidMessage: 'x402Version: Invalid input',
  }),
  {
    kind: 'invalid_payment',
    reason: 'invalid_payload',
    message: 'x402Version: Invalid input',
  }
);

// Generic success:true must never be accepted as verification.
assert.equal(
  classifyVerifyResponse(200, { success: true }).kind,
  'facilitator_protocol_error'
);

assert.equal(
  classifySettleResponse(200, { success: true, transaction: '0xabc' }).kind,
  'settled'
);

for (const body of [
  { success: false, errorReason: 'settlement_pending' },
  { success: false, errorReason: 'duplicate_settlement' },
]) {
  const c = classifySettleResponse(409, body);
  assert.equal(c.kind, 'settlement_unresolved');
  assert.equal(c.retrySamePayment, true);
  const response = settlementHttpResponse(c);
  assert.equal(response.status, 503);
  assert.equal(response.body.retrySamePayment, true);
}

for (const status of [429, 500, 502, 503]) {
  const c = classifySettleResponse(status, null);
  assert.equal(c.kind, 'settlement_unresolved');
  assert.equal(c.retrySamePayment, true);
}

const terminal = classifySettleResponse(402, {
  success: false,
  errorReason: 'invalid_exact_evm_insufficient_balance',
});
assert.equal(terminal.kind, 'settlement_failed');
assert.equal(settlementHttpResponse(terminal).status, 402);

assert.equal(
  validatePaidRequestInput({ q: 'OpenAI', limit: '1', paymentHeader: '' }).kind,
  'payment_required'
);

assert.equal(
  validatePaidRequestInput({
    q: 'OpenAI',
    limit: '1',
    paymentHeader: 'A'.repeat(MAX_PAYMENT_HEADER_CHARS + 1),
  }).status,
  431
);

assert.equal(
  validatePaidRequestInput({ q: 'A', limit: '1', paymentHeader: 'e30=' }).status,
  400
);

assert.equal(
  validatePaidRequestInput({ q: '%_', limit: '1', paymentHeader: 'e30=' }).status,
  400
);

assert.equal(
  validatePaidRequestInput({ q: 'OpenAI', limit: '10garbage', paymentHeader: 'e30=' }).status,
  400
);

assert.equal(
  validatePaidRequestInput({ q: 'OpenAI', limit: '26', paymentHeader: 'e30=' }).status,
  400
);

const valid = validatePaidRequestInput({
  q: ' OpenAI ',
  limit: '5',
  paymentHeader: 'e30=',
});
assert.equal(valid.ok, true);
assert.equal(valid.query, 'OpenAI');
assert.equal(valid.limit, 5);

console.log('PA_ENTITY_PAYMENT_STATE_TESTS=PASS');
