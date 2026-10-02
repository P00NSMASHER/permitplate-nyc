import { executePaidOperation } from '../recovery/x402-paid-operation.mjs';
import { encodeX402Header } from '../recovery/x402-payment-core.mjs';

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const options = {
  origin: 'https://pa-entity-x402.floot.app',
  path: '/_api/test',
  amount: '5000',
  price: '$0.005',
  description: 'Test paid operation.',
  serviceName: 'Test x402 service',
  tags: ['test'],
};

const payloadHeader = encodeX402Header({ x402Version: 2, test: true });

async function caseRun(overrides = {}) {
  const calls = { validate: 0, verify: 0, execute: 0, settle: 0 };
  const response = await executePaidOperation({
    ...options,
    signature: payloadHeader,
    validateInput: async () => {
      calls.validate += 1;
      if (overrides.validationError) throw new Error(overrides.validationError);
      return { q: 'ok' };
    },
    verify: async () => {
      calls.verify += 1;
      return overrides.verifyResult ?? { kind: 'valid', body: { isValid: true } };
    },
    execute: async () => {
      calls.execute += 1;
      if (overrides.executeError) throw new Error(overrides.executeError);
      return { value: 42 };
    },
    settle: async () => {
      calls.settle += 1;
      return (
        overrides.settleResult ?? {
          kind: 'settled',
          receipt: { success: true, transaction: '0xtest' },
        }
      );
    },
    ...overrides.operationOverrides,
  });
  return { response, calls };
}

{
  const calls = { validate: 0, verify: 0, execute: 0, settle: 0 };
  const response = await executePaidOperation({
    ...options,
    signature: null,
    validateInput: async () => {
      calls.validate += 1;
      return {};
    },
    verify: async () => {
      calls.verify += 1;
      return { kind: 'valid' };
    },
    execute: async () => {
      calls.execute += 1;
      return {};
    },
    settle: async () => {
      calls.settle += 1;
      return { kind: 'settled', receipt: {} };
    },
  });
  expect(response.status === 402, 'missing signature must challenge');
  expect(response.body.error === 'payment_required', 'missing signature reason');
  expect(calls.validate === 0, 'missing signature must not validate input');
  expect(calls.verify === 0, 'missing signature must not verify');
  expect(calls.execute === 0, 'missing signature must not execute');
  expect(calls.settle === 0, 'missing signature must not settle');
}

{
  const { response, calls } = await caseRun({
    operationOverrides: { signature: 'not-json' },
  });
  expect(response.status === 402, 'malformed signature must challenge');
  expect(response.body.error === 'invalid_payment_header', 'malformed reason');
  expect(calls.validate === 0, 'malformed signature must not validate');
  expect(calls.verify === 0, 'malformed signature must not verify');
}

{
  const { response, calls } = await caseRun({ validationError: 'invalid_query' });
  expect(response.status === 400, 'invalid input must return 400');
  expect(response.body.error === 'invalid_query', 'invalid input reason');
  expect(calls.verify === 0, 'invalid input must not verify');
  expect(calls.execute === 0, 'invalid input must not execute');
  expect(calls.settle === 0, 'invalid input must not settle');
}

{
  const { response, calls } = await caseRun({
    verifyResult: { kind: 'invalid', reason: 'insufficient_balance' },
  });
  expect(response.status === 402, 'invalid payment must challenge');
  expect(response.body.error === 'insufficient_balance', 'invalid payment reason');
  expect(calls.execute === 0, 'invalid payment must not execute');
  expect(calls.settle === 0, 'invalid payment must not settle');
}

{
  const { response, calls } = await caseRun({
    verifyResult: { kind: 'unavailable', reason: 'payment_verifier_unavailable' },
  });
  expect(response.status === 503, 'verifier outage must return 503');
  expect(response.body.retrySamePayment === true, 'verifier outage same-payment retry');
  expect(calls.execute === 0, 'verifier outage must not execute');
  expect(calls.settle === 0, 'verifier outage must not settle');
}

{
  const { response, calls } = await caseRun({ executeError: 'source_down' });
  expect(response.status === 502, 'upstream failure must return 502');
  expect(response.body.paymentSettled === false, 'upstream failure must mark unsettled');
  expect(calls.verify === 1, 'upstream failure should have verified once');
  expect(calls.settle === 0, 'upstream failure must not settle');
}

{
  const { response, calls } = await caseRun({
    settleResult: { kind: 'unresolved', reason: 'settlement_pending' },
  });
  expect(response.status === 503, 'unresolved settlement must return 503');
  expect(response.body.error === 'settlement_pending', 'unresolved settlement reason');
  expect(response.body.retrySamePayment === true, 'unresolved settlement same-payment retry');
  expect(calls.execute === 1, 'unresolved settlement executes exactly once');
  expect(calls.settle === 1, 'unresolved settlement calls settle once at adapter boundary');
}

{
  const { response } = await caseRun({
    settleResult: { kind: 'terminal', reason: 'payment_settlement_failed' },
  });
  expect(response.status === 402, 'terminal settlement failure must challenge');
  expect(
    response.body.error === 'payment_settlement_failed',
    'terminal settlement failure reason'
  );
}

{
  const { response, calls } = await caseRun();
  expect(response.status === 200, 'successful operation must return 200');
  expect(response.body.value === 42, 'successful result payload missing');
  expect(response.body.paid === true, 'successful result must be paid');
  expect(response.body.price === '$0.005', 'successful result price mismatch');
  expect(response.headers['x402-settled'] === 'true', 'settled header missing');
  expect(Boolean(response.headers['PAYMENT-RESPONSE']), 'payment response missing');
  expect(calls.validate === 1, 'success validate count');
  expect(calls.verify === 1, 'success verify count');
  expect(calls.execute === 1, 'success execute count');
  expect(calls.settle === 1, 'success settle count');
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('PASS unpaid challenge short-circuit');
  console.log('PASS malformed payment rejection');
  console.log('PASS pre-verification input validation');
  console.log('PASS invalid/unavailable verifier handling');
  console.log('PASS no settlement after upstream failure');
  console.log('PASS same-payment unresolved settlement handling');
  console.log('PASS terminal settlement challenge');
  console.log('PASS successful paid response + receipt');
}
