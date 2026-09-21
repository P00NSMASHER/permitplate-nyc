'use strict';

const crypto = require('crypto');
const delivery = require('./delivery-plan');

const DETECTION_LEDGER_VERSION = 'PermitPlate-detection-ledger-v1.0.0';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
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
  return map;
}
function entryFingerprint(entry) {
  return sha256(stableStringify({
    entityId:entry.entityId,
    currentChangeFingerprint:entry.currentChangeFingerprint,
    firstObservedAt:entry.firstObservedAt,
    lastObservedAt:entry.lastObservedAt,
    presenceState:entry.presenceState,
    lastCustomerEventAt:entry.lastCustomerEventAt || null,
    lastCustomerEventClass:entry.lastCustomerEventClass || null
  }));
}
function ledgerFingerprint(ledger) {
  return sha256(stableStringify({
    ledgerVersion:ledger.ledgerVersion,
    initializedAt:ledger.initializedAt,
    graphDigest:ledger.graphDigest,
    observedAt:ledger.observedAt,
    entries:Object.keys(ledger.entries||{}).sort()
      .map((key)=>ledger.entries[key])
  }));
}

function baselineReceipt(candidate, observedAt) {
  const changeFingerprint=delivery.candidateChangeFingerprint(candidate);
  const receipt={
    detectionVersion:DETECTION_LEDGER_VERSION,
    detectionClass:'BASELINE_EXISTING',
    customerEligible:false,
    entityId:candidate.entityId,
    changeFingerprint,
    firstDetectedAt:null,
    materialChangeAt:null,
    reopenAt:null,
    observedAt,
    sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt || null,
    sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt || null
  };
  receipt.receiptId='DET:'+sha256(stableStringify(receipt)).slice(0,24);
  return receipt;
}

function customerReceipt(candidate, observedAt, detectionClass, previousFingerprint) {
  const changeFingerprint=delivery.candidateChangeFingerprint(candidate);
  const receipt={
    detectionVersion:DETECTION_LEDGER_VERSION,
    detectionClass,
    customerEligible:true,
    entityId:candidate.entityId,
    changeFingerprint,
    previousChangeFingerprint:previousFingerprint || null,
    firstDetectedAt:detectionClass==='NEW_ENTITY' ? observedAt : null,
    materialChangeAt:detectionClass==='MATERIAL_CHANGE' ? observedAt : null,
    reopenAt:null,
    observedAt,
    sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt || null,
    sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt || null
  };
  receipt.receiptId='DET:'+sha256(stableStringify(receipt)).slice(0,24);
  return receipt;
}

function bootstrapLedger(graph, observedAtValue) {
  const observedAt=iso(observedAtValue);
  if(!graph || graph.graphState!=='COMPLETE') {
    return {
      committed:false,
      reason:'GRAPH_NOT_COMPLETE',
      ledger:null,
      receipts:[]
    };
  }

  const map=candidateMap(graph);
  const entries={};
  const receipts=[];
  for(const [entityId,candidate] of map) {
    const receipt=baselineReceipt(candidate,observedAt);
    receipts.push(receipt);
    entries[entityId]={
      entityId,
      currentChangeFingerprint:receipt.changeFingerprint,
      firstObservedAt:observedAt,
      lastObservedAt:observedAt,
      presenceState:'PRESENT',
      lastCustomerEventAt:null,
      lastCustomerEventClass:null
    };
    entries[entityId].entryFingerprint=entryFingerprint(entries[entityId]);
  }

  const ledger={
    ledgerVersion:DETECTION_LEDGER_VERSION,
    initializedAt:observedAt,
    observedAt,
    graphDigest:graph.graphDigest || null,
    entries
  };
  ledger.ledgerFingerprint=ledgerFingerprint(ledger);
  return {
    committed:true,
    reason:'BOOTSTRAP_BASELINE',
    ledger,
    receipts,
    customerEligibleReceipts:[]
  };
}

function validateLedger(ledger) {
  const errors=[];
  if(!ledger || ledger.ledgerVersion!==DETECTION_LEDGER_VERSION) errors.push('LEDGER_VERSION_INVALID');
  if(!ledger || !ledger.initializedAt) errors.push('LEDGER_NOT_INITIALIZED');
  if(!ledger || !ledger.entries || typeof ledger.entries!=='object') errors.push('LEDGER_ENTRIES_INVALID');
  if(ledger && ledger.ledgerFingerprint && ledgerFingerprint(ledger)!==ledger.ledgerFingerprint) {
    errors.push('LEDGER_FINGERPRINT_MISMATCH');
  }
  return {valid:errors.length===0,errors};
}

