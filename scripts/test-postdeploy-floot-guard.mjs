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
const split = workflow.split(/\n  register:\s*\n/);
assert.equal(split.length, 2, 'verification and directory publication must be different jobs');
const [verificationJob, registrationJob] = split;
assert.ok(
  verificationJob.includes("REGISTER_DIRECTORIES: '0'"),
  'unconditionally read-only verifier must never enable registration'
);
assert.equal(
  verificationJob.includes("REGISTER_DIRECTORIES: '1'"),
  false,
  'registration enablement must not exist in the read-only job'
);
assert.ok(
  registrationJob.includes("REGISTER_DIRECTORIES: '1'"),
  'only the separately gated registration job may pass the opt-in flag'
);
assert.ok(
  registrationJob.includes('needs: verify'),
  'registration may run only after the independent verification job succeeds'
);
assert.ok(
  registrationJob.includes("inputs.register_directories == true && github.ref == 'refs/heads/main'"),
  'explicit operator opt-in and exact-main branch selection are required'
);
assert.ok(
  registrationJob.includes('environment: permitplate-directory-approval'),
  'directory writes require the named protected approval environment'
);
assert.ok(
  registrationJob.includes('group: permitplate-directory-mutations') &&
    registrationJob.includes('cancel-in-progress: false'),
  'directory registrations must serialize without interrupting a prior write'
);
assert.ok(
  registrationJob.includes('git ls-remote --exit-code') &&
    verificationJob.includes('git ls-remote --exit-code'),
  'both jobs must reject stale or unapproved main source'
);
assert.ok(
  workflow.includes('POSTDEPLOY_RECEIPT_PATH: floot-postdeploy-receipt.json'),
  'workflow must persist the post-deploy receipt'
);

console.log('PASS post-deploy verifier is zero-spend and directory-refresh guarded');
console.log('PASS post-deploy workflow is manual-only with registration default=false');
