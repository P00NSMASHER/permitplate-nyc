'use strict';
// Official-public-source reference cases: no checkout payments, no actual
// independent labels, no model accuracy claim, no human source attestations.
// This test exercises PA intake validation and fail-closed research boundaries
// with real government record identifiers and scope descriptions.
const assert=require('node:assert/strict');
const core=require('./pa-permit-orders');
const fulfil=require('./pa-permit-fulfillment');
const cases=require('./pa-real-official-evidence.json');
const C=cases;

assert.equal(C.version,'PermitPlate-pa-real-public-evidence-reference-v1.0.0');
assert.equal(C.notGenuineCustomerEvidence,true);
assert.equal(C.notIndependentAdjudication,true);
assert.equal(C.noActualStripeTransaction,true);
assert.equal(C.offlineFixtureOnly,true);

const all=[...C.municipalDecisions,...C.permitLogCases,
  ...C.procurementNotices,...C.otherSourceCases];
assert.equal(C.sources.length,9);
assert.equal(C.municipalDecisions.length,9);
assert.equal(C.permitLogCases.length,7);
assert.equal(C.procurementNotices.length,8);
assert.equal(C.otherSourceCases.length,3);
assert.equal(all.length,27);

const identifiers=new Set();
const registry=new Map(C.sources.map(x=>[x.id,x]));
assert.equal(registry.size,C.sources.length);
for(const source of C.sources){
  assert(fulfil.govUrl(source.url),source.id+' must use an official government URL');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(source.observedAsOf));
  assert(typeof source.limitations==='string'&&source.limitations.length>=35);
}
for(const row of all){
  assert(typeof row.caseId==='string'&&row.caseId.length>7);
  assert(!identifiers.has(row.caseId),'duplicated public case '+row.caseId);
  identifiers.add(row.caseId);
  assert(registry.has(row.source),'missing original government link for '+row.caseId);
  assert(typeof row.referenceClassification==='string');
  assert(!('email' in row)&&!('applicantName' in row)&&!('ownerName' in row));
}

// UCC registry is authoritative about OPT-IN vs OPT-OUT, not individual
// building approvals. Identical place names do NOT imply one jurisdiction.
const municipalities=new Map();
for(const x of C.municipalDecisions){
  const key=[x.county,x.name,x.municipalityType].join('|');
  assert(!municipalities.has(key));
  municipalities.set(key,x);
  assert(['OPT-IN','OPT-OUT'].includes(x.uccDecision));
  assert(x.referenceClassification==='RECORDED_MUNICIPAL_ELECTION_NOT_PERMIT');
  assert(x.individualPermitIssued===null);
  assert(x.authorityReviewRequired===true);
  assert(Number.isInteger(x.sourceLine)&&x.sourceLine>0);
}
const local=(county,name,type)=>municipalities.get([county,name,type].join('|'));
assert.equal(local('SCHUYLKILL','POTTSVILLE','CITY').uccDecision,'OPT-IN');
assert.equal(local('SCHUYLKILL','POTTSVILLE','CITY').localAmendments,true);
assert.equal(local('SCHUYLKILL','MOUNT CARBON','BOROUGH').uccDecision,'OPT-OUT');
assert.equal(local('SCHUYLKILL','BRANCH','TOWNSHIP').uccDecision,'OPT-IN');
assert.equal(local('SCHUYLKILL','PINE GROVE','BOROUGH').localAmendments,true);
assert.equal(local('SCHUYLKILL','PINE GROVE','TOWNSHIP').localAmendments,false);
assert.equal(local('SCHUYLKILL','PHILADELPHIA','CITY'),undefined);

// Every permit log case contains a real historical permit identifier,
// address and limited status at the log's reporting date. They are NOT
// customer projects and are not evidence of current procurement or payment.
let reportedIssued=0,reportedRevisions=0;
for(const record of C.permitLogCases){
  assert(/^(?:GM|CP|MP|EP)-2026-\d{6}$/.test(record.recordId));
  assert(record.municipality==='Philadelphia, Philadelphia County');
  assert(record.currentStatusUnknown===true);
  assert(record.customerPurchaseIntentProven===false);
  const form={custom_fields:[
    {key:'municipality',type:'text',text:{value:record.municipality}},
    {key:'projectaddress',type:'text',text:{value:record.projectAddress}},
    {key:'projectscope',type:'text',text:{value:record.projectScope}}
  ]};
  const parsed=core.customerProject(form);
  assert(parsed!==null);
  assert(core.projectHealth(parsed),'real public site address unexpectedly held: '+record.recordId);
  if(record.sourceStatus==='Issued'){
    reportedIssued++;
    assert(record.referenceClassification==='REPORTED_ISSUED_AS_OF_LOG');
  }else{
    reportedRevisions++;
    assert.equal(record.sourceStatus,'Applicant Revisions');
    assert.equal(record.referenceClassification,'NOT_ISSUED_AS_OF_LOG');
  }
}
assert.equal(reportedIssued,6);
assert.equal(reportedRevisions,1);

