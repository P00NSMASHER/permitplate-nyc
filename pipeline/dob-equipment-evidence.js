'use strict';

// Separate private, source-only equipment evidence inventory. This module
// NEVER alters project identity, V3/V4 scores, threshold calibration, customer
// delivery state or Stripe. Co-location is NOT same-operator corroboration.
const clock=require('./event-time');
const project=require('./project-signal');

const VERSION='PermitPlate-DOB-equipment-source-evidence-v1.0.0';
const SOURCE_ID='nyc-open-data:w9ak-ipjd';
const SOURCE_PAGE='https://data.cityofnewyork.us/d/w9ak-ipjd';
const MAX_MATCHED_FILINGS=3000;
const sourceText=v=>typeof v==='string'?v.trim():'';
const norm=v=>project.norm(v);
function dateAge(date,asOf){
  const d=clock.calendarDate(date);
  const today=clock.calendarDate(asOf);
  if(!d||!today)return null;
  const age=(Date.parse(today)-Date.parse(d))/86400000;
  return Number.isInteger(age)?age:null;
}
// Reject non-installation changes. A generic permit or inspection cannot
// produce a positive purchase/installation-scope finding.
const ACTION=/\b(?:install(?:ation|ing|ed)?|replace(?:ment|d|ing)?|new|proposed|construct(?:ion)?|provide|upgrade|alter(?:ation)?)\b/i;
const NON_ACTION=/\b(?:no\s+(?:new|proposed|equipment|kitchen|work)|not\s+(?:install|proposed)|existing\s+to\s+remain|remove\s+only|demolition\s+only|no\s+change\s+to)\b/i;
const EXPLICIT_EQUIPMENT=/\b(?:commercial\s+kitchen\s+equipment|kitchen\s+equipment|cooking\s+(?:appliances?|equipment)|food\s+service\s+equipment|walk[\s-]?in\s+(?:cooler|freezer)|commercial\s+refrigerat(?:or|ion)|grease\s+(?:hood|duct|exhaust)|(?:type\s*1|type\s*i)\s+(?:kitchen\s+)?(?:exhaust\s+)?hood|(?:commercial|kitchen)\s+exhaust\s+hood|kitchen\s+fire\s+suppression\s+system)\b/i;
const KITCHEN_BUILDOUT=/\b(?:kitchen|restaurant|food\s+(?:service|preparation))\b.{0,90}\b(?:fit[\s-]?out|renovat(?:e|ion)|alter(?:ation)?|construct(?:ion)?|build[\s-]?out|plumbing|mechanical|ventilation|exhaust|cook(?:ing)?)\b|\b(?:fit[\s-]?out|renovat(?:e|ion)|alter(?:ation)?|construct(?:ion)?|build[\s-]?out)\b.{0,90}\b(?:commercial\s+kitchen|restaurant|food\s+service)\b/i;
const RESIDENTIAL_UNIT=/\\b(?:apt\\.?\\s*#?\\s*\\w+|apartment\\b|dwelling\\s+unit|residential\\s+(?:kitchen|unit)|condo(?:minium)?\\s+unit)\\b/i;
const DEMOLITION=/\\b(?:selective\\s+|interior\\s+)?demolition\\b/i;
const POSITIVE_NON_DEMOLITION_WORK=/\\b(?:install(?:ation|ing|ed)?|replace(?:ment|d|ing)?|new\\s+(?:commercial\\s+)?(?:kitchen|equipment|hood|exhaust|ventilation)|construct(?:ion)?\\s+of\\s+(?:new|commercial))\\b/i;
const BAD_STATUS=/\b(?:withdrawn?|disapprov(?:ed|al)?|cancel(?:led|ed|ation)?|void(?:ed)?|revok(?:ed|ation)|abandon(?:ed)?|expired|superseded)\b/i;
function classifyDobFiling(record,observedAt){
  if(record?.sourceSystem!=='DOB_NOW'||record.sourceDatasetId!==SOURCE_ID ||
     !sourceText(record.sourceRecordId)||!sourceText(record.entityKeys?.jobFilingNumber)){
    return {status:'REVIEW',reason:'OFFICIAL_DOB_IDENTITY_UNVERIFIED'};
  }
  const facts=record.facts||{},description=sourceText(facts.job_description);
  const age=dateAge(facts.filing_date,clock.nycDate(observedAt));
  if(!sourceText(record.rawFactFingerprint)||!sourceText(record.sourceObservationId)){
    return {status:'REVIEW',reason:'SOURCE_RECEIPT_OR_FINGERPRINT_MISSING'};
  }
  if(age===null||age<0||age>90){
    return {status:'REVIEW',reason:'FILING_DATE_NOT_IN_90_DAY_RESEARCH_WINDOW'};
  }
  if(!description){
    return {status:'REVIEW',reason:'JOB_DESCRIPTION_MISSING'};
  }
  const status=sourceText(facts.filing_status);
  if(!status||BAD_STATUS.test(status)){
    return {status:'REVIEW',reason:'FILING_STATUS_MISSING_OR_INACTIVE'};
  }
  if(NON_ACTION.test(description)){
    return {status:'REVIEW',reason:'NEGATED_OR_REMOVAL_ONLY_SCOPE'};
  }
  if(RESIDENTIAL_UNIT.test(description)){
    return {status:'REVIEW',reason:'RESIDENTIAL_UNIT_SCOPE_NOT_RESTAURANT'};
  }
  if(DEMOLITION.test(description)&&!POSITIVE_NON_DEMOLITION_WORK.test(description)){
    return {status:'REVIEW',reason:'DEMOLITION_ONLY_NO_INSTALLATION_SCOPE'};
  }
  if(!ACTION.test(description)){
    return {status:'NOT_SUPPORTED',reason:'NO_SPECIFIC_CONSTRUCTION_OR_INSTALLATION_ACTION'};
  }
  if(EXPLICIT_EQUIPMENT.test(description)){
    return {status:'EVIDENCED',scope:'EXPLICIT_KITCHEN_EQUIPMENT_OR_HOOD_SCOPE',reason:'DIRECT_SOURCE_TEXT',filingAgeDays:age};
  }
  if(KITCHEN_BUILDOUT.test(description)){
    return {status:'EVIDENCED',scope:'RESTAURANT_KITCHEN_CONSTRUCTION_SCOPE_ONLY',reason:'CONSTRUCTION_NOT_EQUIPMENT_ORDER',filingAgeDays:age};
  }
  return {status:'NOT_SUPPORTED',reason:'NO_RESTAURANT_EQUIPMENT_SCOPE'};
}
function premiseKey(address,borough){
  const a=norm(address),b=norm(borough);
  return a&&b?b+'|'+a:null;
}
function candidateRecentDated(candidate,observedAt){
  if(candidate?.lifecycleStage!=='HEALTH PRE-PERMIT'||
     candidate.deliverySuppressed===true||
     (candidate.crossCamisOperationalConflicts||[]).length)return false;
  const record=candidate.primaryRecord;
  if(record?.sourceSystem!=='DOHMH'||record.eventType!=='DOHMH_PRE_PERMIT_EVENT')return false;
  const age=dateAge(record.facts?.inspection_date,clock.nycDate(observedAt));
  return Number.isInteger(age)&&age>=0&&age<=30;
}
function bblConflict(candidate,record){
  const bbl=sourceText(candidate?.bbl),block=sourceText(record?.property?.block),lot=sourceText(record?.property?.lot);
  if(!/^\d{10}$/.test(bbl)||!/^\d+$/.test(block)||!/^\d+$/.test(lot))return false;
  return Number(bbl.slice(1,6))!==Number(block)||Number(bbl.slice(6))!==Number(lot);
}
function siteMatch(candidate,record){
  const a=premiseKey(candidate?.address,candidate?.borough);
  const b=premiseKey(record?.property?.address,record?.property?.borough);
  if(!a||!b||a!==b)return {matched:false,reason:'BOROUGH_OR_ADDRESS_MISMATCH'};
  const binA=sourceText(candidate?.bin),binB=sourceText(record?.property?.bin);
  if(binA&&binB&&binA!==binB)return {matched:false,reason:'BIN_CONFLICT'};
  if(bblConflict(candidate,record))return {matched:false,reason:'BBL_CONFLICT'};
  return {matched:true,basis:binA&&binB?'SAME_EXACT_ADDRESS_BOROUGH_AND_BIN':'SAME_EXACT_ADDRESS_AND_BOROUGH_ONLY',operatorIdentityProven:false};
}
function evidenceRow(record,classification,association){
  const f=record.facts||{};
  return {
    sourceSystem:'DOB_NOW',
    sourceDatasetId:SOURCE_ID,
    officialDatasetUrl:SOURCE_PAGE,
    sourceRecordId:record.sourceRecordId,
    jobFilingNumber:record.entityKeys.jobFilingNumber,
    sourceObservationId:record.sourceObservationId,
    rawFactFingerprint:record.rawFactFingerprint,
    filingDate:clock.calendarDate(f.filing_date),
    filingStatus:sourceText(f.filing_status),
    filingAgeDays:classification.filingAgeDays,
    jobDescription:sourceText(f.job_description).slice(0,1800),
    workOnFloor:sourceText(f.work_on_floor)||null,
    initialCost:typeof f.initial_cost_number==='number'?f.initial_cost_number:null,
    scope:classification.scope,
    association:association||'NO_VERIFIED_OPERATOR_ASSOCIATION',
    operatorIdentityProven:false,
    purchaseProven:false,
    installationCompletedProven:false
  };
}
function complete(batch){
  return !!(batch?.observation?.supportsAbsenceConclusion===true &&
    ['COMPLETE_NONEMPTY','VERIFIED_EMPTY'].includes(batch.observation.state));
}
function audit({dohmhBatch,dobBatch,observedAt}){
  if(!clock.instant(observedAt)||!complete(dohmhBatch)||!complete(dobBatch)||
     !dobBatch.records.every(r=>r.sourceSystem==='DOB_NOW') ||
     !dohmhBatch.records.every(r=>r.sourceSystem==='DOHMH')){
    return {version:VERSION,status:'SOURCE_INCOMPLETE_REVIEW',productionAuthorized:false,
      customerDeliveryAllowed:false,externalSendCalls:0,findings:[],counts:null};
  }
  const builder=require('./candidate-builder');
  const all=builder.applyCrossCamisOperationalConflicts(builder.buildDohmhCandidates(dohmhBatch.records));
  const dated=all.filter(c=>candidateRecentDated(c,observedAt));
  const bySite=new Map();
  for(const c of dated){const key=premiseKey(c.address,c.borough);
    if(!key)continue;if(!bySite.has(key))bySite.set(key,[]);bySite.get(key).push(c);
  }
  let direct=0,construction=0,inactiveOrUnknown=0,noScope=0,siteMatched=0,
    sharedPremise=0,binConflicts=0,otherPremise=0,duplicateConflicts=0;
  const byFiling=new Map(),findings=[];
  for(const record of dobBatch.records){
    const id=sourceText(record.sourceRecordId);
    if(byFiling.has(id)){
      const prior=byFiling.get(id);
      if(prior!==null&&prior!==record.rawFactFingerprint){duplicateConflicts++;byFiling.set(id,null);}
      continue;
    }
    byFiling.set(id,record.rawFactFingerprint);
  }
  // Never select a contradictory later amendment by row order.
  const conflictIds=new Set([...byFiling].filter(([,hash])=>hash===null).map(([id])=>id));
  for(const record of dobBatch.records){
    if(conflictIds.has(record.sourceRecordId))continue;
    if(byFiling.get(record.sourceRecordId)!==record.rawFactFingerprint)continue;
    byFiling.delete(record.sourceRecordId);
    const quality=classifyDobFiling(record,observedAt);
    if(quality.status==='REVIEW'){inactiveOrUnknown++;continue;}
    if(quality.status!=='EVIDENCED'){noScope++;continue;}
    if(quality.scope==='EXPLICIT_KITCHEN_EQUIPMENT_OR_HOOD_SCOPE')direct++;
    else construction++;
    const key=premiseKey(record.property?.address,record.property?.borough);
    const sites=key?(bySite.get(key)||[]):[];
    if(!sites.length){otherPremise++;continue;}
    if(sites.length!==1){sharedPremise++;continue;}
    const match=siteMatch(sites[0],record);
    if(!match.matched){if(match.reason==='BIN_CONFLICT'||match.reason==='BBL_CONFLICT')binConflicts++;continue;}
    siteMatched++;
    findings.push({...evidenceRow(record,quality,match.basis),
      site:{candidateEntityId:sites[0].entityId,sourceRecordId:sites[0].primaryRecord.sourceRecordId,
        inspectionDate:clock.calendarDate(sites[0].primaryRecord.facts?.inspection_date),
        associationLevel:match.basis,consumerIdentityProven:false}});
  }
  if(findings.length>MAX_MATCHED_FILINGS)throw Error('MATCHED_EVIDENCE_TOO_LARGE_FAIL_CLOSED');
  findings.sort((a,b)=>a.jobFilingNumber.localeCompare(b.jobFilingNumber));
  return {
    version:VERSION,status:'SOURCE_BOUNDED_RESEARCH_ONLY',
    observedAt,lookbackDays:90,
    sourceProvenance:{DOHMH:{sourceId:dohmhBatch.observation.sourceId,
      observationId:dohmhBatch.observation.observationId,
      queryScopeHash:dohmhBatch.observation.queryScopeHash},
      DOB_NOW:{sourceId:dobBatch.observation.sourceId,
      observationId:dobBatch.observation.observationId,
      queryScopeHash:dobBatch.observation.queryScopeHash,
      fetchedCount:dobBatch.observation.fetchedCount,
      rawPageHashes:dobBatch.observation.rawPageHashes}},
    counts:{dohmhCandidates:all.length,recentDatedPrepermitCandidates:dated.length,
      dobSourceRows:dobBatch.records.length,
      qualifyingDirectScopeFilings:direct,
      qualifyingKitchenConstructionFilings:construction,
      inactiveInvalidOrUnverifiable:inactiveOrUnknown,otherNoScope:noScope,
      siteMatchedFilings:siteMatched,unmatchedRelevantFilings:otherPremise,
      ambiguousMultiOccupant:sharedPremise,binOrBblConflict:binConflicts,
      duplicateFilingConflicts:duplicateConflicts},
    findings,
    validation:'DOB description proves a submitted project scope, not awarded contract, vendor need, completed installation or restaurant operator identity. Co-location never grants customer-score authority.',
    holdoutReleased:false,productionAuthorized:false,customerDeliveryAllowed:false,externalSendCalls:0
  };
}
module.exports={VERSION,SOURCE_ID,SOURCE_PAGE, classifyDobFiling,premiseKey,
  candidateRecentDated,bblConflict,siteMatch,evidenceRow,audit};
