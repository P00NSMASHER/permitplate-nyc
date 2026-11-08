'use strict';

// Offline regression for the exact observed Nov 8 provider-gate failure.
// This test never calls Stripe, loads a private ledger, or sends a request.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-launch-readiness');

assert.equal(typeof runner.writeFailedLaunchReceipt,'function');
assert.equal(typeof runner.failedLaunchReceipt,'function');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-failed-launch-'));
const secret='rk_live_SYNTHETIC_SHOULD_NOT_APPEAR';
try {
  const file=path.join(root,'launch-result.json');
  const providerError=new Error('EXTERNAL_LAUNCH_PAYMENT_LINK_INVALID');
  providerError.privateProviderResponse={key:secret,customer:'private@example.invalid'};
  const receipt=runner.writeFailedLaunchReceipt(file,providerError);
  const bytes=fs.readFileSync(file,'utf8');
  const saved=JSON.parse(bytes);
  assert.deepEqual(saved,receipt);
  assert.equal(saved.receiptKind,'FAIL_CLOSED_EVALUATION_ERROR');
  assert.equal(saved.launchState,'EVALUATION_FAILED');
  assert.equal(saved.failureCode,'EXTERNAL_LAUNCH_PAYMENT_LINK_INVALID');
  assert.equal(saved.internalReady,null,'No internal health claim when evaluation aborted');
  assert.equal(saved.firstCustomerOperationallyReady,false);
  assert.equal(saved.commerciallyProven,false);
  assert.equal(saved.externalEvidenceVerified,false);
  assert.equal(runner.shouldFailJob(saved),true,'Never convert failed provider evidence into a green launch');
  assert(!bytes.includes(secret));
  assert(!bytes.includes('private@example.invalid'));
  assert(!bytes.includes('stack'));
  assert(!bytes.includes('providerResponse'));

  for(const input of [
    new Error('private source URL and '+secret),
    new Error('EXTERNAL_LAUNCH_INVALID space'),
    {message:'EXTERNAL_LAUNCH_PAYMENT_LINK_INVALID\n'+secret},
    null,
    new Error('EXTERNAL_LAUNCH_'+secret),
  ]){
    const generic=runner.writeFailedLaunchReceipt(file,input);
    const text=fs.readFileSync(file,'utf8');
    assert.equal(generic.failureCode,'LAUNCH_READINESS_EVALUATION_FAILED');
    assert.equal(generic.commerciallyProven,false);
    assert.equal(runner.shouldFailJob(generic),true);
    assert(!text.includes(secret));
  }
  assert.equal(fs.readFileSync(file,'utf8').endsWith('\n'),true);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
console.log('Fail-closed launch receipt: reason allowlist, disk persistence, redaction and blocked status passed.');
