#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(
  new URL('./postdeploy-floot-x402.mjs', import.meta.url),
  'utf8'
);
const workflow = await readFile(
  new URL('../.github/workflows/postdeploy-floot-x402.yml', import.meta.url),
  'utf8'
);

assert.ok(
  script.includes("const REGISTER = process.env.REGISTER_DIRECTORIES === '1';"),
  'directory registration must default off'
);
assert.ok(
  script.includes('if (publicGreen && REGISTER)'),
  'directory registration must require publicGreen and explicit opt-in'
);
assert.ok(
  script.includes("else if (!publicGreen)"),
  'failed public verification must have an explicit skip path'
);
assert.ok(
  script.includes('paymentSent: false'),
  'receipt must state that no payment was sent'
);
assert.equal(
  /['"]payment-signature['"]\s*:/.test(script),
  false,
  'post-deploy verifier must never send PAYMENT-SIGNATURE'
);
assert.equal(
  /['"]x-payment['"]\s*:/.test(script),
  false,
  'post-deploy verifier must never send X-PAYMENT'
);
assert.ok(
  script.includes("'https://agent402.tools/api/index/register'"),
  'Agent402 registration target missing'
);
assert.ok(
  script.includes("'https://market402.com/submit'"),
  'Market402 submit target missing'
);
assert.ok(
  script.includes("'https://402index.io/api/v1/register'"),
  '402 Index registration target missing'
);

assert.ok(
  /^\s*workflow_dispatch:\s*$/m.test(workflow),
  'workflow must remain manual'
);
assert.equal(
  /^\s*(schedule|push|pull_request):\s*$/m.test(workflow),
  false,
  'post-deploy workflow must not gain automatic triggers'
);
assert.ok(
  workflow.includes('register_directories:'),
  'workflow must expose directory-registration opt-in'
);
assert.ok(
  workflow.includes('default: false'),
  'directory-registration opt-in must default false'
);
assert.ok(
  workflow.includes("REGISTER_DIRECTORIES: ${{ inputs.register_directories && '1' || '0' }}"),
  'workflow must explicitly pass the opt-in flag'
);
assert.ok(
  workflow.includes('POSTDEPLOY_RECEIPT_PATH: floot-postdeploy-receipt.json'),
  'workflow must persist the post-deploy receipt'
);

console.log('PASS post-deploy verifier is zero-spend and directory-refresh guarded');
console.log('PASS post-deploy workflow is manual-only with registration default=false');
