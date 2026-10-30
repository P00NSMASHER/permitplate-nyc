'use strict';

// Separate source-selected construction diagnostic. This module NEVER reads
// the Equipment scoring cohort, its tuning cases, or its sealed holdout.
// Its reserved cases form a NEW diagnostic audit partition, not scoring
// authority or independent human validation.
const research=require('./curated-research-ledger');
const construction=require('./construction-validation-panel');

const VERSION='PermitPlate-construction-blind-review-v1.0.0';
const SPLIT_SEED='permitplate-construction-source-review-fixed-v1';
const AUDIT_FRACTION=0.30;
const CLASSIFICATIONS=Object.freeze([
  'OFFICIAL_PREMISE_CONFLICT','SPECIFIC_COMPONENT_AND_ACTION',
  'GENERAL_RESTAURANT_CONTEXT'
]);
const HEX=/^[a-f0-9]{64}$/;

function placeKey(c){
  return String(c.borough||'').normalize('NFKC').replace(/\s+/g,' ').trim().toUpperCase()+
    '|'+String(c.address||'').normalize('NFKC').replace(/\s+/g,' ').trim().toUpperCase();
}
function groupClass(cases){
  if(cases.some(c=>c.identityStatus==='OFFICIAL_PROPERTY_CONFLICT_REVIEW'))
    return 'OFFICIAL_PREMISE_CONFLICT';
  if(cases.some(c=>c.scopeClass==='SPECIFIC_COMPONENT_AND_ACTION'))
    return 'SPECIFIC_COMPONENT_AND_ACTION';
  return 'GENERAL_RESTAURANT_CONTEXT';
}
function verifiedPanel(panel){
  const failures=[];
  const p=panel||{};
  const {artifactFingerprint,...body}=p;
  if(p.version!==construction.VERSION||
     p.status!=='SOURCE_RICH_DIAGNOSTIC_ONLY'||
     p.category!=='Equipment'||
     p.sourceOnlyDiagnostic!==true||
     p.classSampling!=='ALL_CURRENT_UNLINKED_DOB_REVIEW_RECORDS'||
     p.hiddenHoldoutOpened!==false||
     p.originalCalibrationCaseIdsRead!==0||
     p.originalCalibrationTuningRowsRead!==0||
     p.originalCalibrationHoldoutRowsRead!==0||
     p.genuineIndependentReviewerCount!==0||
     p.acceptedCalibrationLabels!==0||
     p.automaticIdentityLinks!==0||
     p.productionAuthorized!==false||
     p.customerDeliveryAllowed!==false||
     p.externalSendCalls!==0||
     !HEX.test(p.sourceGraphFingerprint||'')||
     !HEX.test(p.privateSourceReceiptFingerprint||'')||
     !HEX.test(p.privateIdentityReceiptFingerprint||'')||
     !Array.isArray(p.cases)||
     p.filings!==p.cases?.length||
     p.filings<2){
    failures.push('BLIND_CONSTRUCTION_PANEL_INELIGIBLE');
  }
  if(artifactFingerprint!==research.hash(body)){
    failures.push('BLIND_CONSTRUCTION_PANEL_FINGERPRINT_INVALID');
  }
  const ids=new Set(),premises=new Map(),rootPlaces=new Map();
  for(const c of p.cases||[]){
    const key=placeKey(c),root=c?.officialJobRootForGroupingOnly;
    if(!c||!/^DOBCASE:[a-f0-9]{24}$/.test(c.caseId||'')||
      !/^DOB_NOW:[A-Za-z0-9-]+$/.test(c.sourceRecordId||'')||
      ids.has(c.caseId)||!c.officialRecordUrl?.startsWith(
        'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=')||
      !HEX.test(c.scopeFingerprint||'')||!HEX.test(c.sourceFactFingerprint||'')||
      typeof c.fullOfficialScopeText!=='string'||
      c.fullOfficialScopeText.length!==c.fullScopeCharacterLength||
      !c.officialFilingDate||
      !root||root!==construction.jobRoot(c.sourceRecordId)||
      !c.borough||!c.address||
      !c.syntheticScopeRules||c.reviewedOperatorIdentity!==false||
      c.independentHumanLabels!==0||c.purchaseOrderVerified!==false||
      c.customerDeliveryAllowed!==false||c.productionAuthorized!==false){
      failures.push('BLIND_CONSTRUCTION_CASE_INVALID');
      continue;
    }
    ids.add(c.caseId);
    const rows=premises.get(key)||[];rows.push(c);premises.set(key,rows);
    const prior=rootPlaces.get(root);
    if(prior&&prior!==key){
      failures.push('BLIND_CONSTRUCTION_JOB_ROOT_CROSSES_PREMISES');
    }else rootPlaces.set(root,key);
  }
  if(ids.size!==p.filings)failures.push('BLIND_CONSTRUCTION_CASE_COUNT_MISMATCH');
  if(rootPlaces.size!==p.uniqueJobNumberRoots){
    failures.push('BLIND_CONSTRUCTION_JOB_ROOT_COUNT_INVALID');
  }
  if(premises.size<3)failures.push('BLIND_CONSTRUCTION_INSUFFICIENT_PREMISES');
  return {valid:failures.length===0,failures:[...new Set(failures)],
    premises,rootPlaces};
}
function reviewerCard(c){
  return {
    caseId:c.caseId,category:'Equipment',
    officialSourceRecordId:c.sourceRecordId,
    officialSourceUrl:c.officialRecordUrl,
    originalSourceObservationId:c.publisherObservationId,
    sourceFactFingerprint:c.sourceFactFingerprint,
    scopeFingerprint:c.scopeFingerprint,
    dateInOfficialRecord:c.officialFilingDate,
    governmentFilingStatus:c.filingStatus,
    borough:c.borough,address:c.address,
    originalScopeText:c.fullOfficialScopeText,
    projectFamilyKey:c.officialJobRootForGroupingOnly,
    humanQuestion:'Does this exact official DOB filing establish an equipment-relevant construction scope, or merely generic restaurant context? Verify the original official record. A source mention is NOT a purchase order.',
    sourceIdentityCaveat:'Restaurant operator, buyer, installation contractor and procurement authority have NOT been independently verified.',
    independentHumanReviewReceived:false,
    customerDeliveryAllowed:false
  };
}
function split(panel){
  const proven=verifiedPanel(panel);
  if(!proven.valid)return {status:'REVIEW',failures:proven.failures,
    reviewerDataReleased:false,productionAuthorized:false};
  const groups=[];
  for(const [key,cases] of proven.premises){
    const cl=groupClass(cases);
    groups.push({key,category:cl,cases,
      deterministicOrder:research.hash({seed:SPLIT_SEED,premise:key})});
  }
  const review=[],reserve=[],allocation=[];
  for(const cl of CLASSIFICATIONS){
    const within=groups.filter(g=>g.category===cl).sort((a,b)=>
      a.deterministicOrder.localeCompare(b.deterministicOrder)||
      a.key.localeCompare(b.key));
    if(!within.length)continue;
    const count=within.length>1?
      Math.max(1,Math.min(within.length-1,Math.round(within.length*AUDIT_FRACTION))):0;
    const audit=within.slice(0,count),initial=within.slice(count);
    reserve.push(...audit);review.push(...initial);
    allocation.push({
      stratum:cl,totalPremises:within.length,
      reviewerPremises:initial.length,reservedPremises:audit.length,
      reviewerFilingRows:initial.reduce((n,g)=>n+g.cases.length,0),
      reservedFilingRows:audit.reduce((n,g)=>n+g.cases.length,0)
    });
  }
  const reviewerItems=review.flatMap(g=>g.cases).map(reviewerCard).sort((a,b)=>
    research.hash({seed:SPLIT_SEED,caseId:a.caseId}).localeCompare(
      research.hash({seed:SPLIT_SEED,caseId:b.caseId})));
  const reserveItems=reserve.flatMap(g=>g.cases).map(c=>({
    caseId:c.caseId,sourceRecordId:c.sourceRecordId,
    premiseKey:placeKey(c),
    officialSourceUrl:c.officialRecordUrl,
    originalSourceText:c.fullOfficialScopeText,
    scopeClass:c.scopeClass,
    identityStatus:c.identityStatus,
    sourceScopeFingerprint:c.scopeFingerprint,
    sourceFactFingerprint:c.sourceFactFingerprint,
    officialFilingDate:c.officialFilingDate,
    customerDeliveryAllowed:false,productionAuthorized:false
  })).sort((a,b)=>a.caseId.localeCompare(b.caseId));
  const reviewerKeys=new Set(review.map(g=>g.key)),reserveKeys=new Set(reserve.map(g=>g.key));
  const reviewerIds=new Set(reviewerItems.map(x=>x.caseId)),reservedIds=new Set(reserveItems.map(x=>x.caseId));
  if(reviewerItems.length+reserveItems.length!==panel.filings||
     reviewerKeys.size+reserveKeys.size!==groups.length||
     [...reviewerKeys].some(key=>reserveKeys.has(key))||
     [...reviewerIds].some(id=>reservedIds.has(id))||
     reviewerItems.length===0||reserveItems.length===0){
    return {status:'REVIEW',failures:['BLIND_CONSTRUCTION_SPLIT_OVERLAP_OR_INCOMPLETE'],
      reviewerDataReleased:false,productionAuthorized:false};
  }
  const packetCore={
    version:VERSION,status:'AWAITING_GENUINE_SOURCE_REVIEW',
    category:'Equipment',packetType:'SOURCE_SELECTED_CONSTRUCTION_REVIEW',
    sourcePanelFingerprint:panel.artifactFingerprint,
    observedAt:panel.sourceObservedAt,
    reviewInstructions:[
      'Two genuine independent reviewers should inspect source links and classify source scope relevance without seeing model scores or synthesized labels.',
      'Do not treat a DOB building property owner as the licensed restaurant operator.',
      'Every case remains unverified for purchase intent, customer status, and contracting authority.',
      'Reviewers should not inspect or receive the reserved diagnostic audit file.'
    ],
    cards:reviewerItems,independentHumanReviewsReceived:0,
    predictedScoresIncluded:false,syntheticClassificationsIncluded:false,
    scoringTuningCasesUsed:0,originalScoringHoldoutUsed:0,
    customerDeliveryAllowed:false,productionAuthorized:false
  };
  const reviewerPacket={...packetCore,packetFingerprint:research.hash(packetCore)};
  const reservedCore={
    version:VERSION,status:'OPERATOR_RESERVED_SOURCE_DIAGNOSTIC',
    reservedFor:'FUTURE_INDEPENDENT_SOURCE_DIAGNOSTIC_AUDIT',
    sourcePanelFingerprint:panel.artifactFingerprint,
    observedAt:panel.sourceObservedAt,
    cases:reserveItems,
    reviewerPacketIncludesReservedCases:false,
    originalScoringHoldoutUsed:0,
    labelsReceived:0,customerDeliveryAllowed:false,productionAuthorized:false
  };
  const reservedAudit={...reservedCore,reservedFingerprint:research.hash(reservedCore)};
  const manifestCore={
    version:VERSION,status:'SEPARATE_SOURCE_RICH_VALIDATION_PREPARED',
    sourcePanelFingerprint:panel.artifactFingerprint,
    sourceObservedAt:panel.sourceObservedAt,
    selectionMethod:'STABLE_SHA256_PREMISE_AND_JOB_ROOT_GROUPED_STRATIFIED',
    selectionSeed:SPLIT_SEED,
    reviewerPacketFingerprint:reviewerPacket.packetFingerprint,
    reservedAuditFingerprint:reservedAudit.reservedFingerprint,
    originalSourceFilingCount:panel.filings,
    originalSourcePremiseGroups:groups.length,
    reviewPremiseGroups:reviewerKeys.size,
    reservedPremiseGroups:reserveKeys.size,
    reviewCases:reviewerItems.length,
    reservedCases:reserveItems.length,
    strata:allocation,
    originalCalibrationSourceCasesRead:0,
    originalScoringTuningCasesRead:0,
    originalScoringHoldoutCasesRead:0,
    realIndependentReviewsReceived:0,
    generatedHumanLabels:0,
    independentOperatorIdentityProven:false,
    reviewerReadyForHumanReview:true,
    scoringPromotionAuthorized:false,
    customerDeliveryAllowed:false,
    externalSendCalls:0,
    caveats:[
      'This is a DOB restaurant-related source-selected diagnostic, not an unbiased estimate of product precision.',
      'The reserved source-diagnostic audit cases are separate from the original 30-case scored-model holdout.',
      'A source-root or premise-group split avoids duplicate filing leakage, not cross-source operator verification.',
      'Neither text classification nor file preparation constitutes independent human validation.'
    ]
  };
  const manifest={...manifestCore,manifestFingerprint:research.hash(manifestCore)};
  return {status:'READY_FOR_REAL_REVIEW',manifest,reviewerPacket,reservedAudit};
}
function verify(bundle,panel){
  const reference=split(panel);
  if(reference.status!=='READY_FOR_REAL_REVIEW'||
     bundle?.status!==reference.status)return {valid:false,
       failures:['SPLIT_INVALID_SOURCE_OR_STATUS']};
  for(const part of ['manifest','reviewerPacket','reservedAudit']){
    if(research.hash(reference[part])!==research.hash(bundle?.[part])){
      return {valid:false,failures:['SPLIT_'+part.toUpperCase()+'_MISMATCH']};
    }
  }
  return {valid:true,failures:[]};
}
module.exports={VERSION,SPLIT_SEED,AUDIT_FRACTION,CLASSIFICATIONS,placeKey,
  groupClass,verifiedPanel,reviewerCard,split,verify};