function advanceDetectionLedger(previousLedger, graph, observedAtValue) {
  const observedAt=iso(observedAtValue);
  if(!previousLedger || !previousLedger.initializedAt) return bootstrapLedger(graph,observedAt);

  const validated=validateLedger(previousLedger);
  if(!validated.valid) {
    return {committed:false,reason:'LEDGER_INVALID',errors:validated.errors,ledger:null,receipts:[]};
  }
  if(!graph || graph.graphState!=='COMPLETE') {
    return {
      committed:false,
      reason:'GRAPH_NOT_COMPLETE',
      ledger:previousLedger,
      receipts:[],
      customerEligibleReceipts:[]
    };
  }

  const current=candidateMap(graph);
  const nextEntries=JSON.parse(JSON.stringify(previousLedger.entries||{}));
  const receipts=[];
  const customerEligibleReceipts=[];

  for(const [entityId,candidate] of current) {
    const fingerprint=delivery.candidateChangeFingerprint(candidate);
    const prior=previousLedger.entries[entityId];

    if(!prior) {
      const receipt=customerReceipt(candidate,observedAt,'NEW_ENTITY',null);
      receipts.push(receipt);
      customerEligibleReceipts.push(receipt);
      nextEntries[entityId]={
        entityId,
        currentChangeFingerprint:fingerprint,
        firstObservedAt:observedAt,
        lastObservedAt:observedAt,
        presenceState:'PRESENT',
        lastCustomerEventAt:observedAt,
        lastCustomerEventClass:'NEW_ENTITY'
      };
    } else if(prior.presenceState==='PRESENT' && prior.currentChangeFingerprint!==fingerprint) {
      const receipt=customerReceipt(candidate,observedAt,'MATERIAL_CHANGE',prior.currentChangeFingerprint);
      receipts.push(receipt);
      customerEligibleReceipts.push(receipt);
      nextEntries[entityId]=Object.assign({},prior,{
        currentChangeFingerprint:fingerprint,
        lastObservedAt:observedAt,
        presenceState:'PRESENT',
        lastCustomerEventAt:observedAt,
        lastCustomerEventClass:'MATERIAL_CHANGE'
      });
    } else if(prior.presenceState!=='PRESENT') {
      // Reappearance is preserved for review; a moving query window is not enough
      // evidence to call this a qualifying commercial reopen.
      const receipt={
        detectionVersion:DETECTION_LEDGER_VERSION,
        detectionClass:'REAPPEARED_REVIEW',
        customerEligible:false,
        entityId,
        changeFingerprint:fingerprint,
        previousChangeFingerprint:prior.currentChangeFingerprint || null,
        firstDetectedAt:null,
        materialChangeAt:null,
        reopenAt:null,
        observedAt,
        sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt || null,
        sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt || null
      };
      receipt.receiptId='DET:'+sha256(stableStringify(receipt)).slice(0,24);
      receipts.push(receipt);
      nextEntries[entityId]=Object.assign({},prior,{
        currentChangeFingerprint:fingerprint,
        lastObservedAt:observedAt,
        presenceState:'PRESENT'
      });
    } else {
      nextEntries[entityId]=Object.assign({},prior,{lastObservedAt:observedAt,presenceState:'PRESENT'});
    }
    nextEntries[entityId].entryFingerprint=entryFingerprint(nextEntries[entityId]);
  }

  // A complete rolling source window can prove only that an entity is no longer in
  // the current monitored window. It does not prove business closure or retirement.
  for(const [entityId,prior] of Object.entries(previousLedger.entries||{})) {
    if(current.has(entityId)) continue;
    nextEntries[entityId]=Object.assign({},prior,{
      presenceState:'OUT_OF_CURRENT_WINDOW'
    });
    nextEntries[entityId].entryFingerprint=entryFingerprint(nextEntries[entityId]);
  }

  const ledger={
    ledgerVersion:DETECTION_LEDGER_VERSION,
    initializedAt:previousLedger.initializedAt,
    observedAt,
    graphDigest:graph.graphDigest || null,
    entries:nextEntries
  };
  ledger.ledgerFingerprint=ledgerFingerprint(ledger);
  return {
    committed:true,
    reason:'ADVANCED',
    ledger,
    receipts,
    customerEligibleReceipts
  };
}

module.exports={
  DETECTION_LEDGER_VERSION,
  stableStringify,
  sha256,
  iso,
  candidateMap,
  entryFingerprint,
  ledgerFingerprint,
  baselineReceipt,
  customerReceipt,
  bootstrapLedger,
  validateLedger,
  advanceDetectionLedger
};
