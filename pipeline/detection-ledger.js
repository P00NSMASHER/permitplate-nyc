'use strict';

const crypto = require('crypto');
const delivery = require('./delivery-plan');
const materialChange = require('./material-change');

// The persisted envelope stays compatible with V1. Each new entry/receipt also
// carries the independently versioned semantic materiality descriptor.
const DETECTION_LEDGER_VERSION = 'PermitPlate-detection-ledger-v1.0.0';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function iso(value) {
  const ms=Date.parse(String(value||''));
  if(!Number.isFinite(ms)) throw new Error('valid observedAt required');
  return new Date(ms).toISOString();
}
function candidateMap(graph) {
  const map=new Map();
  for(const candidate of graph && graph.candidates || []) {
    const id=String(candidate && candidate.entityId || '').trim();
    if(!id) throw new Error('candidate entityId required');
    if(map.has(id)) throw new Error('duplicate graph entityId: '+id);
    map.set(id,candidate);
  }
  return new Map([...map.entries()].sort(([a],[b])=>a.localeCompare(b)));
}
function entryFingerprint(entry) {
  return sha256(stableStringify({
    entityId:entry.entityId,
    currentChangeFingerprint:entry.currentChangeFingerprint,
    firstObservedAt:entry.firstObservedAt,
    lastObservedAt:entry.lastObservedAt,
    presenceState:entry.presenceState,
    lastCustomerEventAt:entry.lastCustomerEventAt || null,
    lastCustomerEventClass:entry.lastCustomerEventClass || null,
    ...(entry.materiality ? {materialityFingerprint:entry.materiality.fingerprint} : {})
  }));
}
function ledgerFingerprint(ledger) {
  // Keep this envelope stable so old, intact ledgers can migrate without a reset.
  return sha256(stableStringify({
    ledgerVersion:ledger.ledgerVersion,
    initializedAt:ledger.initializedAt,
    graphDigest:ledger.graphDigest,
    observedAt:ledger.observedAt,
    entries:Object.keys(ledger.entries||{}).sort().map(key=>ledger.entries[key])
  }));
}

function makeReceipt(candidate,observedAt,detectionClass,customerEligible,prior,changeReasons) {
  const materiality=materialChange.describe(candidate);
  const receipt={
    detectionVersion:DETECTION_LEDGER_VERSION,
    materialityVersion:materialChange.VERSION,
    materialityFingerprint:materiality.fingerprint,
    previousMaterialityFingerprint:prior && prior.materiality && prior.materiality.fingerprint || null,
    detectionClass,
    customerEligible,
    entityId:candidate.entityId,
    changeFingerprint:delivery.candidateChangeFingerprint(candidate),
    previousChangeFingerprint:prior && prior.currentChangeFingerprint || null,
    changeReasons:changeReasons || [],
    firstDetectedAt:customerEligible && detectionClass==='NEW_ENTITY' ? observedAt : null,
    materialChangeAt:customerEligible && detectionClass==='MATERIAL_CHANGE' ? observedAt : null,
    reopenAt:null,
    observedAt,
    sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt || null,
    sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt || null
  };
  receipt.receiptId='DET:'+sha256(stableStringify(receipt)).slice(0,24);
  return receipt;
}
function baselineReceipt(candidate,observedAt) {
  return makeReceipt(candidate,observedAt,'BASELINE_EXISTING',false,null,['INITIAL_BASELINE']);
}
function customerReceipt(candidate,observedAt,detectionClass,previousFingerprint) {
  return makeReceipt(candidate,observedAt,detectionClass,true,
    previousFingerprint ? {currentChangeFingerprint:previousFingerprint} : null,[detectionClass]);
}
function seal(ledger) {
  ledger.ledgerFingerprint=ledgerFingerprint(ledger);
  return ledger;
}
function refused(reason,ledger,errors=[]) {
  return {committed:false,reason,errors,ledger,receipts:[],customerEligibleReceipts:[],reviewReceipts:[]};
}

