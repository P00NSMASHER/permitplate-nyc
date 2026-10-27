'use strict';

const assert=require('assert');
const curated=require('./founder-curated-offer');
const canary=require('./run-founder-curated-canary');

function validInput(){
  return {
    subscriptionId:'sub_live_example',
    recipientEmail:'buyer@example.com',
    preparedAt:'2026-09-23T12:00:00Z',
    reviewer:'Jay Perkins',
    ownerReviewed:true,
    preferences:{category:'equipment',territory:'Brooklyn',starter:'yes'},
    signals:[{
      signalKey:'curated:example:1',
      businessName:'Example Kitchen',
      address:'10 Example Street',
      borough:'Brooklyn',
      stage:'Buildout record changed',
      whyItMatters:'The current record gives equipment vendors a relevant account to research.',
      sourceUpdatedAt:'2026-09-22T15:00:00Z',
      reviewedAt:'2026-09-23T12:00:00Z',
      sourceUrls:['https://data.cityofnewyork.us/resource/example.json?id=1']
    }]
  };
}

{
  const out=curated.buildCuratedBrief(validInput());
  assert.equal(out.status,'READY');
  assert.equal(out.launchMode,'FOUNDER_CURATED_NO_SCORE_V1');
  assert.equal(out.signalCount,1);
  assert(out.csv.includes('Why It Matters'));
  assert(!/(?:score|rank|probability|purchase intent)/i.test(curated.CSV_HEADERS.join('|')));
  assert.match(out.artifactFingerprint,/^[0-9a-f]{64}$/);
}

{
// Real DOHMH 1900 inspection placeholders are uninspected applicants,
// not independently dated new permit filings. No raw stage may reach a
// paid founder-curated HTML/CSV research brief as "JUST FILED".
  const input=validInput();
  input.signals[0].stage='JUST FILED';
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'READY');
  assert.equal(out.signals[0].stage,'APPLICANT — NOT YET INSPECTED');
  assert(out.csv.includes('APPLICANT — NOT YET INSPECTED'));
  assert(out.html.includes('APPLICANT — NOT YET INSPECTED'));
  assert(!out.csv.includes('JUST FILED'));
  assert(!out.html.includes('JUST FILED'));
}

{
  const input=validInput();
  input.ownerReviewed=false;
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('OWNER_REVIEW_REQUIRED'));
}

{
  for(const ending of ['', '.', '?', '!']){
    const input=validInput();
    const rationale='Verify the current equipment need before treating this as a sales opportunity'+ending;
    Object.assign(input.signals[0],{categoryEvidenceBasis:'APPLICANT_CONTEXT_ONLY',
      categoryFitRationale:rationale,
      categoryOfficialUrl:input.signals[0].sourceUrls[0]});
    const out=curated.buildCuratedBrief(input);
    assert.equal(out.status,'READY');
    assert(out.html.includes('<strong>Founder assessment:</strong> '+rationale+(ending?'':'.')+' <a '));
    assert.equal(out.signals[0].categoryFitRationale,rationale,'rendering must not rewrite the reviewed claim');
    assert(!out.html.includes('opportunity..'));
  }
}

{
  const input=validInput();
  input.signals[0].score=100;
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'REVIEW');
  assert(out.failures.some((failure)=>failure.startsWith('FORBIDDEN_FIELD:signals[0].score')));
}

{
  const input=validInput();
  input.signals[0].sourceUrls=['https://example.com/not-official'];
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('SIGNAL_1_SOURCE_URL_NOT_OFFICIAL'));
}

{
  const input=validInput();
  input.signals=Array.from({length:11},(_,index)=>({
    ...input.signals[0],signalKey:'curated:limit:'+index
  }));
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('SIGNAL_LIMIT_EXCEEDED'));
}

{
  const input=validInput();
  input.signals=[];
  const out=curated.buildCuratedBrief(input);
  assert.equal(out.status,'NO_MATCHES');
  assert.equal(out.signalCount,0);
  assert(out.subject.includes('no matching updates'));
}

{
  const out=canary.run();
  assert.equal(out.passed,true);
  assert.equal(out.scoreFree,true);
  assert.equal(out.externalSendCalls,0);
  assert.equal(out.transportPreflight.allowed,false);
  assert(out.transportPreflight.failures.includes('OWNER_AUTHORIZATION_MISSING'));
}

console.log('PermitPlate founder-curated offer tests passed.');
