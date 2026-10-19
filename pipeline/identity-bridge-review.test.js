'use strict';
const assert=require('node:assert/strict');
const sources=require('./source-adapters');
const research=require('./curated-research-ledger');
const independent=require('./independent-source-review');
const history=require('./independent-source-history');
const bridges=require('./identity-bridge-review');

const NOW='2026-10-19T08:00:00.000Z';
function rows(){
  return {
    DOHMH:[sources.normalizeDohmhRow({
      camis:'50110001',dba:'FRESH BISTRO',boro:'Manhattan',
      building:'101',street:'MAIN STREET',zipcode:'10001',
      inspection_date:'1900-01-01T00:00:00.000',
      record_date:'2026-10-18T09:00:00.000'
    },{observedAt:NOW})],
    DOB_NOW:[
      sources.normalizeDobNowRow({
        job_filing_number:'M001-I1',borough:'Manhattan',
        house_no:'101',street_name:'MAIN STREET',
        owner_s_business_name:'PROPERTY HOLDINGS LLC',
        job_description:'Commercial kitchen renovation for restaurant',
        filing_date:'2026-10-18T09:00:00.000',
        building_type:'Commercial',filing_status:'Approved'
      },{observedAt:NOW}),
      sources.normalizeDobNowRow({
        job_filing_number:'M002-I1',borough:'Manhattan',
        house_no:'22',street_name:'ELM STREET',
        owner_s_business_name:'DIFFERENT OWNER LLC',
        job_description:'Restaurant tenant fit-out',
        filing_date:'2026-10-18T09:00:00.000',
        building_type:'Commercial',filing_status:'In Review'
      },{observedAt:NOW}),
      sources.normalizeDobNowRow({
        job_filing_number:'B003-I1',borough:'Brooklyn',
        house_no:'101',street_name:'MAIN STREET',
        owner_s_business_name:'FRESH BISTRO',
        job_description:'Restaurant renovation',
        filing_date:'2026-10-18T09:00:00.000',
        building_type:'Commercial',filing_status:'In Review'
      },{observedAt:NOW})
    ],
    SLA_PENDING:[
      sources.normalizeSlaPendingRow({
        application_id:'NA001',description:'Restaurant Wine',dba:'FRESH BISTRO',
        legalname:'FRESH BISTRO LLC',premises_county:'New York',
        actual_address_of_premises:'101 MAIN STREET',city:'New York',
        state_name:'New York',received_date:'2026-10-17T09:00:00.000',
        status:'Pending'
      },{observedAt:NOW}),
      sources.normalizeSlaPendingRow({
        application_id:'NA002',description:'Restaurant Wine',dba:'OTHER RESTAURANT',
        legalname:'OTHER RESTAURANT LLC',premises_county:'New York',
        actual_address_of_premises:'22 ELM STREET',city:'New York',
        state_name:'New York',received_date:'2026-10-18T09:00:00.000',
        status:'Pending'
      },{observedAt:NOW})
    ]
  };
}
function fixture(options={}){
  const data=rows(),batches={},sourceObservations={};
  if(options.ambiguous)data.DOHMH.push(sources.normalizeDohmhRow({
    camis:'50110002',dba:'EARLIER VENUE',boro:'Manhattan',
    building:'101',street:'MAIN STREET',zipcode:'10001',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-10-18T09:00:00.000'
  },{observedAt:NOW}));
  for(const key of research.REQUIRED_SOURCES){
    const observation={
      observationId:'OBS:'+key,observedAt:NOW,
      state:'COMPLETE_NONEMPTY',sourceFresh:true,transportOk:true,
      supportsAbsenceConclusion:true,publisherCount:data[key].length,
      fetchedCount:data[key].length
    };
    sourceObservations[key]=observation;
    batches[key]={observation,records:data[key].map(row=>({
      ...row,sourceObservationId:observation.observationId
    }))};
  }
  const candidates=[
    {entityId:'CAMIS:50110001',camis:'50110001',
      canonicalName:'FRESH BISTRO',address:'101 MAIN STREET',borough:'Manhattan',
      deliverySuppressed:false,crossCamisOperationalConflicts:[],
      acceptedCorroboration:[],
      sourceSystems:['DOHMH'],sourceCount:1
    }
  ];
  if(options.ambiguous||options.unproven)candidates.push({
    entityId:'CAMIS:50110002',camis:'50110002',
    canonicalName:'EARLIER VENUE',address:'101 MAIN STREET',borough:'Manhattan',
    deliverySuppressed:true,crossCamisOperationalConflicts:[{entityId:'CAMIS:50110001'}],
    acceptedCorroboration:[],sourceSystems:['DOHMH'],sourceCount:1
  });
  if(options.preLinked)candidates[0].acceptedCorroboration=[
    {sourceRecordId:'DOB_NOW:M001-I1',sourceSystem:'DOB_NOW',sourceUrl:'https://data.cityofnewyork.us/d/w9ak-ipjd'}
  ];
  const graph={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',observedAt:NOW,
    graphState:'COMPLETE',graphDigest:'d'.repeat(64),passed:true,
    candidates,metrics:{candidateCount:candidates.length},
    knownRegressionChecks:{passed:true},sourceObservations
  };
  graph.artifactFingerprint=research.graphFingerprint(graph);
  const base={graph,batches,observedAt:NOW};
  const first=independent.inspect(base);
  assert.equal(first.status,'REVIEW_ONLY');
  const baseline=history.bootstrap(first);
  assert.equal(baseline.status,'BASELINED');
  const annotated=history.annotate(first,baseline.ledger);
  assert.equal(annotated.status,'REVIEW_ONLY');
  return {...base,independent:annotated};
}
const base=fixture();
const receipt=bridges.prepare(base);
assert.equal(receipt.status,'REVIEW_ONLY');
assert.equal(receipt.customerDeliveryAllowed,false);
assert.equal(receipt.automaticIdentityLinkAllowed,false);
assert.equal(receipt.externalSendCalls,0);
assert.equal(receipt.automaticMerges,0);
assert(bridges.validate(receipt).valid);
assert(bridges.validate(JSON.parse(JSON.stringify(receipt))).valid);
assert.equal(receipt.totalProposals,4);
assert.equal(receipt.proposals.length,4);
assert.equal(receipt.omittedByLimit,0);
assert.equal(receipt.sourceGraphDigest,base.graph.graphDigest);
const key='DOB_NOW:M001-I1';
const building=receipt.proposals.find(p=>p.kind==='CAMIS_TO_EARLY_SOURCE'&&p.sourceRecordId===key);
assert(building);
assert.equal(building.reviewClass,'PREMISE_ONLY');
assert.equal(building.candidateEntityId,'CAMIS:50110001');
assert(building.dohmhRecordId.startsWith('DOHMH:50110001:'));
assert.equal(building.dohmhObservationId,'OBS:DOHMH');
assert.equal(building.nameAgreement,'NOT_ESTABLISHED');
assert.equal(building.needsIndependentVerification,true);
assert.equal(building.customerDeliveryAllowed,false);
assert.equal(building.automaticIdentityLinkAllowed,false);
const sla=receipt.proposals.find(p=>p.kind==='CAMIS_TO_EARLY_SOURCE'&&p.sourceRecordId==='SLA_PENDING:NA001');
assert(sla);
assert.equal(sla.reviewClass,'NAME_AND_PREMISE_TO_VERIFY');
assert.equal(sla.nameAgreement,'EXACT_OPERATOR_DBA_TEXT');
assert.equal(sla.customerDeliveryAllowed,false);
assert(sla.officialSourceUrls.every(url=>url.startsWith('https://')));
assert(receipt.proposals.some(p=>p.kind==='DOB_TO_SLA_PREMISE_REVIEW'&&
  p.sourceRecordIds.includes('DOB_NOW:M002-I1')&&p.sourceRecordIds.includes('SLA_PENDING:NA002')));