function bootstrapLedger(graph,observedAtValue) {
  const observedAt=iso(observedAtValue);
  if(!graph || graph.graphState!=='COMPLETE') return refused('GRAPH_NOT_COMPLETE',null);
  const entries={}, receipts=[];
  for(const [entityId,candidate] of candidateMap(graph)) {
    const receipt=baselineReceipt(candidate,observedAt);
    receipts.push(receipt);
    const entry={
      entityId,currentChangeFingerprint:receipt.changeFingerprint,
      materiality:materialChange.describe(candidate),
      firstObservedAt:observedAt,lastObservedAt:observedAt,presenceState:'PRESENT',
      lastCustomerEventAt:null,lastCustomerEventClass:null
    };
    entry.entryFingerprint=entryFingerprint(entry);
    entries[entityId]=entry;
  }
  const ledger=seal({ledgerVersion:DETECTION_LEDGER_VERSION,initializedAt:observedAt,observedAt,graphDigest:graph.graphDigest||null,entries});
  return {committed:true,reason:'BOOTSTRAP_BASELINE',ledger,receipts,customerEligibleReceipts:[],reviewReceipts:[],materialityMetrics:{baselineCount:receipts.length,migratedCount:0,refreshOnlyCount:0}};
}

function validateLedger(ledger) {
  const errors=[];
  if(!ledger || ledger.ledgerVersion!==DETECTION_LEDGER_VERSION) errors.push('LEDGER_VERSION_INVALID');
  if(!ledger || !ledger.initializedAt) errors.push('LEDGER_NOT_INITIALIZED');
  if(!ledger || !ledger.entries || typeof ledger.entries!=='object' || Array.isArray(ledger.entries)) errors.push('LEDGER_ENTRIES_INVALID');
  if(!ledger || !/^[a-f0-9]{64}$/.test(ledger.ledgerFingerprint||'')) errors.push('LEDGER_FINGERPRINT_REQUIRED');
  else if(ledgerFingerprint(ledger)!==ledger.ledgerFingerprint) errors.push('LEDGER_FINGERPRINT_MISMATCH');
  for(const [id,entry] of Object.entries(ledger && ledger.entries || {})) {
    if(!entry || entry.entityId!==id) errors.push('LEDGER_ENTRY_ID_MISMATCH');
    if(entry && entry.materiality && !materialChange.valid(entry.materiality)) errors.push('LEDGER_MATERIALITY_INVALID');
  }
  return {valid:errors.length===0,errors:[...new Set(errors)]};
}

