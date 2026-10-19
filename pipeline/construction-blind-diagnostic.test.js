'use strict';
const assert=require('node:assert/strict');
const research=require('./curated-research-ledger');
const panelBuilder=require('./construction-validation-panel');
const split=require('./construction-blind-diagnostic');
const frozen=require('./construction-frozen-reference');
const reviewerWorksheet=require('./construction-reviewer-worksheet');
const makeHash=value=>research.hash(value);
const WHEN='2026-10-19T17:43:28.906Z';
function record(id,place,scopeClass='SPECIFIC_COMPONENT_AND_ACTION',options={}){
  const [borough,address]=place.split('|');
  const fullText='OFFICIAL DOB RESTAURANT / COMMERCIAL KITCHEN SCOPE FOR '+id+
    ', INSTALLATION OF EXHAUST AND OTHER EQUIPMENT, WITH SOURCE PROOF.';
  const p={
    caseId:'DOBCASE:'+makeHash({id,content:fullText}).slice(0,24),
    sourceRecordId:'DOB_NOW:'+id,
    officialRecordUrl:'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number='+id,
    publisherObservationId:'OBS:mock-dob-source',
    sourceFactFingerprint:makeHash({fact:id}),
    scopeFingerprint:makeHash({scope:fullText}),
    officialFilingDate:'2026-10-16T00:00:00.000Z',
    lastObservedByPermitPlateAt:WHEN,
    firstObservedByPermitPlateAt:'2026-10-19T04:59:48.307Z',
    borough,address,filingStatus:'Approved',
    fullOfficialScopeText:fullText,fullScopeCharacterLength:fullText.length,
    scopeBeyond180Characters:false,
    contextTags:['RESTAURANT'],specificComponentTags:[],
    scopeActionTags:['INSTALL'],scopeClass,
    existingOrRepairContext:false,
    officialJobRootForGroupingOnly:panelBuilder.jobRoot('DOB_NOW:'+id),
    possibleCamisIdentities:[],manualIdentityReview:false,
    identityStatus:options.identityStatus||'UNLINKED_RESEARCH_ONLY',
    reviewedOperatorIdentity:false,
    syntheticScopeRules:{broadCategoryContext:true,
      explicitComponentAndAction:scopeClass==='SPECIFIC_COMPONENT_AND_ACTION',
      rulesAgree:true},
    independentHumanLabels:0,purchaseOrderVerified:false,
    customerDeliveryAllowed:false,productionAuthorized:false
  };
  return {...p,...options};
}
function fixture(){
  const cases=[];
  const groups=[
    ['BRONX|2 FIRST AVE','SPECIFIC_COMPONENT_AND_ACTION'],
    ['BRONX|3 SECOND AVE','SPECIFIC_COMPONENT_AND_ACTION'],
    ['BRONX|4 THIRD AVE','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['BROOKLYN|11 FOURTH ST','SPECIFIC_COMPONENT_AND_ACTION'],
    ['BROOKLYN|22 FIFTH ST','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['BROOKLYN|33 SIXTH ST','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['QUEENS|18 MAIN ST','SPECIFIC_COMPONENT_AND_ACTION'],
    ['QUEENS|90 OCEAN AVE','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['QUEENS|10 HOTEL AVE','SPECIFIC_COMPONENT_AND_ACTION'],
    ['MANHATTAN|20 CENTER ST','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['MANHATTAN|45 GREEN ST','SPECIFIC_COMPONENT_AND_ACTION'],
    ['MANHATTAN|98 GRAND ST','SPECIFIC_COMPONENT_AND_ACTION'],
    ['STATEN ISLAND|16 JERSEY ST','RESTAURANT_OR_KITCHEN_CONTEXT_ONLY'],
    ['MANHATTAN|66 CONFLICT ST','SPECIFIC_COMPONENT_AND_ACTION'],
    ['MANHATTAN|77 CONFLICT ST','SPECIFIC_COMPONENT_AND_ACTION']
  ];
  for(let i=0;i<groups.length;i++){
    const [place,category]=groups[i];
    const id='M0'+String(10000+i)+'-I1';
    const opts=i>=13?{identityStatus:'OFFICIAL_PROPERTY_CONFLICT_REVIEW'}:{};
    cases.push(record(id,place,category,opts));
  }
  // Two subfilings of the SAME job and one separate job at the same premise:
  // all three must stay entirely within the same reviewer or audit partition.
  cases.push(record('M010000-I2',groups[0][0],groups[0][1]));
  cases.push(record('M020000-I1',groups[0][0],groups[0][1]));
  const roots=new Set(cases.map(c=>c.officialJobRootForGroupingOnly));
  const statuses={};for(const c of cases)statuses[c.scopeClass]=(statuses[c.scopeClass]||0)+1;
  const body={
    version:panelBuilder.VERSION,status:'SOURCE_RICH_DIAGNOSTIC_ONLY',
    category:'Equipment',
    sourceObservedAt:WHEN,
    sourceGraphDigest:'a'.repeat(64),
    sourceGraphFingerprint:'b'.repeat(64),
    privateSourceReceiptFingerprint:'c'.repeat(64),
    privateIdentityReceiptFingerprint:'d'.repeat(64),
    officialDataset:'NYC_DOB_NOW_JOB_APPLICATION_FILINGS',
    sourcePopulationDescription:'Fixture unlinked NYC restaurant DOB',
    filings:cases.length,uniqueJobNumberRoots:roots.size,
    categories:statuses,identityReviewClasses:{},
    equipmentBroadSourceTextRules:cases.length,
    equipmentSpecificComponentAndActionRules:0,
    simulatedRuleAgreementCount:0,simulatedRuleAgreementRate:0,
    officialRowsWithScopeBeyond180:0,
    originalCalibrationCaseIdsRead:0,originalCalibrationTuningRowsRead:0,
    originalCalibrationHoldoutRowsRead:0,
    sourceOnlyDiagnostic:true,classSampling:'ALL_CURRENT_UNLINKED_DOB_REVIEW_RECORDS',
    hiddenHoldoutOpened:false,reviewerIndependenceEstablished:false,
    genuineIndependentReviewerCount:0,acceptedCalibrationLabels:0,
    verifiedEquipmentOrders:0,scoredPromotionAllowed:false,
    customerDeliveryAllowed:false,automaticIdentityLinks:0,
    productionAuthorized:false,externalSendCalls:0,
    caveats:['A group split is not real human review.'],cases
  };
  return {...body,artifactFingerprint:research.hash(body)};
}
const panel=fixture();
const out=split.split(panel);
assert.equal(out.status,'READY_FOR_REAL_REVIEW');
assert(split.verify(out,panel).valid);
assert.equal(out.manifest.originalSourceFilingCount,panel.filings);
assert.equal(out.manifest.originalSourcePremiseGroups,15);
assert.equal(out.manifest.reviewPremiseGroups+out.manifest.reservedPremiseGroups,15);
assert.equal(out.manifest.reviewCases+out.manifest.reservedCases,17);
assert.equal(out.manifest.originalScoringTuningCasesRead,0);
assert.equal(out.manifest.originalScoringHoldoutCasesRead,0);
assert.equal(out.manifest.realIndependentReviewsReceived,0);
assert.equal(out.reviewerPacket.independentHumanReviewsReceived,0);
assert.equal(out.reviewerPacket.productionAuthorized,false);
assert.equal(out.reservedAudit.reviewerPacketIncludesReservedCases,false);
assert.equal(out.reviewerPacket.predictedScoresIncluded,false);
assert.equal(out.reviewerPacket.syntheticClassificationsIncluded,false);
assert(out.reviewerPacket.cards.every(c=>
  !Object.prototype.hasOwnProperty.call(c,'syntheticScopeRules')&&
  !Object.prototype.hasOwnProperty.call(c,'scopeClass')&&
  !Object.prototype.hasOwnProperty.call(c,'score')&&
  !Object.prototype.hasOwnProperty.call(c,'predictions')&&
  c.customerDeliveryAllowed===false));
const reviewIds=new Set(out.reviewerPacket.cards.map(c=>c.caseId));
const reservedIds=new Set(out.reservedAudit.cases.map(c=>c.caseId));
assert(![...reviewIds].some(id=>reservedIds.has(id)));
const r0=out.reviewerPacket.cards.find(c=>c.officialSourceRecordId==='DOB_NOW:M010000-I1');
const r1=out.reviewerPacket.cards.find(c=>c.officialSourceRecordId==='DOB_NOW:M010000-I2');
const r2=out.reviewerPacket.cards.find(c=>c.officialSourceRecordId==='DOB_NOW:M020000-I1');
assert.equal(Boolean(r0),Boolean(r1));
assert.equal(Boolean(r0),Boolean(r2));
assert.deepEqual(split.split(panel),out);
const shuffled=structuredClone(panel);
shuffled.cases.reverse();
const {artifactFingerprint:_unused,...source}=shuffled;
shuffled.artifactFingerprint=research.hash(source);
const repeat=split.split(shuffled);
assert.equal(repeat.status,'READY_FOR_REAL_REVIEW');
assert.deepEqual(
  repeat.reviewerPacket.cards.map(c=>c.caseId),
  out.reviewerPacket.cards.map(c=>c.caseId)
);
const tampered=structuredClone(out);
tampered.reviewerPacket.cards[0].originalScopeText='UNSUPPORTED INSPECTION';
assert.equal(split.verify(tampered,panel).valid,false);
const altered=structuredClone(panel);
altered.cases[0].fullOfficialScopeText='FALSIFIED CONSTRUCTION SCOPE';
assert(split.verifiedPanel(altered).failures.includes(
  'BLIND_CONSTRUCTION_PANEL_FINGERPRINT_INVALID'));
const rehashedUnsafe=structuredClone(panel);
rehashedUnsafe.hiddenHoldoutOpened=true;
delete rehashedUnsafe.artifactFingerprint;
rehashedUnsafe.artifactFingerprint=research.hash(rehashedUnsafe);
assert.equal(split.split(rehashedUnsafe).status,'REVIEW');
const noSource=structuredClone(panel);
noSource.cases[0].purchaseOrderVerified=true;
delete noSource.artifactFingerprint;
noSource.artifactFingerprint=research.hash(noSource);
assert.equal(split.split(noSource).status,'REVIEW');
const invalidRoot=structuredClone(panel);
invalidRoot.cases[0].officialJobRootForGroupingOnly='FAKE';
delete invalidRoot.artifactFingerprint;
invalidRoot.artifactFingerprint=research.hash(invalidRoot);
assert(split.verifiedPanel(invalidRoot).failures.includes('BLIND_CONSTRUCTION_CASE_INVALID'));
const crossRoot=structuredClone(panel);
crossRoot.cases[1].sourceRecordId='DOB_NOW:M010000-I3';
crossRoot.cases[1].officialJobRootForGroupingOnly='M010000';
delete crossRoot.artifactFingerprint;
crossRoot.artifactFingerprint=research.hash(crossRoot);
assert(split.verifiedPanel(crossRoot).failures.includes(
  'BLIND_CONSTRUCTION_JOB_ROOT_CROSSES_PREMISES'));

// A previous private, genuine-source review reference must freeze before the
// next source-refresh rebalancing can move reserved cases to visible review.
const legacy={panel,reviewerPacket:out.reviewerPacket,
  reservedAudit:out.reservedAudit,manifest:out.manifest};
const newlyFrozen=frozen.choose({
  previousFrozen:{},legacy,current:legacy,
  now:'2026-10-19T18:20:00.000Z'
});
assert.equal(newlyFrozen.status,'FROZEN_CREATED');
assert.equal(newlyFrozen.newlyFrozen,true);
assert.equal(newlyFrozen.originalLegacyExists,true);
assert.equal(newlyFrozen.frozen.anchor.origin,'EXISTING_VERIFIED_PRIVATE_SNAPSHOT');
assert.equal(newlyFrozen.frozen.anchor.originalSourceObservedAt,WHEN);
assert.equal(newlyFrozen.frozen.anchor.reviewCases,out.manifest.reviewCases);
assert.equal(newlyFrozen.frozen.anchor.reservedCases,out.manifest.reservedCases);
assert.equal(newlyFrozen.frozen.anchor.originalScoringHoldoutCasesRead,0);
assert(frozen.validate(newlyFrozen.frozen).valid);
assert.equal(frozen.allOrNone(newlyFrozen.frozen),'ALL');
const rollingLegacy={...legacy,panel:shuffled};
const replay=frozen.choose({
  previousFrozen:newlyFrozen.frozen,legacy:rollingLegacy,
  current:{panel:shuffled,reviewerPacket:repeat.reviewerPacket,
    reservedAudit:repeat.reservedAudit,manifest:repeat.manifest},
  now:'2026-10-20T18:20:00.000Z'
});
assert.equal(replay.status,'FROZEN_ALREADY');
assert.equal(replay.newlyFrozen,false);
assert.notEqual(rollingLegacy.panel.artifactFingerprint,
  newlyFrozen.frozen.panel.artifactFingerprint);
assert.equal(replay.frozen.panel.artifactFingerprint,
  newlyFrozen.frozen.panel.artifactFingerprint);
assert.equal(replay.frozen.anchor.anchorFingerprint,
  newlyFrozen.frozen.anchor.anchorFingerprint);
assert.equal(replay.frozen.reviewerPacket.packetFingerprint,
  newlyFrozen.frozen.reviewerPacket.packetFingerprint);
assert.equal(replay.frozen.reservedAudit.reservedFingerprint,
  newlyFrozen.frozen.reservedAudit.reservedFingerprint);
const tamperedFrozen=structuredClone(newlyFrozen.frozen);
tamperedFrozen.reservedAudit.cases[0].originalSourceText='UNAUTHORIZED AUDIT RECORD';
assert(frozen.validate(tamperedFrozen).failures.includes('CONSTRUCTION_FROZEN_SOURCE_UNVERIFIED'));
assert.equal(frozen.choose({
  previousFrozen:tamperedFrozen,legacy,current:legacy,now:'2026-10-20T18:20:00Z'
}).status,'REVIEW');
const legacySwapped=structuredClone(legacy);
legacySwapped.reviewerPacket.cards[0].officialSourceRecordId='DOB_NOW:MISSING';
assert(frozen.choose({
  previousFrozen:newlyFrozen.frozen,legacy:legacySwapped,
  current:legacy,now:'2026-10-20T18:20:00Z'
}).failures.includes('CONSTRUCTION_LEGACY_AUDIT_WAS_CHANGED'));
const partialArchive={...newlyFrozen.frozen,reservedAudit:null};
assert(frozen.choose({
  previousFrozen:partialArchive,legacy,current:legacy,now:'2026-10-20T18:20:00Z'
}).failures.includes('CONSTRUCTION_FROZEN_ARCHIVE_PARTIAL'));
const partialLegacy={...legacy,manifest:null};
assert(frozen.choose({
  previousFrozen:{},legacy:partialLegacy,current:legacy,now:'2026-10-20T18:20:00Z'
}).failures.includes('CONSTRUCTION_LEGACY_SNAPSHOT_PARTIAL'));
const fresh=frozen.choose({
  previousFrozen:{},legacy:{},current:legacy,
  now:'2026-10-19T18:20:00.000Z'
});
assert.equal(fresh.status,'FROZEN_CREATED');
assert.equal(fresh.originalLegacyExists,false);
assert.equal(fresh.frozen.anchor.origin,'CURRENT_VERIFIED_SOURCE_SNAPSHOT');
assert.equal(fresh.frozen.anchor.reviewCases+fresh.frozen.anchor.reservedCases,17);
assert.equal(fresh.frozen.anchor.customerDeliveryAllowed,false);
assert.equal(fresh.frozen.anchor.scoringPromotionAuthorized,false);


// Create a human-usable *blank* source worksheet without ever rendering
// reserved audit IDs or contaminating the existing Equipment scoring holdout.
const reviewerMaterials=reviewerWorksheet.render(newlyFrozen.frozen);
assert.equal(reviewerMaterials.receipt.status,'UNLABELED_FROZEN_REVIEWER_WORKSHEET');
assert.equal(reviewerMaterials.receipt.caseCount,out.reviewerPacket.cards.length);
assert.equal(reviewerMaterials.receipt.reservedAuditCaseIdsEmitted,0);
assert.equal(reviewerMaterials.receipt.humanJudgmentsPreFilled,0);
assert.equal(reviewerMaterials.receipt.hiddenOriginalScoringHoldoutAccessed,0);
assert.equal(reviewerMaterials.receipt.customerDeliveryAllowed,false);
assert.equal(reviewerMaterials.receipt.productionAuthorized,false);
assert(reviewerMaterials.html.startsWith('<!doctype html>'));
assert(reviewerMaterials.html.includes('Content-Security-Policy'));
assert(reviewerMaterials.html.includes('Unabridged official job description'));
assert(reviewerMaterials.html.includes('Zero human judgments recorded'));
assert(!reviewerMaterials.html.includes('<script'));
assert(!reviewerMaterials.html.includes('model score predictions'));
assert(reviewerMaterials.csv.startsWith('\ufeff'));
assert(reviewerMaterials.csv.includes('Equipment Construction Relevance (BLANK)'));
assert(reviewerMaterials.csv.includes('Source Seen In Official Record? (BLANK)'));
assert(reviewerMaterials.csv.includes('Reviewer Attestation (BLANK)'));
assert(!reviewerMaterials.csv.includes('APPROVED BY REVIEWER'));
for(const c of out.reservedAudit.cases){
  assert(!reviewerMaterials.html.includes(c.caseId));
  assert(!reviewerMaterials.csv.includes(c.caseId));
  assert(!reviewerMaterials.html.includes(c.originalSourceText));
}
assert(reviewerWorksheet.verifyFiles(newlyFrozen.frozen,reviewerMaterials).valid);
const repeatedWorksheet=reviewerWorksheet.render(newlyFrozen.frozen);
assert.deepEqual(repeatedWorksheet,reviewerMaterials);
const worksheetTamper=structuredClone(reviewerMaterials);
worksheetTamper.csv+='FORGED HUMAN APPROVAL';
assert.equal(reviewerWorksheet.verifyFiles(newlyFrozen.frozen,worksheetTamper).valid,false);
const maliciousPanel=structuredClone(panel);
const included=out.reviewerPacket.cards[0].caseId;
const unsafe=maliciousPanel.cases.find(c=>c.caseId===included);
assert(unsafe);
unsafe.fullOfficialScopeText='=HYPERLINK("https://evil.invalid","CLICK") <img src=x onerror="alert(1)">';
unsafe.fullScopeCharacterLength=unsafe.fullOfficialScopeText.length;
delete maliciousPanel.artifactFingerprint;
maliciousPanel.artifactFingerprint=research.hash(maliciousPanel);
const maliciousSplit=split.split(maliciousPanel);
assert.equal(maliciousSplit.status,'READY_FOR_REAL_REVIEW');
const maliciousFrozen=frozen.choose({legacy:{},previousFrozen:{},
  current:{panel:maliciousPanel,reviewerPacket:maliciousSplit.reviewerPacket,
    reservedAudit:maliciousSplit.reservedAudit,manifest:maliciousSplit.manifest},
  now:'2026-10-19T18:20:00.000Z'
});
assert.equal(maliciousFrozen.status,'FROZEN_CREATED');
const escaped=reviewerWorksheet.render(maliciousFrozen.frozen);
assert(escaped.html.includes('&lt;img'));
assert(!escaped.html.includes('<img src='));
assert(escaped.csv.includes("'=HYPERLINK"));
const unsafeLink=structuredClone(newlyFrozen.frozen);
unsafeLink.reviewerPacket.cards[0].officialSourceUrl='https://evil.example.com/fake';
assert.throws(()=>reviewerWorksheet.render(unsafeLink),/UNVERIFIED_FROZEN_CONSTRUCTION_SOURCE/);

console.log('Unscored source-rich construction split: stable premise/root isolation, blinded reviewer packet, reserved audit and scoring-holdout firewall passed.');
