'use strict';

// Owner-authorized production INTERNAL research scoring over genuine NYC public
// sources. This module NEVER issues customer-authorized score receipts.
// Calibration/precision labels, buyers, payment and outbound transport are
// deliberately absent. The $79/mo paid lane stays founder-curated NO SCORE.
const crypto=require('node:crypto');
const authority=require('../scoring/nyc-v4-internal-owner-authorization.json');
const v4=require('./shadow-scoring-v4');
const v3=require('./shadow-scoring-v3');
const eventTime=require('./event-time');
const categoryEvidence=require('./category-evidence');
const curated=require('./founder-curated-offer');
const profiles=require('./subscriber-profile');
const materialChange=require('./material-change');

const VERSION='PermitPlate-NYC-internal-production-relevance-v1.0.0';
const MODE='V4_EVENT_TIME_SOURCE_RELEVANCE_PRIVATE_NO_SEND';
const CATEGORIES=Object.freeze(v4.CATEGORIES.slice());
const KEYS=Object.freeze(['DOHMH','DOB_NOW','SLA_PENDING']);
const CAPS=Object.freeze({
  SOURCE_KEYWORD_CONTEXT:79,
  RELATED_OFFICIAL_ACTIVITY:54,
  APPLICANT_CONTEXT_ONLY:39
});
const OWNER_AUTHORIZATION=authority;

