'use strict';

// Persistent private triage history for unapproved cross-source hypotheses.
// Every relationship remains a hypothesis regardless of monitoring status.
const identity=require('./identity-bridge-review');
const {hash}=require('./independent-source-history');

const VERSION='PermitPlate-identity-triage-history-v1.0.0';
const CURRENT='IN_CURRENT_REVIEW';
const ABSENT='OUT_OF_CURRENT_REVIEW_WINDOW';
const STATUSES=new Set([CURRENT,ABSENT]);
const LABELS=Object.freeze({
  baseline:'BASELINE_EXISTING',
  new:'NEW_IDENTITY_HYPOTHESIS',
  changed:'SOURCE_CONTEXT_RECHECK',
  existing:'ALREADY_TRACKED'
});
function instant(value){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
// Exclude volatile read timestamps, graph receipt fingerprints, observation
// IDs and reviewer labels. Track actual printed source/premise/identity context.
function context(proposal){
  const p=proposal||{};
  return {
    proposalId:p.proposalId,
    kind:p.kind,sourceRecordIds:p.sourceRecordIds,
    candidateEntityId:p.candidateEntityId||null,
    premiseKey:p.premiseKey,
    nameAgreement:p.nameAgreement,
    reviewClass:p.reviewClass,
    competingCamisCount:p.competingCamisCount,
    candidateName:p.candidateName||null,
    sourceTradeName:p.sourceTradeName||null,
    sourceOwnerName:p.sourceOwnerName||null,
    dohmhRecordId:p.dohmhRecordId||null,
    sourceRowFingerprint:p.sourceRowFingerprint||null,
    dohmhRowFingerprint:p.dohmhRowFingerprint||null,
    counterpartyRowFingerprint:p.counterpartyRowFingerprint||null
  };
}
const contextFingerprint=proposal=>hash(context(proposal));
function seal(ledger){
  const {ledgerFingerprint,...body}=ledger;
  return {...body,ledgerFingerprint:hash(body)};
}
function validate(ledger){
  const l=ledger||{},failures=[];
  const initialized=instant(l.initializedAt),observed=instant(l.observedAt);
  if(l.version!==VERSION||!initialized||!observed||
     Date.parse(initialized)>Date.parse(observed)||
     !/^[a-f0-9]{64}$/.test(String(l.sourceReceiptFingerprint||''))||
     !l.entries||typeof l.entries!=='object'||Array.isArray(l.entries)){
    failures.push('IDENTITY_HISTORY_FORMAT_INVALID');
  }
  const {ledgerFingerprint,...body}=l;
  if(ledgerFingerprint!==hash(body)){
    failures.push('IDENTITY_HISTORY_FINGERPRINT_INVALID');
  }
  for(const [id,entry] of Object.entries(l.entries||{})){
    const first=instant(entry?.firstObservedAt);
    const last=instant(entry?.lastObservedAt);
    const lastContext=entry?.lastContextRecheckAt==null?
      null:instant(entry.lastContextRecheckAt);
    if(!/^HYP:[a-f0-9]{24}$/.test(id)||
       !entry||entry.proposalId!==id||
       !first||!last||!initialized||!observed||
       Date.parse(first)<Date.parse(initialized)||
       Date.parse(first)>Date.parse(last)||
       Date.parse(last)>Date.parse(observed)||
       !STATUSES.has(entry.presenceState)||
       !/^[a-f0-9]{64}$/.test(String(entry.contextFingerprint||''))||
       !Number.isInteger(entry.contextRecheckCount)||
       entry.contextRecheckCount<0||
       (entry.contextRecheckCount===0&&entry.lastContextRecheckAt!=null)||
       (entry.contextRecheckCount>0&&!lastContext)||
       (lastContext&&(
         Date.parse(lastContext)<Date.parse(first)||
         Date.parse(lastContext)>Date.parse(last)))
      ){
      failures.push('IDENTITY_HISTORY_ENTRY_INVALID');
    }
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function validateReceipt(receipt){
  const check=identity.validate(receipt);
  const now=instant(receipt?.observedAt);
  const failures=[...check.failures];
  if(!now)failures.push('IDENTITY_HISTORY_RECEIPT_TIME_INVALID');
  return {valid:failures.length===0,failures};
}
function bootstrap(receipt){
  const verified=validateReceipt(receipt);
  if(!verified.valid||receipt.omittedByLimit!==0||
     receipt.reviewQueueComplete!==true){
    return {
      status:'REVIEW',
      failures:[...new Set([...verified.failures,'IDENTITY_HISTORY_BASELINE_NOT_COMPLETE'])]
    };
  }
  const now=instant(receipt.observedAt);
  const entries={};
  for(const p of receipt.proposals){
    entries[p.proposalId]={
      proposalId:p.proposalId,
      firstObservedAt:now,lastObservedAt:now,
      contextFingerprint:contextFingerprint(p),
      presenceState:CURRENT,
      lastContextRecheckAt:null,contextRecheckCount:0
    };
  }
  return {
    status:'BASELINED',failures:[],
    newProposalIds:[],contextRecheckIds:[],
    ledger:seal({
      version:VERSION,initializedAt:now,observedAt:now,
      sourceReceiptFingerprint:receipt.artifactFingerprint,entries
    })
  };
}
function advance(previous,receipt){
  const verified=validateReceipt(receipt);
  if(!verified.valid)return {status:'REVIEW',failures:verified.failures};
  if(!previous)return bootstrap(receipt);
  const old=validate(previous);
  if(!old.valid)return {status:'REVIEW',failures:old.failures};
  const now=instant(receipt.observedAt);
  if(Date.parse(now)<Date.parse(previous.observedAt)){
    return {status:'REVIEW',failures:['IDENTITY_HISTORY_TIME_REVERSED']};
  }
  if(now===previous.observedAt&&
     receipt.artifactFingerprint!==previous.sourceReceiptFingerprint){
    return {status:'REVIEW',failures:['IDENTITY_HISTORY_SAME_TIME_REWRITE']};
  }
  const entries=structuredClone(previous.entries),seen=new Set();
  const newProposalIds=[],contextRecheckIds=[];
  for(const p of receipt.proposals){
    const id=p.proposalId,fingerprint=contextFingerprint(p),prior=entries[id];
    seen.add(id);
    if(!prior){
      entries[id]={
        proposalId:id,firstObservedAt:now,lastObservedAt:now,
        contextFingerprint:fingerprint,presenceState:CURRENT,
        lastContextRecheckAt:null,contextRecheckCount:0
      };
      newProposalIds.push(id);
    }else{
      const differs=fingerprint!==prior.contextFingerprint;
      entries[id]={
        ...prior,lastObservedAt:now,presenceState:CURRENT,
        contextFingerprint:fingerprint,
        lastContextRecheckAt:differs?now:prior.lastContextRecheckAt,
        contextRecheckCount:prior.contextRecheckCount+(differs?1:0)
      };
      if(differs)contextRecheckIds.push(id);
    }
  }
  // Capped snapshots cannot establish that unseen relationships disappeared.
  if(receipt.omittedByLimit===0&&receipt.reviewQueueComplete===true){
    for(const [id,e] of Object.entries(entries)){
      if(!seen.has(id))entries[id]={...e,presenceState:ABSENT};
    }
  }
  const ledger=seal({
    version:VERSION,initializedAt:previous.initializedAt,observedAt:now,
    sourceReceiptFingerprint:receipt.artifactFingerprint,entries
  });
  return {
    status:newProposalIds.length||contextRecheckIds.length?'ADVANCED':'NO_NEW_HYPOTHESES',
    failures:[],ledger,newProposalIds,contextRecheckIds
  };
}
function annotate(receipt,ledger,newIds=[],changedIds=[],baseline=false){
  const proof=validateReceipt(receipt),checked=validate(ledger),failures=[
    ...proof.failures,...checked.failures
  ];
  if(receipt?.observedAt!==ledger?.observedAt||
     receipt?.artifactFingerprint!==ledger?.sourceReceiptFingerprint){
    failures.push('IDENTITY_HISTORY_RECEIPT_MISMATCH');
  }
  const records=ledger?.entries||{};
  if((receipt?.proposals||[]).some(p=>
    !records[p.proposalId]||
    records[p.proposalId].contextFingerprint!==contextFingerprint(p))){
    failures.push('IDENTITY_HISTORY_CONTEXT_MISMATCH');
  }
  if(failures.length)return {status:'REVIEW',failures:[...new Set(failures)]};
  const fresh=new Set(newIds),changed=new Set(changedIds);
  const props=receipt.proposals.map(p=>{
    const e=records[p.proposalId];
    const status=baseline?LABELS.baseline:
      fresh.has(p.proposalId)?LABELS.new:
      changed.has(p.proposalId)?LABELS.changed:LABELS.existing;
    return identity.createProposal({
      ...p,
      monitoringStatus:status,
      firstObservedByPermitPlateAt:e.firstObservedAt,
      lastObservedByPermitPlateAt:e.lastObservedAt,
      lastContextRecheckAt:e.lastContextRecheckAt
    });
  });
  const {artifactFingerprint:_old,...body}=receipt;
  const annotated={
    ...body,
    identityHistoryVersion:VERSION,
    identityHistoryFingerprint:ledger.ledgerFingerprint,
    newlyObservedHypotheses:fresh.size,
    sourceContextRechecks:changed.size,
    baselineMigration:baseline===true,
    proposals:props,
    customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false,
    automaticMerges:0,externalSendCalls:0
  };
  const result={...annotated,artifactFingerprint:hash(annotated)};
  const final=identity.validate(result);
  if(!final.valid)return {status:'REVIEW',failures:final.failures};
  return result;
}
module.exports={
  VERSION,CURRENT,ABSENT,STATUSES,LABELS,instant,context,contextFingerprint,
  seal,validate,validateReceipt,bootstrap,advance,annotate
};
