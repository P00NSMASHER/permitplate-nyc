'use strict';

const crypto=require('crypto');

const OPPORTUNITY_LEDGER_VERSION='PermitPlate-opportunity-ledger-v1.0.0';

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function ledgerFingerprint(ledger){
  return sha256(stableStringify({
    ledgerVersion:ledger.ledgerVersion,
    initializedAt:ledger.initializedAt,
    entries:Object.keys(ledger.entries||{}).sort().map((key)=>ledger.entries[key])
  }));
}
function emptyLedger(initializedAt){
  const ledger={
    ledgerVersion:OPPORTUNITY_LEDGER_VERSION,
    initializedAt:initializedAt||null,
    entries:{}
  };
  ledger.ledgerFingerprint=ledgerFingerprint(ledger);
  return ledger;
}
function validateLedger(ledger){
  const errors=[];
  if(!ledger||ledger.ledgerVersion!==OPPORTUNITY_LEDGER_VERSION) errors.push('LEDGER_VERSION_INVALID');
  if(!ledger||!ledger.entries||typeof ledger.entries!=='object') errors.push('LEDGER_ENTRIES_INVALID');
  if(ledger&&ledger.ledgerFingerprint&&ledgerFingerprint(ledger)!==ledger.ledgerFingerprint){
    errors.push('LEDGER_FINGERPRINT_MISMATCH');
  }
  return {valid:errors.length===0,errors};
}
function eventKey(packageReceipt){
  return [
    String(packageReceipt&&packageReceipt.entityId||''),
    String(packageReceipt&&packageReceipt.changeFingerprint||'')
  ].join('|');
}
function appendOpportunityPackages(previousLedger,packageResult,observedAt){
  const prior=previousLedger&&previousLedger.initializedAt?
    previousLedger:emptyLedger(observedAt);
  const validated=validateLedger(prior);
  if(!validated.valid){
    return {committed:false,reason:'LEDGER_INVALID',errors:validated.errors,ledger:previousLedger,added:[]};
  }
  if(!packageResult||packageResult.passed!==true){
    return {committed:false,reason:'PACKAGE_RESULT_NOT_PASSED',ledger:prior,added:[]};
  }

  const packages=Array.isArray(packageResult.packages)?packageResult.packages:[];
  const invalid=packages.filter((item)=>
    !item ||
    item.status!=='READY_FOR_PROFILE_MATCHING' ||
    item.productionAuthorized!==true ||
    !item.packageId ||
    !item.packageFingerprint ||
    !item.entityId ||
    !item.changeFingerprint ||
    !item.detectionReceipt ||
    !item.scoreReceipt
  );
  if(invalid.length){
    return {
      committed:false,
      reason:'PACKAGE_NOT_LEDGER_ELIGIBLE',
      errors:['INVALID_PACKAGE_COUNT:'+invalid.length],
      ledger:prior,
      added:[]
    };
  }

  const entries=JSON.parse(JSON.stringify(prior.entries||{}));
  const added=[];
  for(const item of packages){
    const key=eventKey(item);
    if(entries[key]){
      if(entries[key].packageFingerprint!==item.packageFingerprint){
        return {
          committed:false,
          reason:'EVENT_KEY_PACKAGE_CONFLICT',
          errors:[key],
          ledger:prior,
          added:[]
        };
      }
      continue;
    }
    entries[key]={
      eventKey:key,
      entityId:item.entityId,
      changeFingerprint:item.changeFingerprint,
      packageId:item.packageId,
      packageFingerprint:item.packageFingerprint,
      firstStoredAt:observedAt,
      detectedAt:item.detectedAt||null,
      detectionClass:item.detectionClass||null,
      commercialFit:item.commercialFit||null,
      scores:item.scores||null,
      bestVendorFit:item.bestVendorFit||null,
      bestScore:item.bestScore==null?null:item.bestScore,
      package:item
    };
    added.push(key);
  }

  const ledger={
    ledgerVersion:OPPORTUNITY_LEDGER_VERSION,
    initializedAt:prior.initializedAt||observedAt,
    entries
  };
  ledger.ledgerFingerprint=ledgerFingerprint(ledger);
  return {
    committed:true,
    reason:added.length?'PACKAGES_APPENDED':'IDEMPOTENT_NOOP',
    ledger,
    added,
    totalEntries:Object.keys(entries).length
  };
}

module.exports={
  OPPORTUNITY_LEDGER_VERSION,
  stableStringify,
  sha256,
  ledgerFingerprint,
  emptyLedger,
  validateLedger,
  eventKey,
  appendOpportunityPackages
};
