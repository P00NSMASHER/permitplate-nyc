'use strict';
const assert=require('node:assert/strict');
const blind=require('./nyc-real-world-acceptance');
const verifier=require('./nyc-dob-filing-readback');
const base={
  sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:B01428764-P1',
  officialUrl:'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B01428764-P1',
  borough:'Brooklyn',address:'100 TEST STREET',
  sourceEffectiveAt:'2026-10-16T04:00:00.000Z',
  sourceStatus:'Approved',
  sourceExcerpt:'INSTALLATION OF NEW KITCHEN EXHAUST IN NEW RESTAURANT SPACE.',
  constructionScope:{scopeClass:'SPECIFIC_COMPONENT_AND_ACTION'},
  needsIdentityReview:false,possibleRelatedCamis:[],
  customerDeliveryAllowed:false
};
function report(items=[base]){
  return {passed:true,inputSource:'LIVE_OFFICIAL_PUBLIC_SOCRATA_GET_ONLY',
    observedAt:'2026-10-21T07:00:00.000Z',
    unlinkedEarlySignals:{
      blindDobConstructionReviewKit:blind.dobConstructionReviewKit({
        status:'REVIEW_ONLY',omittedByLimit:0,items
      })
    }};
}
assert.equal(verifier.officialTarget({
  sourceRecordId:base.sourceRecordId,officialUrl:base.officialUrl
}),base.officialUrl);
assert.equal(verifier.officialTarget({
  sourceRecordId:base.sourceRecordId,
  officialUrl:'https://evil.invalid/resource/w9ak-ipjd.json?job_filing_number=B01428764-P1'
}),null);
assert.equal(verifier.officialTarget({
  sourceRecordId:base.sourceRecordId,
  officialUrl:base.officialUrl+'&$limit=999'
}),null);
assert.equal(verifier.excerpt('a'.repeat(179)+' '),'a'.repeat(179));
async function main(){
  let calls=0;
  const provider=async(url,opts)=>{
    calls++;
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert(new URL(url).hostname==='data.cityofnewyork.us');
    return {ok:true,json:async()=>[{
      job_filing_number:'B01428764-P1',
      filing_date:'2026-10-16T00:00:00.000',
      filing_status:'Approved',
      job_description:base.sourceExcerpt
    }]};
  };
  const out=await verifier.verify(report(),provider,'2026-10-21T07:20:00.000Z');
  assert.equal(out.passed,true);
  assert.equal(out.confirmedCases,1);
  assert.equal(out.matchedFilingDate,1);
  assert.equal(out.matchedDescriptionExcerpt,1);
  assert.equal(out.matchedFilingStatus,1);
  assert.equal(out.secondApiGetCalls,1);
  assert.equal(calls,1);
  assert.equal(out.customerMessagesSent,0);
  assert.equal(out.independentHumanLabels,0);
  assert.equal(out.buyerNeedVerified,false);
  assert.equal(out.privateStateRead,false);
  const changed=await verifier.verify(report(),async()=>({
    ok:true,json:async()=>[{
      job_filing_number:'B01428764-P1',
      filing_date:'2026-10-16T00:00:00.000',
      filing_status:'Plan Examiner Review',
      job_description:base.sourceExcerpt
    }]
  }));
  assert.equal(changed.passed,false);
  assert(changed.issues[0].reason.includes('FILING_STATUS_CHANGED'));
  const invalid=report();
  invalid.unlinkedEarlySignals.blindDobConstructionReviewKit.cases[0].officialUrl=
    'https://not-the-publisher.example/file';
  const noProvider=await verifier.verify(invalid,async()=>{throw Error('NO_NETWORK_ALLOWED')});
  assert.equal(noProvider.passed,false);
  assert.equal(noProvider.secondApiGetCalls,0);
  assert.equal(noProvider.issues[0].reason,'PUBLIC_DOB_TARGET_INVALID');
  const partial=report();
  partial.unlinkedEarlySignals.blindDobConstructionReviewKit.status='PARTIAL_REVIEW_KIT';
  const refused=await verifier.verify(partial,async()=>{throw Error('NO_NETWORK_ALLOWED')});
  assert.equal(refused.passed,false);
  assert.equal(refused.secondApiGetCalls,0);
  assert.equal(refused.issues[0].reason,'REVIEW_KIT_INCOMPLETE_OR_UNSAFE');
  console.log('NYC 35-file official readback: strict publisher, exact identity, time/status/text and NO SEND controls passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