function stable(v){
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function hash(v){return crypto.createHash('sha256').update(stable(v)).digest('hex');}
function count(object,value){const k=String(value||'UNKNOWN');object[k]=(object[k]||0)+1;}
function validateOwnerAuthority(record){
  const a=record||{},failures=[];
  if(a.version!=='PermitPlate-NYC-internal-scoring-authorization-v1.0.0'||
     a.authorizationId!=='NYC-V4-INTERNAL-SOURCE-RELEVANCE-2026-10-21'||
     a.status!=='OWNER_AUTHORIZED_INTERNAL_PRODUCTION'||
     a.ownerAuthorizedOn!=='2026-10-21')failures.push('INTERNAL_OWNER_AUTHORIZATION_INVALID');
  if(a.mode!==MODE||a.scorerVersion!==v4.SHADOW_SCORING_VERSION||
     a.internalScoringAllowed!==true||a.privateResearchStateOnly!==true){
    failures.push('INTERNAL_SCORING_MODE_NOT_APPROVED');
  }
  if(a.externalTransportAllowed!==false||
     a.customerScoredLeadDeliveryAllowed!==false||
     a.customerPurchaseIntentClaimsAllowed!==false||
     a.estimatedBuyerPrecisionValidated!==false||
     a.independenceOrHumanLabelsProvided!==false||
     a.sourceEventRequired!==true||a.unknownBusinessEventDateHeld!==true||
     a.sourceIntegrityFailClosed!==true||a.legacyV3PromotionUnaffected!==true){
    failures.push('INTERNAL_SCORING_BOUNDARY_INVALID');
  }
  return {valid:failures.length===0,failures,
    mode:MODE,internalScoringAllowed:failures.length===0,
    externalTransportAllowed:false,buyerPrecisionKnown:false};
}
function emptyReport(input,failures){
  const graph=input&&input.publicGraph||{};
  const body={
    version:VERSION,mode:MODE,status:'REVIEW',
    ownerAuthorizationId:authority.authorizationId,
    observedAt:input?.observedAt||null,
    graphDigest:graph.graphDigest||null,
    candidateCount:Array.isArray(graph.candidates)?graph.candidates.length:0,
    internalProductionAuthorized:false,productionAuthorized:false,
    customerDeliveryAllowed:false,externalSendCalls:0,privateResearchStateOnly:true,
    knownEventScoredCount:0,unknownEventHeldCount:0,suppressedCount:0,
    excludedFitCount:0,reviewHeldCount:0,sourceBasisCounts:{},
    researchRows:[],
    accuracy:{verifiedBuyerPrecision:null,verifiedBuyerRecall:null,
      independentBuyerLabels:0,verifiedSales:0},
    failures:[...new Set(failures)].sort()
  };
  return {...body,fingerprint:hash(body)};
}
function verifiedSource(publicGraph,batches){
  for(const key of KEYS){
    const b=batches&&batches[key],obs=publicGraph?.sourceObservations?.[key];
    if(!b||!obs||!Array.isArray(b.records)||
       !['COMPLETE_NONEMPTY','VERIFIED_EMPTY'].includes(obs.state)||
       obs.state==='VERIFIED_EMPTY'&&b.records.length!==0||
       key==='DOHMH'&&obs.state!=='COMPLETE_NONEMPTY'||
       obs.sourceFresh!==true||obs.transportOk!==true||
       obs.cursorClosed!==true||
       obs.supportsAbsenceConclusion!==true||
       !Number.isInteger(obs.publisherCount)||
       obs.fetchedCount!==b.records.length||
       obs.publisherCount!==b.records.length||
       obs.observationId!==b.observation?.observationId||
       obs.state!==b.observation?.state){
      return false;
    }
  }
  return true;
}
function candidateComparable(c){
  return {
    entityId:c?.entityId||null,
    camis:c?.camis||null,
    borough:c?.borough??null,
    address:c?.address||null,
    lifecycleStage:c?.lifecycleStage||null,
    sourceSystems:Array.isArray(c?.sourceSystems)?c.sourceSystems.slice().sort():[],
    sourceCount:c?.sourceCount??null,
    deliverySuppressed:c?.deliverySuppressed===true,
    suppressionReasons:(c?.suppressionReasons||[]).slice().sort(),
    materialityFingerprint:c?.materiality?.fingerprint||null
  };
}
function scoreSnapshot(input){
  const x=input||{},pub=x.publicGraph||{},full=x.fullGraph||{},
    batches=x.batches||{},observedAt=x.observedAt||null,failures=[];
  failures.push(...validateOwnerAuthority(authority).failures);
  if(pub.passed!==true||pub.graphState!=='COMPLETE'||full.graphState!=='COMPLETE'||
      !pub.graphDigest||pub.graphDigest!==full.graphDigest||
      !Array.isArray(pub.candidates)||!Array.isArray(full.candidates)||
      pub.candidates.length!==full.candidates.length||
      pub.candidates.length!==full.metrics?.candidateCount||
      pub.candidates.length===0){
    failures.push('GRAPH_DIGEST_MISMATCH');
  }
  if(!eventTime.instant(observedAt)||pub.observedAt!==observedAt){
    failures.push('OBSERVATION_TIME_INVALID');
  }
  if(!verifiedSource(pub,batches))failures.push('OFFICIAL_SOURCE_INCOMPLETE_OR_STALE');
  const publicIds=new Set(),publicById=new Map();
  for(const c of pub.candidates||[]){
    if(!c?.entityId||publicIds.has(c.entityId)){
      failures.push('SOURCE_GRAPH_CANDIDATE_MISMATCH');break;
    }
    publicIds.add(c.entityId);publicById.set(c.entityId,c);
    if(!materialChange.valid(c.materiality)){
      failures.push('SOURCE_GRAPH_CANDIDATE_MISMATCH');break;
    }
  }
  for(const c of full.candidates||[]){
    const p=publicById.get(c.entityId);
    const material=materialChange.describe(c);
    if(!p||stable(candidateComparable({...c,materiality:material}))!==
      stable(candidateComparable(p))){
      failures.push('SOURCE_GRAPH_CANDIDATE_MISMATCH');break;
    }
  }
  if(failures.length)return emptyReport(x,failures);

  const records=KEYS.flatMap(key=>batches[key].records);
  const byId=v3.sourceMap(records);
  const researchRows=[],sourceBasisCounts={};
  let suppressedCount=0,unknownEventHeldCount=0,excludedFitCount=0,reviewHeldCount=0;
  for(const c of full.candidates){
    const p=publicById.get(c.entityId);
    if(c.deliverySuppressed===true||
       !profiles.BOROUGH_ORDER.includes(c.borough)||
       (c.crossCamisOperationalConflicts||[]).length||
       !/^CAMIS:\d+$/.test(String(c.entityId||''))||
       !c.primaryRecord||c.primaryRecord.sourceSystem!=='DOHMH'||
       String(c.camis||'')!==String(c.primaryRecord.entityKeys?.camis||'')){
      suppressedCount++;continue;
    }
    const calc=v4.computeShadowScores(c,byId,observedAt);
    if(calc.productionAuthorized!==false||calc.status!=='SHADOW_SCORED'||
       !eventTime.valid(calc.eventChronology)){
      reviewHeldCount++;continue;
    }
    if(calc.fitReceipt?.fit==='EXCLUDE'||calc.bestVendorFit==='SUPPRESSED'){
      excludedFitCount++;continue;
    }
    if(calc.eventChronology.status==='UNKNOWN'){
      // Never use source record_date, refresh timestamp or first observation
      // as proof of the restaurant's application or opening time.
      if(calc.eventChronology.recencyPoints!==0){
        return emptyReport(x,['UNKNOWN_SOURCE_EVENT_AWARDED_RECENCY']);
      }
      unknownEventHeldCount++;continue;
    }
    if(calc.eventChronology.status!=='KNOWN'||
       !['DOHMH_INSPECTION_DATE','SLA_APPLICATION_RECEIVED_DATE',
         'DOB_INITIAL_FILING_DATE'].includes(calc.eventChronology.eventDateBasis)){
      reviewHeldCount++;continue;
    }
    // A dated source event must be bound to a current, accepted official URL
    // for this same CAMIS; do not trust arbitrary sourceUrl on a raw row.
    const eventUrl=calc.eventChronology.eventSourceUrl;
    if(!eventUrl||!categoryEvidence.knownUrls(p).includes(eventUrl)){
      reviewHeldCount++;continue;
    }
    const scores={},categoryBases={},categoryEvidenceFingerprints={};
    let invalid=false;
    for(const category of CATEGORIES){
      const evidence=categoryEvidence.classify(p,category);
      const value=calc.scores?.[category];
      if(evidence.status==='REVIEW'||evidence.manualReviewRequired!==true||
         !Object.prototype.hasOwnProperty.call(CAPS,evidence.status)||
         !Number.isInteger(value)||value<0||value>100){
        invalid=true;break;
      }
      categoryBases[category]=evidence.status;
      categoryEvidenceFingerprints[category]=evidence.evidenceFingerprint;
      // An official source keyword is still NOT a purchase order. Non-category
      // applicant context cannot receive a 60+ "hot lead" score.
      scores[category]=Math.min(value,CAPS[evidence.status]);
    }
    if(invalid){reviewHeldCount++;continue;}
    for(const basis of Object.values(categoryBases))count(sourceBasisCounts,basis);
    const core={
      scoringVersion:v4.SHADOW_SCORING_VERSION,
      entityId:c.entityId,camis:c.camis,
      borough:c.borough,lifecycleStage:c.lifecycleStage,
      eventDate:calc.eventChronology.latestKnownEventDate,
      eventBasis:calc.eventChronology.eventDateBasis,
      eventSourceRecordId:calc.eventChronology.eventSourceRecordId,
      officialSourceUrl:eventUrl,
      chronologyFingerprint:calc.eventChronology.fingerprint,
      sourceRelevanceScoreCap:Math.max(...Object.values(scores)),
      scores,categoryBases,categoryEvidenceFingerprints,
      internalProductionAuthorized:true,productionAuthorized:false,
      customerDeliveryAllowed:false,buyerNeedVerified:false,
      confirmedOpening:false
    };
    researchRows.push({...core,internalScoreId:'INTERNAL-V4:'+hash({
      version:VERSION,ownerAuthorizationId:authority.authorizationId,
      graphDigest:pub.graphDigest,observedAt,core
    }).slice(0,24)});
  }
  researchRows.sort((a,b)=>b.sourceRelevanceScoreCap-a.sourceRelevanceScoreCap||
    b.eventDate.localeCompare(a.eventDate)||a.entityId.localeCompare(b.entityId));
  const body={
    version:VERSION,mode:MODE,status:'ACTIVE_INTERNAL_PRODUCTION',
    ownerAuthorizationId:authority.authorizationId,observedAt,
    graphDigest:pub.graphDigest,
    sourceObservationIds:Object.fromEntries(KEYS.map(k=>
      [k,pub.sourceObservations[k].observationId])),
    candidateCount:pub.candidates.length,
    internalProductionAuthorized:true,productionAuthorized:false,
    customerDeliveryAllowed:false,externalSendCalls:0,privateResearchStateOnly:true,
    knownEventScoredCount:researchRows.length,unknownEventHeldCount,
    suppressedCount,excludedFitCount,reviewHeldCount,
    sourceBasisCounts,researchRows,
    accuracy:{verifiedBuyerPrecision:null,verifiedBuyerRecall:null,
      independentBuyerLabels:0,verifiedSales:0},
    failures:[],
    limitations:[
      'Source-relevance scores prioritize private research only. They are NOT buyer probabilities, purchase intent, verified openings, approved vendor needs or lead precision.',
      'Uninspected applicants with unknown business-event dates are withheld. Government extraction dates do not establish filing dates.',
      'A scored row cannot be used as a customer or transport-authorized score receipt. Founder assessment, customer authorization and real buyer labels remain separate.',
      'Scores are deterministic heuristics with category-evidence ceilings, not an empirically calibrated buyer model.'
    ]
  };
  return {...body,fingerprint:hash(body)};
}
function validateSnapshot(snapshot) {
  const s=snapshot||{},failures=[];
  if(s.version!==VERSION||s.mode!==MODE||s.status!=='ACTIVE_INTERNAL_PRODUCTION'||
     s.ownerAuthorizationId!==authority.authorizationId||
     s.internalProductionAuthorized!==true||s.productionAuthorized!==false||
     s.customerDeliveryAllowed!==false||s.externalSendCalls!==0||
     s.privateResearchStateOnly!==true){
    failures.push('INTERNAL_SCORING_SCOPE_INVALID');
  }
  const rows=Array.isArray(s.researchRows)?s.researchRows:[];
  const entityIds=new Set();
  let prior=null;
  for(const r of rows){
    if(entityIds.has(r?.entityId))failures.push('INTERNAL_SCORING_DUPLICATE_ENTITY');
    entityIds.add(r?.entityId);
    if(r?.internalProductionAuthorized!==true||
       r?.productionAuthorized!==false||r?.customerDeliveryAllowed!==false||
       r?.buyerNeedVerified!==false||r?.confirmedOpening!==false||
       r?.scoringVersion!==v4.SHADOW_SCORING_VERSION||
       !eventTime.calendarDate(r?.eventDate)||
       !/^CAMIS:\d+$/.test(String(r?.entityId||''))||
       !/^INTERNAL-V4:[a-f0-9]{24}$/.test(String(r?.internalScoreId||''))||
       !profiles.BOROUGH_ORDER.includes(r?.borough)||
       !curated.officialSourceUrl(r?.officialSourceUrl)||
       !String(r?.eventSourceRecordId||'').startsWith(
         r.eventBasis==='DOHMH_INSPECTION_DATE'?'DOHMH:'+r.camis+':':
         r.eventBasis==='SLA_APPLICATION_RECEIVED_DATE'?'SLA_PENDING:':
         r.eventBasis==='DOB_INITIAL_FILING_DATE'?'DOB_NOW:':'INVALID:')||
       CATEGORIES.some(k=>!Number.isInteger(r?.scores?.[k])||
         !Object.prototype.hasOwnProperty.call(CAPS,r?.categoryBases?.[k])||
         r.scores[k]<0||r.scores[k]>CAPS[r.categoryBases[k]]||
         !/^[a-f0-9]{64}$/.test(r?.categoryEvidenceFingerprints?.[k]||''))||
       Object.keys(r?.scores||{}).length!==CATEGORIES.length||
       Object.keys(r?.categoryBases||{}).length!==CATEGORIES.length||
       Object.keys(r?.categoryEvidenceFingerprints||{}).length!==CATEGORIES.length||
       r.sourceRelevanceScoreCap!==Math.max(...Object.values(r.scores))){
      failures.push('INTERNAL_SCORING_ROWS_INVALID');
    }
    if(prior&&(r.sourceRelevanceScoreCap>prior.sourceRelevanceScoreCap||
        r.sourceRelevanceScoreCap===prior.sourceRelevanceScoreCap&&
        (r.eventDate>prior.eventDate||
         r.eventDate===prior.eventDate&&r.entityId<prior.entityId))){
      failures.push('INTERNAL_SCORING_SORT_ORDER_INVALID');
    }
    prior=r;
  }
  if(rows.length!==s.knownEventScoredCount||
     Object.values(s.sourceBasisCounts||{}).reduce((a,n)=>a+Number(n||0),0)!==
       rows.length*CATEGORIES.length){
    failures.push('INTERNAL_SCORING_ROWS_INVALID');
  }
  if(!Number.isInteger(s.candidateCount)||s.candidateCount<1||
     ![s.knownEventScoredCount,s.unknownEventHeldCount,s.suppressedCount,
       s.excludedFitCount,s.reviewHeldCount].every(x=>Number.isInteger(x)&&x>=0)||
     s.knownEventScoredCount+s.unknownEventHeldCount+s.suppressedCount+
     s.excludedFitCount+s.reviewHeldCount!==s.candidateCount){
    failures.push('INTERNAL_SCORING_COVERAGE_INVALID');
  }
  if(s.accuracy?.verifiedBuyerPrecision!==null||
     s.accuracy?.verifiedBuyerRecall!==null||
     s.accuracy?.independentBuyerLabels!==0||
     s.accuracy?.verifiedSales!==0){
    failures.push('INTERNAL_SCORING_ACCURACY_CLAIM_UNSUPPORTED');
  }
  if(!Array.isArray(s.failures)||s.failures.length||
     !eventTime.instant(s.observedAt)||!s.graphDigest){
    failures.push('INTERNAL_SCORING_PROVENANCE_INVALID');
  }
  const {fingerprint,...body}=s;
  if(!/^[a-f0-9]{64}$/.test(fingerprint||'')||hash(body)!==fingerprint){
    failures.push('INTERNAL_SCORING_FINGERPRINT_INVALID');
  }
  return {valid:failures.length===0,failures};
}

module.exports={VERSION,MODE,CATEGORIES,KEYS,CAPS,OWNER_AUTHORIZATION,stable,hash,
  validateOwnerAuthority,verifiedSource,candidateComparable,scoreSnapshot,validateSnapshot};
