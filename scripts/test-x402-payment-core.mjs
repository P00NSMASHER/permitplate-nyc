import {
  X402_NETWORK,
  X402_USDC,
  X402_PAY_TO,
  paymentRequirements,
  encodeX402Header,
  decodePaymentHeader,
  buildChallenge,
  successReceiptHeaders,
  temporaryPaymentFailure,
} from '../recovery/x402-payment-core.mjs';

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const terms = paymentRequirements('20000');
expect(terms.scheme === 'exact', 'scheme must be exact');
expect(terms.network === 'eip155:8453', 'network mismatch');
expect(terms.asset === X402_USDC, 'USDC mismatch');
expect(terms.payTo === X402_PAY_TO, 'payTo mismatch');
expect(terms.amount === '20000', 'amount mismatch');
expect(terms.extra?.name === 'USD Coin', 'EIP-712 name mismatch');
expect(terms.extra?.version === '2', 'EIP-712 version mismatch');

const challenge = buildChallenge({
  origin: 'https://pa-entity-x402.floot.app',
  path: '/_api/vendor-intake-gate',
  amount: '20000',
  price: '$0.020',
  description: 'Test vendor-intake payment challenge.',
  serviceName: 'Pennsylvania Vendor Intake Gate',
  tags: ['vendor-intake'],
});

expect(challenge.status === 402, 'challenge status must be 402');
expect(challenge.body.x402Version === 2, 'body x402Version mismatch');
expect(challenge.body.accepts?.[0]?.amount === '20000', 'body amount mismatch');
expect(challenge.headers['x402-price'] === '$0.020', 'price header mismatch');
expect(challenge.headers['x402-network'] === X402_NETWORK, 'network header mismatch');
expect(challenge.headers['x402-pay-to'] === X402_PAY_TO, 'payTo header mismatch');

const decodedChallenge = decodePaymentHeader(challenge.headers['PAYMENT-REQUIRED']);
expect(
  JSON.stringify(decodedChallenge) === JSON.stringify(challenge.document),
  'PAYMENT-REQUIRED must decode to exact payment document'
);

const payload = { x402Version: 2, test: true };
const encoded = encodeX402Header(payload);
expect(
  JSON.stringify(decodePaymentHeader(encoded)) === JSON.stringify(payload),
  'valid payload round-trip failed'
);

for (const [label, value, expected] of [
  ['empty', '', 'invalid_payment_header'],
  ['not-base64-json', '%%%%', 'invalid_payment_header'],
  ['wrong-version', encodeX402Header({ x402Version: 1 }), 'invalid_payment_payload'],
  ['array', encodeX402Header([{ x402Version: 2 }]), 'invalid_payment_payload'],
  ['oversize', 'a'.repeat(16385), 'payment_header_too_large'],
]) {
  let actual = null;
  try {
    decodePaymentHeader(value);
  } catch (error) {
    actual = error instanceof Error ? error.message : String(error);
  }
  expect(actual === expected, label + ' expected ' + expected + ' got ' + actual);
}

const receipt = { success: true, transaction: '0xtest' };
const receiptHeaders = successReceiptHeaders(receipt);
expect(receiptHeaders['x402-settled'] === 'true', 'settled header missing');
expect(
  JSON.stringify(decodePaymentHeader(receiptHeaders['PAYMENT-RESPONSE'])) ===
    JSON.stringify(receipt),
  'receipt header round-trip failed'
);

const temp = temporaryPaymentFailure('settlement_pending');
expect(temp.status === 503, 'temporary failure status must be 503');
expect(temp.body.retrySamePayment === true, 'temporary failure must request same-payment retry');
expect(temp.headers['Retry-After'] === '2', 'Retry-After mismatch');

expect(X402_NETWORK === 'eip155:8453', 'exported network mismatch');

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('PASS payment requirements');
  console.log('PASS 402 body/header parity');
  console.log('PASS payment header validation');
  console.log('PASS settlement receipt header');
  console.log('PASS unresolved-settlement same-payment retry response');
}
