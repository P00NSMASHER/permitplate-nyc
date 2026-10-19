'use strict';
const assert=require('node:assert/strict');
const identity=require('./identity-bridge-review');
const history=require('./independent-source-history');
const report=require('./identity-review-workbench');
const triage=require('./identity-triage-history');

const first=identity.createProposal({
  kind:'CAMIS_TO_EARLY_SOURCE',
  sourceRecordId:'DOB_NOW:B00000001-I1',
  sourceRecordIds:['DOB_NOW:B00000001-I1'],
  candidateEntityId:'CAMIS:50110001',
  sourceSystem:'DOB_NOW',
  premiseKey:'MANHATTAN|1 MAIN ST',
  nameAgreement:'NOT_ESTABLISHED',
  reviewClass:'PREMISE_ONLY',
  competingCamisCount:1,
  officialSourceUrls:[
    'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B00000001-I1',
    'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=50110001'
  ],
  sourceObservationId:'OBS:DOB_NOW',
  sourceRowFingerprint:'a'.repeat(64),
  dohmhRecordId:'DOHMH:50110001:fixture',
  dohmhObservationId:'OBS:DOHMH',
  dohmhRowFingerprint:'b'.repeat(64),
  candidateName:'=HYPERLINK("evil")',
  sourceTradeName:'<img src=x onerror="alert(1)">',
  sourceOwnerName:'-2 + 4',
  sourceGraphFingerprint:'c'.repeat(64)
});
const second=identity.createProposal({
  kind:'DOB_TO_SLA_PREMISE_REVIEW',
  sourceRecordId:'DOB_NOW:M00000002-I1',
  sourceRecordIds:['DOB_NOW:M00000002-I1','SLA_PENDING:NA-000002'],
  candidateEntityId:null,
  sourceSystem:'DOB_NOW',
  premiseKey:'MANHATTAN|55 ELM ST',
  nameAgreement:'NOT_ESTABLISHED',
  reviewClass:'DOB_SLA_SHARED_PREMISE',
  competingCamisCount:0,
  officialSourceUrls:[
    'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=M00000002-I1',
    'https://data.ny.gov/resource/f8i8-k2gm.json?application_id=NA-000002'
  ],
  sourceObservationId:'OBS:DOB_NOW',
  sourceRowFingerprint:'d'.repeat(64),
  counterpartyObservationId:'OBS:SLA_PENDING',
  counterpartyRowFingerprint:'e'.repeat(64),
  sourceGraphFingerprint:'f'.repeat(64)
});
function receipt(proposals=[first,second]){
  const core={
    version:identity.VERSION,status:'REVIEW_ONLY',
    observedAt:'2026-10-19T07:00:00.000Z',
    sourceGraphDigest:'a'.repeat(64),
    sourceArtifactFingerprint:'b'.repeat(64),
    sourceReviewFingerprint:'c'.repeat(64),
    totalProposals:proposals.length,storedCount:proposals.length,
    omittedByLimit:0,reviewQueueComplete:true,
    skippedWithoutDohmhProvenance:0,
    proposals,
    customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false,
    automaticMerges:0,externalSendCalls:0,
    notices:['research only']
  };
  return {...core,artifactFingerprint:history.hash(core)};
}
const d=receipt();
assert(identity.validate(d).valid);
const result=report.render(d);
assert.equal(result.status,'INTERNAL_REVIEW_ONLY');
assert.equal(result.renderedCount,2);
assert.equal(result.totalProposals,2);
assert.equal(result.omittedByLimit,0);
assert.equal(result.customerDeliveryAllowed,false);
assert.equal(result.automaticIdentityLinkAllowed,false);
assert(result.html.startsWith('<!doctype html>'));
assert(result.html.includes('Content-Security-Policy'));
assert(result.html.includes('default-src &#39;none&#39;'));
assert(!result.html.includes('<script'));
assert(!result.html.includes('<img'));
assert(result.html.includes('&lt;img'));
assert(result.html.includes('INTERNAL RESEARCH'));
assert(result.html.includes('Automatic merges: 0'));
assert(result.html.includes('Manual evidence required'));
assert(result.html.includes('target="_blank" rel="noopener noreferrer"'));
assert(result.csv.startsWith('\uFEFF'));
assert(result.csv.includes("'=HYPERLINK"));
assert(result.csv.includes("'-2 + 4"));
assert(result.csv.includes('PENDING - NOT AN APPROVAL'));
assert(result.csv.includes('Customer Delivery Allowed'));
assert.equal(result.byClass.PREMISE_ONLY,1);
assert.equal(result.byClass.DOB_SLA_SHARED_PREMISE,1);
// Track provenance without changing the authority of the underlying links.
const origin=triage.bootstrap(d);
assert.equal(origin.status,'BASELINED');
const tracked=triage.annotate(d,origin.ledger,[],[],true);
assert.equal(tracked.status,'REVIEW_ONLY');
const human=report.render(tracked);
assert(human.csv.includes('Monitoring Status'));
assert(human.csv.includes('First Observed by PermitPlate'));
assert(human.csv.includes('BASELINE_EXISTING'));
assert(human.html.includes('Monitoring'));
assert(human.html.includes('BASELINE_EXISTING'));
assert(!human.html.includes('verified new business'));
const oneChanged=identity.createProposal({...first,
  sourceOwnerName:'UPDATED PRINTED OWNER'});
const markedSource=receipt([oneChanged,second]);
markedSource.observedAt='2026-10-19T08:00:00.000Z';
const {artifactFingerprint:_prev,...bodyWithDate}=markedSource;
markedSource.artifactFingerprint=history.hash(bodyWithDate);
const refreshed=triage.advance(origin.ledger,markedSource);
assert.equal(refreshed.contextRecheckIds.length,1);
const marked=triage.annotate(markedSource,refreshed.ledger,[],
  refreshed.contextRecheckIds);
const riskRanked=report.render(marked);
assert(riskRanked.csv.includes('SOURCE_CONTEXT_RECHECK'));
assert(riskRanked.html.includes('source-context recheck')||
  riskRanked.html.includes('SOURCE_CONTEXT_RECHECK'));
const repeated=report.render(d);
assert.equal(repeated.html,result.html);
assert.equal(repeated.csv,result.csv);
const corrupt=structuredClone(d);
corrupt.proposals[0].candidateName='UNREVIEWED OPERATING NAME';
assert.throws(()=>report.render(corrupt),/IDENTITY_WORKBENCH_RECEIPT_INVALID/);
const badLink=identity.createProposal({
  ...first,
  officialSourceUrls:[
    'https://evil.example.com/borrowed-source',
    first.officialSourceUrls[1]
  ]
});
const tamperedLinks=receipt([badLink]);
assert(identity.validate(tamperedLinks).valid);
assert.throws(()=>report.render(tamperedLinks),/REVIEW_SOURCE_URL_NOT_BOUND_TO_OFFICIAL_DATASET/);
const truncated=receipt([first]);
truncated.totalProposals=12;
truncated.omittedByLimit=11;
truncated.reviewQueueComplete=false;
const {artifactFingerprint,...core}=truncated;
truncated.artifactFingerprint=history.hash(core);
const partial=report.render(truncated);
assert.equal(partial.renderedCount,1);
assert.equal(partial.omittedByLimit,11);
assert(partial.html.includes('Omitted by limit: 11'));
assert(!result.csv.includes('APPROVED,'));
console.log('Private identity workbench HTML, safe spreadsheet export, source links and no-send gates passed.');
