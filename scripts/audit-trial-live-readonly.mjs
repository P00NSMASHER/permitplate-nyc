#!/usr/bin/env node
// Bounded, read-only production smoke. No requests, messages, subscriptions or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const BASE='https://permitplate.retallyrecovery.com';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function read(route){
  const response=await fetch(BASE+route,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(15000),
    headers:{'user-agent':'PermitPlate-trial-readonly-audit/1.0'}});
  return {status:response.status,body:await response.text(),headers:response.headers};
}
async function main(){
  const expected=process.env.EXPECTED_PUBLIC_COMMIT;
  assert.match(expected||'',/^[0-9a-f]{40}$/);
  const routes=[['/trial','dist/trial.html'],['/trial-request.js','dist/trial-request.js'],
    ['/terms','dist/terms.html'],['/privacy','dist/privacy.html']];
  const results=[];
  for(const [route,file] of routes){
    const live=await read(route);
    assert.equal(live.status,200,route+' status is not OK');
    const local=fs.readFileSync(file,'utf8');
    assert.equal(digest(live.body),digest(local),route+' exact published bytes differ from tested source');
    results.push({route,status:live.status,sha256:digest(live.body)});
  }
  const trial=fs.readFileSync('dist/trial.html','utf8');
  assert(trial.includes('data-trial-request'));
  assert(trial.includes('Review and send email request'));
  assert(trial.includes('Nothing is submitted until you send it from your email app'));
  assert(!/<form[^>]*action=/i.test(trial));
  const build=await read('/build-info.json');
  assert.equal(build.status,200,'missing build identity');
  const metadata=JSON.parse(build.body);
  assert.equal(metadata.sourceCommit,expected,'published commit differs from expected main');
  const header=await read('/trial');
  const csp=header.headers.get('content-security-policy')||'';
  assert(csp.includes("form-action 'none'"),'live form network-submit not denied');
  assert(csp.includes("frame-ancestors 'none'"),'live framing not denied');
  assert.equal(header.headers.get('x-content-type-options'),'nosniff');
  for(const privatePath of ['/pipeline/free-trial.js','/state/nyc-free-trials.json']){
    const res=await read(privatePath);
    assert(!res.body.includes('TRIAL_COHORT_FULL'),'private backend source exposed');
    assert(!res.body.includes('registryFingerprint'),'private operational state exposed');
    results.push({route:privatePath,status:res.status,privateDataExposed:false});
  }
  console.log(JSON.stringify({status:'PASS',expectedSourceCommit:expected,
    verifiedBytes:routes.length,results,realCustomersCreated:0,realPayments:0,realMessagesSent:0}));
}
main().catch(error=>{console.error('LIVE_READONLY_TRIAL_BLOCKED: '+error.message);process.exitCode=1;});
