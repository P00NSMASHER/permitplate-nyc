'use strict';
const assert=require('node:assert/strict');
const adapter=require('./source-adapters');
const research=require('./curated-research-ledger');
const independent=require('./independent-source-review');
const history=require('./independent-source-history');
const identity=require('./identity-bridge-review');
const diagnostic=require('./construction-validation-panel');

const NOW='2026-10-19T18:00:00.000Z';
const FULL='Restaurant alteration with partitions, ceilings, flooring, wall finishes, nonstructural carpentry, lighting changes, accessibility, restroom relocation and tenant plumbing work on the first floor. The filing continues with NEW COMMERCIAL COOKING EQUIPMENT AND A TYPE 1 KITCHEN EXHAUST HOOD FOR THE RESTAURANT.';
function fixture(opts={}){
  const context={observedAt:NOW};
  const source={
    DOHMH:[adapter.normalizeDohmhRow({
      camis:'50110001',dba:'SAMPLE RESTAURANT',boro:'Manhattan',
      building:'100',street:'MAIN STREET',bin:'1000234',bbl:'1004230012',
      inspection_date:'1900-01-01T00:00:00.000',
      record_date:'2026-10-19T15:00:00.000'
    },context)],
    DOB_NOW:[
      adapter.normalizeDobNowRow({
        job_filing_number:'M01467007-I1',
        borough:'Manhattan',house_no:'100',street_name:'MAIN STREET',
        bin:'1000234',block:'423',lot:'12',
        owner_s_business_name:'SAMPLE PROPERTY HOLDINGS',
        filing_status:'Approved',filing_date:'2026-10-16T00:00:00.000',
        building_type:'Commercial',
        job_description:opts.formula?'=HYPERLINK("https://fake.invalid","PAYLOAD") RESTAURANT NEW COMMERCIAL KITCHEN EXHAUST HOOD':FULL
      },context),
      adapter.normalizeDobNowRow({
        job_filing_number:'M01467008-I1',
        borough:'Manhattan',house_no:'150',street_name:'ELM STREET',
        owner_s_business_name:'SECOND BUILDING HOLDINGS',
        filing_status:'Pending Plan Examiner Assignment',
        filing_date:'2026-10-17T00:00:00.000',building_type:'Commercial',
        job_description:'General restaurant interior wall and floor renovation, no new equipment scope stated'
      },context)
    ],
    SLA_PENDING:[adapter.normalizeSlaPendingRow({
      application_id:'NA001',description:'Restaurant',
      premises_county:'Queens',actual_address_of_premises:'52 TEST PLACE',
      city:'Queens',state_name:'New York',
      received_date:'2026-10-18T00:00:00.000',status:'Pending'
    },context)]
  };
  const observations={},batches={};
  for(const key of research.REQUIRED_SOURCES){
    const obs={
      observationId:'OBS:'+key,
      state:'COMPLETE_NONEMPTY',
      observedAt:NOW,
      transportOk:true,sourceFresh:true,
      supportsAbsenceConclusion:true,
      fetchedCount:source[key].length,publisherCount:source[key].length
    };
    observations[key]=obs;
    batches[key]={observation:obs,records:source[key].map(r=>({
      ...r,sourceObservationId:obs.observationId
    }))};
  }
  const graph={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',
    graphState:'COMPLETE',passed:true,observedAt:NOW,
    graphDigest:'a'.repeat(64),
    sourceObservations:observations,
    metrics:{candidateCount:1},knownRegressionChecks:{passed:true},
    candidates:[{
      entityId:'CAMIS:50110001',camis:'50110001',canonicalName:'SAMPLE RESTAURANT',
      borough:'Manhattan',address:'100 MAIN STREET',
      deliverySuppressed:false,crossCamisOperationalConflicts:[],
      acceptedCorroboration:[]
    }]
  };
  graph.artifactFingerprint=research.graphFingerprint(graph);
  const original=independent.inspect({graph,batches,observedAt:NOW});
  assert.equal(original.status,'REVIEW_ONLY');
  const hist=history.bootstrap(original);
  assert.equal(hist.status,'BASELINED');
  const annotated=history.annotate(original,hist.ledger,[],[]);
  assert.equal(annotated.status,'REVIEW_ONLY');
  const hypotheses=identity.prepare({graph,batches,independent:annotated,observedAt:NOW});
  assert.equal(hypotheses.status,'REVIEW_ONLY');
  return {graph,batches,independent:annotated,
    identities:hypotheses,observedAt:NOW};
}
const input=fixture();
const panel=diagnostic.build(input);
assert.equal(panel.status,'SOURCE_RICH_DIAGNOSTIC_ONLY');
assert.equal(panel.filings,2);
assert.equal(panel.uniqueJobNumberRoots,2);
assert.equal(panel.officialRowsWithScopeBeyond180,1);
assert.equal(panel.equipmentSpecificComponentAndActionRules,1);
assert.equal(panel.equipmentBroadSourceTextRules,1);
assert.equal(panel.simulatedRuleAgreementCount,2);
assert.equal(panel.cases.length,2);
assert(panel.cases.some(x=>x.fullOfficialScopeText.includes('NEW COMMERCIAL COOKING EQUIPMENT')));
assert(panel.cases.every(x=>x.reviewedOperatorIdentity===false));
assert(panel.cases.every(x=>x.customerDeliveryAllowed===false));
assert(panel.cases.every(x=>x.purchaseOrderVerified===false));
assert(panel.cases.every(x=>x.independentHumanLabels===0));
assert.equal(panel.originalCalibrationCaseIdsRead,0);
assert.equal(panel.originalCalibrationTuningRowsRead,0);
assert.equal(panel.originalCalibrationHoldoutRowsRead,0);
assert.equal(panel.hiddenHoldoutOpened,false);
assert.equal(panel.productionAuthorized,false);
assert.equal(panel.externalSendCalls,0);
const matched=panel.cases.find(x=>x.sourceRecordId==='DOB_NOW:M01467007-I1');
assert(matched);
assert.equal(matched.identityStatus,'MATCHING_PREMISE_KEYS_OPERATOR_NOT_VERIFIED');
assert(matched.possibleCamisIdentities.includes('CAMIS:50110001'));
assert(matched.scopeFingerprint.match(/^[a-f0-9]{64}$/));
assert(diagnostic.csv(panel).includes('Full Original DOB Job Description'));
assert(diagnostic.csv(panel).includes('NEW COMMERCIAL COOKING EQUIPMENT'));
assert(diagnostic.report(panel).includes('Original scoring holdout rows accessed | 0'));
assert.equal(diagnostic.jobRoot('DOB_NOW:M01467007-I1'),diagnostic.jobRoot('DOB_NOW:M01467007-S1'));
assert.equal(diagnostic.build(fixture()).artifactFingerprint,panel.artifactFingerprint);