function advanceDetectionLedger(previousLedger,graph,observedAtValue) {
  const observedAt=iso(observedAtValue);
  if(!previousLedger || !previousLedger.initializedAt) {
    if(previousLedger && Object.keys(previousLedger.entries||{}).length) return refused('LEDGER_INVALID',previousLedger,['UNINITIALIZED_LEDGER_HAS_ENTRIES']);
    return bootstrapLedger(graph,observedAt);
  }
  const validated=validateLedger(previousLedger);
  if(!validated.valid) return refused('LEDGER_INVALID',null,validated.errors);
  if(!graph || graph.graphState!=='COMPLETE') return refused('GRAPH_NOT_COMPLETE',previousLedger);
  const previousTime=Date.parse(previousLedger.observedAt);
  if(!Number.isFinite(previousTime) || Date.parse(observedAt)<previousTime ||
    (Date.parse(observedAt)===previousTime && graph.graphDigest!==previousLedger.graphDigest)) {
    return refused('NON_MONOTONIC_OBSERVATION',previousLedger);
  }

  const current=candidateMap(graph);
  const nextEntries=JSON.parse(JSON.stringify(previousLedger.entries));
  const receipts=[],customerEligibleReceipts=[],reviewReceipts=[];
  const materialityMetrics={baselineCount:0,migratedCount:0,refreshOnlyCount:0};

  for(const [entityId,candidate] of current) {
    const fingerprint=delivery.candidateChangeFingerprint(candidate);
    const materiality=materialChange.describe(candidate);
    const prior=previousLedger.entries[entityId];
    let receipt=null;
    const next=Object.assign({},prior||{}, {
      entityId,currentChangeFingerprint:fingerprint,materiality,
      firstObservedAt:prior ? prior.firstObservedAt : observedAt,
      lastObservedAt:observedAt,presenceState:'PRESENT',
      lastCustomerEventAt:prior ? prior.lastCustomerEventAt : null,
      lastCustomerEventClass:prior ? prior.lastCustomerEventClass : null
    });

    if(!prior) {
      receipt=makeReceipt(candidate,observedAt,materiality.suppressed?'SUPPRESSED_REVIEW':'NEW_ENTITY',!materiality.suppressed,null,[materiality.suppressed?'CANDIDATE_SUPPRESSED':'NEW_ENTITY']);
    } else if(prior.presenceState!=='PRESENT') {
      receipt=makeReceipt(candidate,observedAt,'REAPPEARED_REVIEW',false,prior,['REAPPEARANCE_IS_NOT_PROVEN_REOPEN']);
    } else if(!prior.materiality) {
      // A legacy hash cannot reconstruct yesterday's semantic state. Rebaseline
      // once, preserve all original history, and retain an explicit review receipt.
      // Never invent a new customer event solely because this policy was deployed.
      receipt=makeReceipt(candidate,observedAt,'MATERIALITY_MIGRATION_REVIEW',false,prior,['NO_HISTORICAL_SEMANTIC_SNAPSHOT']);
      next.materialityMigration={from:'LEGACY_RAW_FINGERPRINT',to:materialChange.VERSION,observedAt,previousChangeFingerprint:prior.currentChangeFingerprint,receiptId:receipt.receiptId};
      materialityMetrics.migratedCount+=1;
    } else {
      const decision=materialChange.compare(prior.materiality,materiality);
      if(decision.review) receipt=makeReceipt(candidate,observedAt,'MATERIAL_CHANGE_REVIEW',false,prior,decision.reasons);
      else if(decision.material) {
        const bindingChanged=fingerprint!==prior.currentChangeFingerprint;
        receipt=makeReceipt(candidate,observedAt,bindingChanged?'MATERIAL_CHANGE':'MATERIAL_CHANGE_REVIEW',bindingChanged,prior,
          bindingChanged?decision.reasons:['MATERIAL_CHANGE_BINDING_UNCHANGED',...decision.reasons]);
      } else if(fingerprint!==prior.currentChangeFingerprint) materialityMetrics.refreshOnlyCount+=1;
    }

    if(receipt) {
      receipts.push(receipt);
      if(receipt.customerEligible) {
        customerEligibleReceipts.push(receipt);
        next.lastCustomerEventAt=observedAt;
        next.lastCustomerEventClass=receipt.detectionClass;
      } else {
        reviewReceipts.push(receipt);
        // Durable, non-sensitive evidence survives even if the runner shows only
        // a small review sample. It is not placed in the opportunity/delivery feed.
        next.lastReviewReceipt=receipt;
      }
    }
    next.entryFingerprint=entryFingerprint(next);
    nextEntries[entityId]=next;
  }

  for(const [entityId,prior] of Object.entries(previousLedger.entries)) {
    if(current.has(entityId)) continue;
    const next=Object.assign({},prior,{presenceState:'OUT_OF_CURRENT_WINDOW'});
    next.entryFingerprint=entryFingerprint(next);
    nextEntries[entityId]=next;
  }
  const ledger=seal({ledgerVersion:DETECTION_LEDGER_VERSION,initializedAt:previousLedger.initializedAt,observedAt,graphDigest:graph.graphDigest||null,entries:nextEntries});
  return {committed:true,reason:'ADVANCED',ledger,receipts,customerEligibleReceipts,reviewReceipts,materialityMetrics};
}

module.exports={DETECTION_LEDGER_VERSION,stableStringify,sha256,iso,candidateMap,entryFingerprint,ledgerFingerprint,baselineReceipt,customerReceipt,bootstrapLedger,validateLedger,advanceDetectionLedger};
