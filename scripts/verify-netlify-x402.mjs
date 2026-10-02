import { readFile } from 'node:fs/promises';

const PRODUCTION_ORIGIN = 'https://agent-data-tools-x402.netlify.app';
const BASE_URL = String(process.env.BASE_URL ?? PRODUCTION_ORIGIN).replace(/\/$/, '');
const NETWORK = 'eip155:8453';
const ASSET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';

const target = JSON.parse(
  await readFile(new URL('../recovery/x402-portfolio-target.json', import.meta.url), 'utf8')
);

function decodeHeader(value) {
  if (!value) throw new Error('missing PAYMENT-REQUIRED');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'x402-netlify-verifier/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { response, body, text };
}

const failures = [];
console.log('Netlify x402 zero-spend verification');
console.log('base=' + BASE_URL);
console.log('paymentSent=false');

for (const service of target.resources) {
  const url = BASE_URL + service.path + (service.sampleQuery ?? '');
  const item = { id: service.id, status: null, failures: [] };
  try {
    const { response, body } = await getJson(url);
    item.status = response.status;
    if (response.status !== 402) item.failures.push('HTTP ' + response.status + ' expected 402');

    const paymentRequired = response.headers.get('payment-required');
    let doc = null;
    try {
      doc = decodeHeader(paymentRequired);
    } catch (error) {
      item.failures.push(error instanceof Error ? error.message : String(error));
    }

    if (doc) {
      if (doc.x402Version !== 2) item.failures.push('x402Version mismatch');
      if (doc.resource?.url !== PRODUCTION_ORIGIN + service.path) {
        item.failures.push('resource URL mismatch: ' + String(doc.resource?.url));
      }
      const term = Array.isArray(doc.accepts)
        ? doc.accepts.find(
            (entry) =>
              String(entry?.amount) === String(service.amount) &&
              entry?.network === NETWORK &&
              String(entry?.asset ?? '').toLowerCase() === ASSET &&
              String(entry?.payTo ?? '').toLowerCase() === PAY_TO
          )
        : null;
      if (!term) item.failures.push('payment terms mismatch');
    }

    if (!body || body.x402Version !== 2) item.failures.push('402 body missing x402Version 2');
  } catch (error) {
    item.failures.push(error instanceof Error ? error.message : String(error));
  }

  const ok = item.failures.length === 0;
  console.log((ok ? 'PASS ' : 'FAIL ') + service.id + ' status=' + item.status);
  for (const failure of item.failures) console.log('  - ' + failure);
  if (!ok) failures.push(service.id + ': ' + item.failures.join('; '));
}

for (const fixture of target.fixedFixtures) {
  try {
    const { response, body } = await getJson(BASE_URL + fixture.path);
    const codes = Array.isArray(body?.reviewTriggers)
      ? body.reviewTriggers.map((entry) => entry?.code).filter(Boolean)
      : [];
    const decisionOk = response.status === 200 && body?.decision === fixture.expectedDecision;
    const triggerOk = fixture.expectedTrigger
      ? codes.includes(fixture.expectedTrigger)
      : codes.length === 0;
    const ok = decisionOk && triggerOk;
    console.log(
      (ok ? 'PASS ' : 'FAIL ') +
        fixture.id +
        ' status=' +
        response.status +
        ' decision=' +
        String(body?.decision) +
        ' triggers=' +
        (codes.join(',') || 'none')
    );
    if (!ok) failures.push('fixture failed: ' + fixture.id);
  } catch (error) {
    failures.push(
      'fixture error ' +
        fixture.id +
        ': ' +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

try {
  const { response, body } = await getJson(BASE_URL + '/.well-known/x402');
  const resources = Array.isArray(body?.resources) ? body.resources : [];
  const ok =
    response.status === 200 &&
    body?.x402Version === 2 &&
    resources.length === target.resources.length &&
    resources.every(
      (resource) =>
        typeof resource?.resource === 'string' &&
        resource.resource.startsWith(PRODUCTION_ORIGIN + '/_api/')
    );
  console.log((ok ? 'PASS' : 'FAIL') + ' discovery resources=' + resources.length);
  if (!ok) failures.push('discovery manifest mismatch');
} catch (error) {
  failures.push('discovery error: ' + (error instanceof Error ? error.message : String(error)));
}

try {
  const { response, body } = await getJson(BASE_URL + '/openapi.json');
  const count = body?.paths && typeof body.paths === 'object' ? Object.keys(body.paths).length : 0;
  const ok = response.status === 200 && count === target.resources.length;
  console.log((ok ? 'PASS' : 'FAIL') + ' openapi paths=' + count);
  if (!ok) failures.push('OpenAPI path count mismatch');
} catch (error) {
  failures.push('OpenAPI error: ' + (error instanceof Error ? error.message : String(error)));
}

try {
  const { response, body } = await getJson(BASE_URL + '/_api/health');
  const ok =
    response.status === 200 &&
    body?.ok === true &&
    body?.runtime === 'netlify' &&
    body?.appDeployDependency === false;
  console.log((ok ? 'PASS' : 'FAIL') + ' health');
  if (!ok) failures.push('health contract mismatch');
} catch (error) {
  failures.push('health error: ' + (error instanceof Error ? error.message : String(error)));
}

if (failures.length) {
  console.error('\nFAILURES');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log('\nPASS Netlify recovery origin: 8/8 paid challenges + 3/3 fixtures + discovery');
}
