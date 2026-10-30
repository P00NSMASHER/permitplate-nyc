'use strict';
const assert=require('node:assert/strict');
const benchmark=require('./nyc-real-world-acceptance');
const source={
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
const secondary={
  ...source,sourceRecordId:'DOB_NOW:B01428764-I1',
  officialUrl:'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B01428764-I1',
  sourceStatus:'Plan Examiner Review',needsIdentityReview:true,
  possibleRelatedCamis:['CAMIS:50000000'],
  sourceExcerpt:'Renovate existing restaurant plumbing.'
};
const other={
  ...source,sourceSystem:'SLA_PENDING',sourceRecordId:'SLA_PENDING:NA-1',
  constructionScope:null
};
const result=benchmark.dobConstructionReviewKit({
  status:'REVIEW_ONLY',omittedByLimit:0,items:[source,secondary,other]
});
assert.equal(result.status,'COMPLETE_REVIEW_KIT');
assert.equal(result.caseCount,2);
assert.equal(result.distinctJobFamilies,1);
assert.equal(result.potentialSameJobFamilyExtraFilings,1);
assert.equal(result.filingStatusCounts.Approved,1);
assert.equal(result.filingStatusCounts['Plan Examiner Review'],1);
assert.equal(result.newOrProposedTextMentions,1);
assert.equal(result.existingTextMentions,1);
assert.equal(result.potentialIdentityReviewCount,1);
assert.equal(result.independentHumanAdjudications,0);
assert.equal(result.confirmedBuyerNeedCount,null);
assert.equal(result.precision,null);
assert.equal(result.recall,null);
assert.equal(result.customerDeliveryAllowed,false);
assert.equal(result.blindToModelScore,true);
assert.equal(result.cases[0].independentVenueTypeLabel,null);
assert.equal(result.cases[0].confirmedProcurement,null);
assert.equal(result.cases[1].possibleRelatedCamises,1);
assert(result.cases.every(r=>r.reviewOnly===true && r.customerDeliveryAllowed===false &&
  r.sourceRecordId.startsWith('DOB_NOW:')&&r.officialUrl.startsWith('https://data.cityofnewyork.us/')));
assert(!result.cases.some(row=>Object.keys(row).some(k=>
  /(^score$|probability|buyerintent|customeremail|payment|phone)/i.test(k))));
assert.equal(benchmark.dobConstructionReviewKit({
  status:'REVIEW_ONLY',omittedByLimit:1,items:[source]
}).status,'PARTIAL_REVIEW_KIT');
assert.equal(benchmark.dobConstructionReviewKit({
  status:'REVIEW',omittedByLimit:0,items:[source]
}).status,'PARTIAL_REVIEW_KIT');
console.log('NYC government-filing review kit: source-only, dedupe context, blind labels and no-send boundaries passed.');
