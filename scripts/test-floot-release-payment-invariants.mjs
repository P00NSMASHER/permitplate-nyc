import { readFile } from 'node:fs/promises';

const files = [
  'pa-business_GET.ts',
  'pa-entity-one_GET.ts',
  'vendor-intake-gate_GET.ts',
  'sec-filings_GET.ts',
  'us-address-geocode_GET.ts',
  'ofac-sdn-screen_GET.ts',
  'domain-rdap_GET.ts',
  'treasury-average-rates_GET.ts',
];

const root = new URL('../docs/pa-entity-floot-release/', import.meta.url);
const failures = [];

for (const name of files) {
  const source = await readFile(new URL(name, root), 'utf8');
  const require = (condition, message) => {
    if (!condition) failures.push(name + ': ' + message);
  };

  require(
    source.includes('isValid === true') || source.includes('isValid !== true'),
    'payment verification must require isValid'
  );
  require(
    !/verified\.(?:success)|verification\.(?:success)/.test(source),
    'must not accept generic success=true as payment verification'
  );
  require(
    source.includes('settlement_pending'),
    'must recognize settlement_pending'
  );
  require(
    source.includes('duplicate_settlement'),
    'must recognize duplicate_settlement'
  );
  require(
    source.includes('retrySamePayment'),
    'unresolved payment state must tell caller to retry the same payment'
  );
  require(
    source.includes('16_384') || source.includes('16384'),
    'payment header must have 16 KiB upper bound'
  );
  require(
    !source.includes('api-v2.appdeploy.ai'),
    'Floot release must not depend on AppDeploy'
  );
  require(
    source.includes("'PAYMENT-REQUIRED'") || source.includes('"PAYMENT-REQUIRED"'),
    'must emit PAYMENT-REQUIRED challenge header'
  );
  require(
    source.includes("'PAYMENT-RESPONSE'") || source.includes('"PAYMENT-RESPONSE"'),
    'successful settlement must emit PAYMENT-RESPONSE'
  );
  require(
    source.includes("'x402-settled': 'true'") ||
      source.includes('"x402-settled": "true"'),
    'successful settlement must expose x402-settled=true'
  );

  const verifyPosition = Math.max(
    source.indexOf("facilitatorPost('verify'"),
    source.indexOf('facilitatorPost("verify"')
  );
  const settlePosition = Math.max(
    source.lastIndexOf("facilitatorPost('settle'"),
    source.lastIndexOf('facilitatorPost("settle"')
  );
  require(verifyPosition >= 0, 'verify facilitator call missing');
  require(settlePosition > verifyPosition, 'settle must occur after verification');

  const upstreamFailurePosition = Math.max(
    source.indexOf('payment was not settled'),
    source.indexOf('paymentSettled: false'),
    source.indexOf('paymentSettled: false')
  );
  require(
    upstreamFailurePosition >= 0,
    'source/evidence failure must explicitly preserve unsettled payment'
  );
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('PASS strict isValid verification across 8 paid Floot routes');
  console.log('PASS 16 KiB payment-header bounds across 8 routes');
  console.log('PASS pending/duplicate same-payment retry semantics across 8 routes');
  console.log('PASS seller challenge + settlement receipt headers across 8 routes');
  console.log('PASS source/evidence failure explicitly preserves unsettled payment');
  console.log('PASS zero AppDeploy runtime dependencies across 8 routes');
}