// Real state procurement schedules are NOT actual issued building permits.
// Many provide a facility and county but NO official street address; the
// customer project validator must hold facility-name-only responses.
for(const item of C.procurementNotices){
  assert(/^C-\d{4}-\d{4}$/.test(item.recordId));
  assert.equal(item.referenceClassification,'FORECAST_NOT_AN_ISSUED_PERMIT');
  assert.equal(item.permitApprovalProven,false);
  assert.equal(item.customerPurchaseIntentProven,false);
  assert.equal(item.currentProcurementStatusUnknown,true);
  assert.equal(item.projectAddress,null);
  const surrogate={municipality:'Unknown, '+item.county+' County',
    projectAddress:item.siteName,projectScope:item.projectScope};
  assert.equal(core.projectHealth(surrogate),false,
    'facility-only address must remain a human clarification hold');
}
assert.equal(core.projectHealth({
  municipality:'Pottsville, Schuylkill County',
  projectAddress:'Project location to be determined',
  projectScope:'Commercial remodeling of a storefront'
}),false);
assert.equal(core.projectHealth({
  municipality:'Pottsville, Schuylkill County',
  projectAddress:'123 TBD Lane',
  projectScope:'Commercial remodeling of a storefront'
}),false);
assert.equal(core.projectHealth({
  municipality:'Pottsville, Schuylkill County',
  projectAddress:'101 North Centre Street, Pottsville, PA',
  projectScope:'Commercial remodeling of a storefront'
}),true);

// Pottsville's OFFICIAL BLANK form and the published Pittsburgh paused
// application are additional no-approval control cases.
const blank=C.otherSourceCases.find(x=>x.caseId==='POTTSVILLE-BLANK-FORM');
assert(blank&&blank.projectAddress===null&&blank.projectScope===null);
assert.equal(blank.referenceClassification,'NO_PROJECT_AND_NO_PERMIT');
const paused=C.otherSourceCases.find(x=>x.caseId==='PIT-BDA-2024-04976');
assert(paused&&paused.currentStatusUnknown===true);
assert.equal(paused.referenceClassification,'PAUSED_ZONING_REVIEW_NOT_ISSUED_PERMIT');
const codeChange=C.otherSourceCases.find(x=>x.caseId==='PA-UCC-EFFECTIVE-2026');
assert.equal(codeChange.effectiveDate,'2026-01-01');

// Exercise the genuine paid product's researcher input checker without
// masquerading as a human. A rich source-linked packet with unverified
// source-check declarations MUST remain unapproved.
const testedRecord=C.permitLogCases.find(x=>x.recordId==='MP-2026-001043');
const official=registry.get('PHL_MAR2026_LOG');
const state=registry.get('PA_UCC_HOME');
const research={
  researcherId:'UNVERIFIED_OFFLINE_TEST',
  preparedAt:'2026-10-20T17:37:00.000Z',
  projectSummary:'Historic Philadelphia HVAC project from an older permit log; present-day applicability is not established.',
  jurisdiction:'Philadelphia, Pennsylvania; historical property restrictions may apply.',
  authorityName:'Philadelphia Department of Licenses and Inspections, confirmation pending.',
  publicFeeNotes:'Official filing fees and current schedule are not documented by these two historical sources.',
  sources:[
    {sourceId:testedRecord.recordId,url:official.url,
      observedAt:'2026-10-20T17:37:00.000Z',
      claim:'A historical commission log records mechanical work with historic exterior conditions.',
      verifiedByHuman:false},
    {sourceId:'PA-UCC-2026',url:state.url,
      observedAt:'2026-10-20T17:37:00.000Z',
      claim:'Pennsylvania statewide code guidance requires determining actual enforcing jurisdiction.',
      verifiedByHuman:false}
  ],
  filingSteps:[
    {action:'Obtain and review the current original permit and any separately recorded conditions.',
      sourceUrl:official.url},
    {action:'Confirm the responsible enforcing authority and current adopted technical code.',
      sourceUrl:state.url}
  ],
  unresolvedQuestions:[
    'Current permit status and independent human source interpretation remain unverified.'
  ],
  claimsGovernmentApproval:false,claimsLegalAdvice:false,claimsNoFurtherVerification:false
};
const held=fulfil.researchErrors(research,'2026-10-19T00:00:00.000Z');
assert(held.includes('PA_RESEARCH_SOURCE_UNVERIFIED'));
assert.equal(held.includes('PA_RESEARCH_PRIMARY_GOVERNMENT_SOURCE_MISSING'),false);

// This source corpus never contains actual customer money, actual human
// approval, customer contact details or a fulfilled product outcome.
const aggregate={
  benchmark:'PA_PUBLIC_ORIGINAL_SOURCE_REFERENCE',
  sourceDocuments:C.sources.length,realPublicReferenceCases:all.length,
  uccMunicipalRows:C.municipalDecisions.length,
  historicalPhiladelphiaPermitRows:C.permitLogCases.length,
  historicalPermitsReportedIssued:reportedIssued,
  historicalPermitsApplicantRevisions:reportedRevisions,
  paStateProcurementNoticeRows:C.procurementNotices.length,
  otherGovernmentReferenceCases:C.otherSourceCases.length,
  siteAddressCasesAcceptedForReview:C.permitLogCases.length,
  facilityOnlySitesHeldForClarification:C.procurementNotices.length,
  syntheticCheckoutSessionsCreated:0,
  providerPaidOrdersCreated:0,realCustomersInvolved:0,
  independentHumanReviewProven:false,modelPrecisionMeasured:false,
  rawOriginalPdfParsingTested:false,actualPermitApplicabilityProven:false,
  actualCustomerDeliveryProven:false,
  customerMessagesSent:0,providerMutations:0,passed:true
};
console.log(JSON.stringify(aggregate,null,2));
