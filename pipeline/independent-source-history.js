'use strict';

// Append-only identity memory for private, REVIEW_ONLY DOB/SLA research.
// A source re-fetch cannot manufacture a new opportunity or customer lead.
const crypto=require('node:crypto');
const scopeEvidence=require('./construction-scope-evidence');
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
    // Only official record content may produce a SOURCE_CONTEXT change.
    // A new CAMIS co-location / unresolved identity bridge is not a filing edit.
    matchedResearchTerms:x.matchedResearchTerms,
    sourceExcerpt:x.sourceExcerpt,sourceStatus:x.sourceStatus
  };
}
const evidenceHash=item=>hash(evidenceBody(item));
function fullScopeFingerprint(item){
  if(item?.sourceSystem!=='DOB_NOW'||item.constructionScope==null)return null;
  return scopeEvidence.semanticScopeFingerprint(item.constructionScope);
}
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
       ids.has(x.sourceRecordId)||
       (x.sourceSystem==='DOB_NOW'&&x.constructionScope!=null&&
         !scopeEvidence.validate(x.constructionScope).valid)){
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
       (x.fullScopeFingerprint!=null&&!/^[a-f0-9]{64}$/.test(x.fullScopeFingerprint))||
       (x.fullScopeFingerprintVersion!=null&&
         x.fullScopeFingerprintVersion!==scopeEvidence.SEMANTIC_VERSION)||
       (x.fullScopeFingerprintVersion&&!x.fullScopeFingerprint)||
       (x.scopeBaselineMigratedAt!=null&&(!instant(x.scopeBaselineMigratedAt)||
         Date.parse(x.scopeBaselineMigratedAt)<Date.parse(l.initializedAt)||
         Date.parse(x.scopeBaselineMigratedAt)>Date.parse(x.lastObservedAt)))||
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
        }).slice(0,24)))){
      failures.push('INDEPENDENT_HISTORY_ENTRY_INVALID');
    }
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function rebaseLegacyScopeHistory(previous,priorReview){
  const v=validate(previous);
  if(!v.valid)return {valid:false,failures:v.failures};
  const entries=structuredClone(previous.entries);
  const legacy=Object.values(entries).filter(x=>
    x.fullScopeFingerprint &&
    x.fullScopeFingerprintVersion!==scopeEvidence.SEMANTIC_VERSION);
  if(!legacy.length)return {valid:true,ledger:previous,rebasedCount:0,
    legacyAlertCaveats:0};
  const proof=verifyReview(priorReview);
  if(!proof.valid||priorReview.historyFingerprint!==previous.ledgerFingerprint||
     priorReview.observedAt!==previous.observedAt){
    return {valid:false,failures:['INDEPENDENT_SCOPE_PRIOR_REVIEW_BINDING_INVALID']};
  }
  const byId=new Map(priorReview.items.map(x=>[x.sourceRecordId,x]));
  let rebased=0,caveats=0;
  for(const entry of legacy){
    const old=byId.get(entry.sourceRecordId);
    // An out-of-window history entry stays untouched until an independently
    // bound prior review is available. Never invent a baseline from new data.
    if(!old)continue;
    if(old.constructionScope?.scopeFingerprint!==entry.fullScopeFingerprint||
       !scopeEvidence.validate(old.constructionScope).valid){
      return {valid:false,failures:['INDEPENDENT_SCOPE_OLD_RECEIPT_MISMATCH']};
    }
    const fresh=fullScopeFingerprint(old);
    if(!fresh)return {valid:false,failures:['INDEPENDENT_SCOPE_REBASE_INVALID']};
    const updated={...entry,
      fullScopeFingerprint:fresh,
      fullScopeFingerprintVersion:scopeEvidence.SEMANTIC_VERSION,
      scopeSemanticRebasedAt:previous.observedAt};
    // Older observations may have been falsely tagged changed because the
    // old hash included a changing scan ID. Retain the original audit event,
    // but visibly distrust its interpretation until independently reviewed.
    if(entry.latestContextChange?.observedAt===previous.observedAt &&
       entry.scopeBaselineMigratedAt &&
       Date.parse(entry.scopeBaselineMigratedAt)<Date.parse(previous.observedAt)){
      updated.legacyScopeAlertReliability=
        'VOLATILE_OBSERVATION_ID_HASH_HISTORICAL_ALERT_NOT_VERIFIED';
      caveats++;
    }
    entries[entry.sourceRecordId]=updated;rebased++;
  }
  return {
    valid:true,ledger:seal({...previous,entries}),
    rebasedCount:rebased,legacyAlertCaveats:caveats
  };
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
      ...(fullScopeFingerprint(item)?{
        fullScopeFingerprint:fullScopeFingerprint(item),
        fullScopeFingerprintVersion:scopeEvidence.SEMANTIC_VERSION
      }:{}),
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
  let scopeBaselineMigratedCount=0,scopeChangeCount=0;
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
        ...(fullScopeFingerprint(item)?{
          fullScopeFingerprint:fullScopeFingerprint(item),
          fullScopeFingerprintVersion:scopeEvidence.SEMANTIC_VERSION
        }:{}),
        latestContextChange:null
      };
      newObservationIds.push(id);
    }else{
      const full=fullScopeFingerprint(item);
      const updated={...prior,lastObservedAt:now,presenceState:'IN_CURRENT_REVIEW',
        evidenceFingerprint:fingerprint};
      if(prior.fullScopeFingerprint &&
          prior.fullScopeFingerprintVersion!==scopeEvidence.SEMANTIC_VERSION){
        return {status:'REVIEW',failures:['INDEPENDENT_SCOPE_SEMANTIC_REBASE_REQUIRED']};
      }
      if(prior.fullScopeFingerprint && !full){
        return {status:'REVIEW',failures:['INDEPENDENT_FULL_SCOPE_EVIDENCE_MISSING']};
      }
      if(full){
        updated.fullScopeFingerprint=full;
        updated.fullScopeFingerprintVersion=scopeEvidence.SEMANTIC_VERSION;
        // The first post-upgrade complete scope is a migration baseline,
        // NOT a newly detected construction event.
        if(!prior.fullScopeFingerprint){
          updated.scopeBaselineMigratedAt=now;
          scopeBaselineMigratedCount++;
        }
      }
      const legacyChanged=fingerprint!==prior.evidenceFingerprint;
      const scopeChanged=Boolean(full&&prior.fullScopeFingerprint&&
        full!==prior.fullScopeFingerprint);
      if(legacyChanged||scopeChanged){
        const from=scopeChanged?
          hash({legacy:prior.evidenceFingerprint,scope:prior.fullScopeFingerprint}):
          prior.evidenceFingerprint;
        const to=scopeChanged?
          hash({legacy:fingerprint,scope:full}):fingerprint;
        const core={sourceRecordId:id,from,to,observedAt:now};
        updated.latestContextChange={
          observedAt:now,sourceRecordId:id,
          fromFingerprint:from,toFingerprint:to,
          eventId:'CTX:'+hash(core).slice(0,24)
        };
        contextChangeIds.push(id);
        if(scopeChanged)scopeChangeCount++;
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
    ledger,newObservationIds,contextChangeIds,
    scopeBaselineMigratedCount,scopeChangeCount
  };
}
function annotate(review,ledger,newIds=[],changeIds=[]){
  const v=validate(ledger),check=verifyReview(review);
  if(!v.valid||!check.valid||ledger.observedAt!==review.observedAt){
    return {status:'REVIEW',failures:[...v.failures,...check.failures,'INDEPENDENT_REVIEW_HISTORY_MISMATCH']};
  }
  if(review.items.some(item=>!ledger.entries[item.sourceRecordId]||
      ledger.entries[item.sourceRecordId].evidenceFingerprint!==evidenceHash(item)||
      (ledger.entries[item.sourceRecordId].fullScopeFingerprint!=null&&
        ledger.entries[item.sourceRecordId].fullScopeFingerprint!==fullScopeFingerprint(item)))){
    return {status:'REVIEW',failures:['INDEPENDENT_REVIEW_HISTORY_IDENTITY_DRIFT']};
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
        lastSourceContextChangeAt:entry.legacyScopeAlertReliability?
          null:(entry.latestContextChange?.observedAt||null),
        unverifiedLegacyScopeAlertAt:entry.legacyScopeAlertReliability?
          entry.latestContextChange?.observedAt||null:null,
        legacyScopeAlertCaveat:entry.legacyScopeAlertReliability||null,
        customerDeliveryAllowed:false
      };
    })
  };
  delete body.artifactFingerprint;
  return {...body,artifactFingerprint:hash(body)};
}
module.exports={VERSION,SOURCE_VERSION,stable,hash,instant,evidenceBody,evidenceHash,
  fullScopeFingerprint,rebaseLegacyScopeHistory,
  seal,validate,verifyReview,bootstrap,advance,annotate};
