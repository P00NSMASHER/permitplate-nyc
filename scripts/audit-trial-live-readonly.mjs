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
  const staged=process.env.TRIAL_STAGED_PR==='true';
  const routes=[['/trial','dist/trial.html'],['/trial-request.js','dist/trial-request.js'],
    ['/terms','dist/terms.html'],['/privacy','dist/privacy.html']];
  const results=[];
  for(const [route,file] of routes){
    const live=await read(route);
    assert.equal(live.status,200,route+' status is not OK');
    const local=fs.readFileSync(file,'utf8');
    // Cloudflare Email Obfuscation removes only the two explicit email_off
    // sentinel comments at the edge, without altering enclosed content.
    // Normalize precisely those markers; any other byte drift remains red.
    const expectedHtml=file.endsWith('.html')?
      local.replaceAll('<!--email_off-->','').replaceAll('<!--/email_off-->',''):local;
    if(!staged&&digest(live.body)!==digest(expectedHtml)){
      const length=Math.min(live.body.length,expectedHtml.length);
      let i=0;while(i<length&&live.body[i]===expectedHtml[i])i++;
      const meta=await read('/build-info.json');
      let source=null,expectedFile=null;
      try{const parsed=JSON.parse(meta.body);source=parsed.sourceCommit;
        expectedFile=parsed.files?.find(x=>x.path===file);}catch{}
      console.error(JSON.stringify({route,liveLength:live.body.length,expectedLength:expectedHtml.length,
        divergenceIndex:i,liveSnippet:live.body.slice(Math.max(0,i-120),i+200),
        expectedSnippet:expectedHtml.slice(Math.max(0,i-120),i+200),
        liveBuildSha:source,liveManifestFile:expectedFile,
        expectedHash:digest(expectedHtml),liveHash:digest(live.body)},null,2));
    }
    if(!staged)assert.equal(digest(live.body),digest(expectedHtml),route+' edge-visible bytes differ beyond known email_off marker removal');
    results.push({route,status:live.status,sha256:digest(live.body),exactCandidateBytesChecked:!staged});
  }
  const trial=fs.readFileSync('dist/trial.html','utf8');
  assert(trial.includes('data-trial-request'));
  assert(trial.includes('Review and send email request'));
  assert(trial.includes('Online requests are securely stored for manual review'));
  assert(trial.includes('data-trial-success'));
  assert(trial.includes('name="email" type="email"'));
  assert(trial.includes('No card, no automatic upgrade'));
  assert(trial.includes('Send my free-trial request'));
  assert(trial.includes('Work email for our reply'));
  assert(trial.includes('data-trial-copy'));
  assert(!/<form[^>]*action=/i.test(trial));
  const build=await read('/build-info.json');
  assert.equal(build.status,200,'missing build identity');
  const metadata=JSON.parse(build.body);
  assert.equal(metadata.sourceCommit,expected,'published commit differs from expected main');
  // Changed PR source is not yet deployed. Staging proves old production healthy;
  // only post-merge main is held to exact deployed candidate asset bytes.
  const header=await read('/trial');
  const csp=header.headers.get('content-security-policy')||'';
  assert(csp.includes("form-action 'none'"),'live form network-submit not denied');
  assert(csp.includes("frame-ancestors 'none'"),'live framing not denied');
  assert.equal(header.headers.get('x-content-type-options'),'nosniff');
  for(const privatePath of ['/pipeline/free-trial.js','/state/nyc-free-trials.json','/functions/api/trial-request.js']){
    const res=await read(privatePath);
    assert(!res.body.includes('TRIAL_COHORT_FULL'),'private backend source exposed');
    assert(!res.body.includes('registryFingerprint'),'private operational state exposed');
    results.push({route:privatePath,status:res.status,privateDataExposed:false});
  }
  if(!staged){
    const heartbeat=await read('/api/trial-request');
    assert.equal(heartbeat.status,200,'production intake binding or enable gate is not healthy');
    assert.equal(JSON.parse(heartbeat.body).status,'REQUEST_INTAKE_READY');
    results.push({route:'/api/trial-request',status:heartbeat.status,privateContentExposed:false});
  }
  console.log(JSON.stringify({status:staged?'STAGED_PR_BASELINE_VERIFIED':'PASS',expectedSourceCommit:expected,
    verifiedBytes:staged?0:routes.length,results,realCustomersCreated:0,realPayments:0,realMessagesSent:0}));
}
main().catch(error=>{console.error('LIVE_READONLY_TRIAL_BLOCKED: '+error.message);process.exitCode=1;});
