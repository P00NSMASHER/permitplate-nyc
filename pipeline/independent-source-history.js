'use strict';

// Append-only identity memory for private, REVIEW_ONLY DOB/SLA research.
// A source re-fetch cannot manufacture a new opportunity or customer lead.
const crypto=require('node:crypto');
const VERSION='PermitPlate-independent-source-history-v1.0.0';
const SOURCE_VERSION='PermitPlate-independent-source-review-v1.0.0';

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
const hash=value=>crypto.createHash('sha256').update(stable(value)).digest('hex');
const instant=value=>{
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
};
function evidenceBody(item){
  const x=item||{};
  return {
    sourceSystem:x.sourceSystem,sourceRecordId:x.sourceRecordId,
    officialUrl:x.officialUrl,sourceEffectiveAt:x.sourceEffectiveAt,
    borough:x.borough,address:x.address,
    matchedResearchTerms:x.matchedResearchTerms,
    sourceExcerpt:x.sourceExcerpt,sourceStatus:x.sourceStatus,
    possibleRelatedCamis:x.possibleRelatedCamis,
    needsIdentityReview:x.needsIdentityReview
  };
}
const evidenceHash=item=>hash(evidenceBody(item));
function seal(ledger){
  const core={...ledger};
  delete core.ledgerFingerprint;
  return {...core,ledgerFingerprint:hash(core)};
}
function verifyReview(review){
  const r=review||{};
  const failures=[];
  if(r.version!==SOURCE_VERSION||r.status!=='REVIEW_ONLY'||
     r.customerDeliveryAllowed!==false||r.externalSendCalls!==0||
     !instant(r.observedAt)||!Array.isArray(r.items)||
     !Number.isInteger(r.omittedByLimit)||r.omittedByLimit<0||
     r.storedCount!==r.items.length||
     r.totalResearchMatches!==r.storedCount+r.omittedByLimit){
    failures.push('INDEPENDENT_REVIEW_RECEIPT_INVALID');
  }
  const {artifactFingerprint,...body}=r;
  if(artifactFingerprint!==hash(body))failures.push('INDEPENDENT_REVIEW_FINGERPRINT_INVALID');
  const ids=new Set();
  for(const x of r.items||[]){
    if(!x||!['DOB_NOW','SLA_PENDING'].includes(x.sourceSystem)||
       !String(x.sourceRecordId||'').startsWith(x.sourceSystem+':')||
       x.customerDeliveryAllowed!==false||
       x.reviewStatus!=='REVIEW_ONLY_UNLINKED'||
       !instant(x.sourceEffectiveAt)||
       ids.has(x.sourceRecordId)){
      failures.push('INDEPENDENT_REVIEW_ITEM_INVALID');
    }else ids.add(x.sourceRecordId);
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function validate(ledger){
  const l=ledger||{},failures=[];
  if(l.version!==VERSION||!instant(l.initializedAt)||!instant(l.observedAt)||
     !/^[a-f0-9]{64}$/.test(l.sourceReviewFingerprint||'')||
     !l.entries||typeof l.entries!=='object'||Array.isArray(l.entries)||
     Date.parse(l.initializedAt)>Date.parse(l.observedAt)){
    failures.push('INDEPENDENT_HISTORY_FORMAT_INVALID');
  }
  const {ledgerFingerprint,...body}=l;
  if(ledgerFingerprint!==hash(body))failures.push('INDEPENDENT_HISTORY_FINGERPRINT_INVALID');
  for(const [id,x] of Object.entries(l.entries||{})){
    if(!x||x.sourceRecordId!==id||!['DOB_NOW','SLA_PENDING'].includes(x.sourceSystem)||
       !id.startsWith(x.sourceSystem+':')||
       !/^[a-f0-9]{64}$/.test(x.evidenceFingerprint||'')||
       !instant(x.firstObservedAt)||!instant(x.lastObservedAt)||
       Date.parse(x.firstObservedAt)<Date.parse(l.initializedAt)||
       Date.parse(x.firstObservedAt)>Date.parse(x.lastObservedAt)||
       Date.parse(x.lastObservedAt)>Date.parse(l.observedAt)||
       !['IN_CURRENT_REVIEW','OUT_OF_CURRENT_REVIEW_WINDOW'].includes(x.presenceState)||
       (x.latestContextChange!=null&&
       (x.latestContextChange.sourceRecordId!==id||
        !instant(x.latestContextChange.observedAt)||
        Date.parse(x.latestContextChange.observedAt)>Date.parse(x.lastObservedAt)||
        x.latestContextChange.eventId!=='CTX:'+hash({
          sourceRecordId:id,
          from:x.latestContextChange.fromFingerprint,
          to:x.latestContextChange.toFingerprint,
          observedAt:x.latestContextChange.observedAt
        }).slice(0,24))))){
      failures.push('INDEPENDENT_HISTORY_ENTRY_INVALID');
    }
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function bootstrap(review){
  const v=verifyReview(review);
  if(!v.valid||review.omittedByLimit!==0){
    return {status:'REVIEW',failures:[...v.failures,'INDEPENDENT_BASELINE_NOT_COMPLETE']};
  }
  const observedAt=instant(review.observedAt);
  const entries={};
  for(const item of review.items){
    entries[item.sourceRecordId]={
      sourceSystem:item.sourceSystem,sourceRecordId:item.sourceRecordId,
      firstObservedAt:observedAt,lastObservedAt:observedAt,
      presenceState:'IN_CURRENT_REVIEW',
      evidenceFingerprint:evidenceHash(item),
      latestContextChange:null
    };
  }
  return {
    status:'BASELINED',
    ledger:seal({
      version:VERSION,initializedAt:observedAt,observedAt,
      sourceReviewFingerprint:review.artifactFingerprint,entries
    }),
    newObservationIds:[],contextChangeIds:[]
  };
}
function advance(previous,review){
  const check=verifyReview(review);
  if(!check.valid)return {status:'REVIEW',failures:check.failures};
  if(!previous)return bootstrap(review);
  const v=validate(previous);
  if(!v.valid)return {status:'REVIEW',failures:v.failures};
  const now=instant(review.observedAt);
  if(Date.parse(now)<Date.parse(previous.observedAt))return {
    status:'REVIEW',failures:['INDEPENDENT_HISTORY_TIME_REVERSED']
  };
  if(now===previous.observedAt&&review.artifactFingerprint!==previous.sourceReviewFingerprint){
    return {status:'REVIEW',failures:['INDEPENDENT_HISTORY_SAME_TIME_REWRITE']};
  }
  const entries=structuredClone(previous.entries),seen=new Set();
  const newObservationIds=[],contextChangeIds=[];
  for(const item of review.items){
    const id=item.sourceRecordId,prior=entries[id];
    seen.add(id);
    const fingerprint=evidenceHash(item);
    if(!prior){
      entries[id]={
        sourceSystem:item.sourceSystem,sourceRecordId:id,
        firstObservedAt:now,lastObservedAt:now,
        presenceState:'IN_CURRENT_REVIEW',
        evidenceFingerprint:fingerprint,
        latestContextChange:null
      };
      newObservationIds.push(id);
    }else{
      const updated={...prior,lastObservedAt:now,presenceState:'IN_CURRENT_REVIEW',
        evidenceFingerprint:fingerprint};
      if(fingerprint!==prior.evidenceFingerprint){
        const core={
          sourceRecordId:id,
          from:prior.evidenceFingerprint,to:fingerprint,observedAt:now
        };
        updated.latestContextChange={
          observedAt:now,sourceRecordId:id,
          fromFingerprint:prior.evidenceFingerprint,
          toFingerprint:fingerprint,eventId:'CTX:'+hash(core).slice(0,24)
        };
        contextChangeIds.push(id);
      }
      entries[id]=updated;
    }
  }
  // A 300-item capped view cannot establish absence of omitted records.
  if(review.omittedByLimit===0){
    for(const [id,entry] of Object.entries(entries)){
      if(!seen.has(id))entries[id]={...entry,presenceState:'OUT_OF_CURRENT_REVIEW_WINDOW'};
    }
  }
  const ledger=seal({
    version:VERSION,initializedAt:previous.initializedAt,observedAt:now,
    sourceReviewFingerprint:review.artifactFingerprint,entries
  });
  return {
    status:newObservationIds.length||contextChangeIds.length?'ADVANCED':'NO_NEW_REVIEW_EVENTS',
    ledger,newObservationIds,contextChangeIds
  };
}
function annotate(review,ledger,newIds=[],changeIds=[]){
  const v=validate(ledger),check=verifyReview(review);
  if(!v.valid||!check.valid||ledger.observedAt!==review.observedAt){
    return {status:'REVIEW',failures:[...v.failures,...check.failures,'INDEPENDENT_REVIEW_HISTORY_MISMATCH']};
  }
  const first=new Set(newIds),changed=new Set(changeIds);
  const body={...review,
    historyVersion:VERSION,
    historyFingerprint:ledger.ledgerFingerprint,
    newResearchObservations:first.size,
    sourceContextChangesForReview:changed.size,
    // Never claim a new filing, project or buyer. Only monitoring history.
    items:review.items.map(item=>{
      const entry=ledger.entries[item.sourceRecordId];
      return {...item,
        firstObservedByThisReviewAt:entry.firstObservedAt,
        firstObservedByPermitPlateAt:entry.firstObservedAt,
        monitoringStatus:first.has(item.sourceRecordId)?'NEW_TO_PERMITPLATE':
          changed.has(item.sourceRecordId)?'SOURCE_CONTEXT_CHANGED_FOR_REVIEW':
          'ALREADY_OBSERVED',
        lastSourceContextChangeAt:entry.latestContextChange?.observedAt||null,
        customerDeliveryAllowed:false
      };
    })
  };
  delete body.artifactFingerprint;
  return {...body,artifactFingerprint:hash(body)};
}
module.exports={VERSION,SOURCE_VERSION,stable,hash,instant,evidenceBody,evidenceHash,
  seal,validate,verifyReview,bootstrap,advance,annotate};