const form=diagnostic.build(fixture({formula:true}));
assert.equal(form.status,'SOURCE_RICH_DIAGNOSTIC_ONLY');
assert(diagnostic.csv(form).includes("'=HYPERLINK"));
const poisoned=fixture();
poisoned.batches.DOB_NOW.records[0].facts.job_description+=' FAKE OFFICIAL FILING TEXT';
assert(diagnostic.build(poisoned).failures.includes('CONSTRUCTION_REVIEW_ROW_SOURCE_MISMATCH'));
const wrongReceipt=fixture();
wrongReceipt.independent.items[0].sourceExcerpt='FAKE CHANGED PRIVATE SCOPE';
assert.equal(diagnostic.build(wrongReceipt).status,'REVIEW');
const wrongIdentity=fixture();
wrongIdentity.identities.artifactFingerprint='fake';
assert.equal(diagnostic.build(wrongIdentity).status,'REVIEW');
const partial=fixture();
partial.batches.DOB_NOW.records.pop();
assert(diagnostic.build(partial).failures.includes('CONSTRUCTION_OFFICIAL_SOURCE_INCOMPLETE'));
const capped=fixture();
capped.independent.omittedByLimit=1;
assert(diagnostic.build(capped).failures.includes('CONSTRUCTION_PRIVATE_REVIEW_CAPPED'));
assert.throws(()=>diagnostic.csv({}),/VERIFIED_PRIVATE_CONSTRUCTION_DIAGNOSTIC_REQUIRED/);
assert.throws(()=>diagnostic.report({}),/VERIFIED_PRIVATE_CONSTRUCTION_DIAGNOSTIC_REQUIRED/);
console.log('Separate source-rich construction panel: 100% source binding, full-scope evidence, formula-safe CSV and zero holdout access passed.');