assert(!receipt.proposals.some(p=>p.sourceRecordId==='DOB_NOW:B003-I1'&&p.candidateEntityId==='CAMIS:50110001'));
const recheck=bridges.prepare(fixture());
assert.equal(receipt.artifactFingerprint,recheck.artifactFingerprint);
const limited=bridges.prepare({...fixture(),limit:1});
assert.equal(limited.storedCount,1);
assert.equal(limited.totalProposals,4);
assert.equal(limited.omittedByLimit,3);
assert.equal(limited.reviewQueueComplete,false);
const ambiguous=bridges.prepare(fixture({ambiguous:true}));
const multiple=ambiguous.proposals.filter(p=>p.sourceRecordId==='DOB_NOW:M001-I1'&&p.kind==='CAMIS_TO_EARLY_SOURCE');
assert.equal(multiple.length,2);
assert(multiple.every(p=>p.reviewClass==='MULTIPLE_CAMIS_SAME_PREMISE'||p.reviewClass==='SUPPRESSED_IDENTITY'));
assert(multiple.every(p=>p.automaticIdentityLinkAllowed===false));
const unproven=bridges.prepare(fixture({unproven:true}));
assert.equal(unproven.status,'REVIEW_ONLY');
assert.equal(unproven.skippedWithoutDohmhProvenance,2);
assert.equal(unproven.reviewQueueComplete,false);
assert(!unproven.proposals.some(p=>p.candidateEntityId==='CAMIS:50110002'));
const linked=bridges.prepare(fixture({preLinked:true}));
assert(!linked.proposals.some(p=>p.sourceRecordId==='DOB_NOW:M001-I1'&&p.kind==='CAMIS_TO_EARLY_SOURCE'));
const incomplete=fixture();
incomplete.batches.DOB_NOW.records.pop();
assert.equal(bridges.prepare(incomplete).status,'REVIEW');
const changed=fixture();
changed.independent.items[0].address='FALSE ST';
const {artifactFingerprint,...body}=changed.independent;
changed.independent.artifactFingerprint=history.hash(body);
assert.equal(bridges.prepare(changed).status,'REVIEW');
const altered=structuredClone(receipt);
altered.proposals[0].reviewClass='VERIFIED';
assert(bridges.validate(altered).failures.includes('IDENTITY_REVIEW_FINGERPRINT_INVALID'));
assert(!Object.keys(receipt).includes('reviewedIdentityBridges'));
console.log('PermitPlate identity-hypothesis review: no address-only auto links, complete source binding and privacy passed.');
