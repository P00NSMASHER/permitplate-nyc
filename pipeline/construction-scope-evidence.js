'use strict';

// Preserve the complete original DOB NOW job-description field in PRIVATE
// source-bound review artifacts. A filing scope is NOT a vendor order, client
// identity, awarded contract, or proof of a forthcoming restaurant opening.
const {createHash}=require('node:crypto');
const {stableStringify}=require('./source-adapters');

const VERSION='PermitPlate-construction-scope-evidence-v1.0.0';
const MAX_DESCRIPTION_CHARS=32768;
const SPECIFIC_TERMS=Object.freeze([
  ['KITCHEN_EXHAUST',/\b(?:kitchen\s*exhaust|exhaust\s*hood|(?:kitchen|commercial)\s*hood|hood\s*(?:system|and\s*duct)|type\s*(?:1|i)\s*(?:commercial\s*kitchen\s*)?hood)\b/i],
  ['VENTILATION_HVAC',/\b(?:exhaust\s*fan|ventilation|make[\s-]*up\s*air|HVAC)\b/i],
  ['COOKING_EQUIPMENT',/\b(?:commercial\s*(?:cooking\s*)?equipment|cooking\s*equipment|kitchen\s*appliances|(?:restaurant|commercial)\s*stove|convection\s*oven|gas\s*range|griddle|fryer)\b/i],
  ['REFRIGERATION',/\b(?:commercial\s*refrigeration|walk[\s-]*in\s*(?:cooler|freezer)|ice\s*machine)\b/i],
  ['FIRE_SUPPRESSION',/\b(?:fire\s*suppression|suppression\s*(?:valve|system))\b/i],
  ['PLUMBING_GAS',/\b(?:commercial\s*kitchen\s*gas|gas\s*piping|grease\s*(?:interceptor|trap)|plumbing\s*fixtures?)\b/i]
]);
const CONTEXT_TERMS=Object.freeze([
  ['COMMERCIAL_KITCHEN',/\bcommercial\s*kitchen\b/i],
  ['RESTAURANT',/\brestaurants?\b/i],
  ['EATING_AND_DRINKING',/\beating\s*and\s*drinking\s*establishment\b/i],
  ['FOOD_SERVICE',/\bfood[\s-]*service\b/i],
  ['CAFE_BAKERY',/\b(?:caf[eé]|bakery|pizzeria)\b/i]
]);
const ACTION_TERMS=Object.freeze([
  ['INSTALL',/\b(?:install|installation|installing|installed)\b/i],
  ['REPLACE',/\b(?:replace|replacement|replacing)\b/i],
  ['UPGRADE',/\b(?:upgrade|upgrading|renovation|alteration|modify|modification)\b/i],
  ['PROPOSE',/\b(?:proposed?|new|design|filed|filing|register)\b/i]
]);
function sha(value){return createHash('sha256').update(value).digest('hex')}
function tags(value,rules){
  return rules.filter(([,test])=>test.test(value)).map(([tag])=>tag);
}
function normalizeForTerms(value){
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
function capture(record){
  if(!record||record.sourceSystem!=='DOB_NOW'||
     !/^DOB_NOW:[A-Za-z0-9-]+$/.test(String(record.sourceRecordId||''))||
     !/^OBS:/.test(String(record.sourceObservationId||''))||
     typeof record.facts?.job_description!=='string'){
    throw Error('DOB_SCOPE_SOURCE_IDENTITY_INVALID');
  }
  const fullText=record.facts.job_description;
  if(!fullText.trim()||fullText.length>MAX_DESCRIPTION_CHARS){
    throw Error('DOB_SCOPE_EMPTY_OR_OVER_BOUND');
  }
  const normalized=normalizeForTerms(fullText);
  const specificTags=tags(normalized,SPECIFIC_TERMS);
  const contextTags=tags(normalized,CONTEXT_TERMS);
  const actionTags=tags(normalized,ACTION_TERMS);
  const repairOrExisting=/\b(?:existing|repair|replacement|replace|upgrade|maintenance|no\s*change)\b/i.test(normalized);
  const scopeClass=specificTags.length&&actionTags.length?'SPECIFIC_COMPONENT_AND_ACTION':
    specificTags.length?'SPECIFIC_COMPONENT_CONTEXT_ONLY':
    contextTags.length?'RESTAURANT_OR_KITCHEN_CONTEXT_ONLY':'UNCLASSIFIED_SCOPE';
  // sourceFactFingerprint uses the original fact set selected from the
  // publisher response; do not trust a reviewer-excerpt as the source truth.
  const core={
    version:VERSION,
    sourceSystem:'DOB_NOW',
    sourceRecordId:record.sourceRecordId,
    sourceObservationId:record.sourceObservationId,
    sourceFactFingerprint:record.rawFactFingerprint,
    fullText,
    sourceTextLength:fullText.length,
    sourceTextSha256:sha(fullText),
    specificTags,contextTags,actionTags,
    scopeClass,
    existingOrRepairContext:repairOrExisting,
    noBuyerIntentEstablished:true,
    independentOperatorIdentityVerified:false,
    customerDeliveryAllowed:false
  };
  return {...core,scopeFingerprint:sha(stableStringify(core))};
}
// Semantic scope identity deliberately excludes publisher observation ID,
 // data-pull time, source row hash and administrative filing status. Those
 // fields have separate receipts and are not a construction description edit.
const SEMANTIC_VERSION='PermitPlate-DOB-description-content-v1.0.0';
function semanticScopeFingerprint(item){
  if(!validate(item).valid)return null;
  return sha(stableStringify({
    version:SEMANTIC_VERSION,
    sourceRecordId:item.sourceRecordId,
    sourceTextSha256:item.sourceTextSha256
  }));
}
function validate(item,record){
  if(!item||item.version!==VERSION||item.sourceSystem!=='DOB_NOW'||
     typeof item.fullText!=='string'||item.fullText.length>MAX_DESCRIPTION_CHARS||
     item.noBuyerIntentEstablished!==true||
     item.independentOperatorIdentityVerified!==false||
     item.customerDeliveryAllowed!==false){
    return {valid:false,failures:['DOB_SCOPE_DOCUMENT_INVALID']};
  }
  const {scopeFingerprint,...body}=item;
  if(scopeFingerprint!==sha(stableStringify(body))||
     item.sourceTextSha256!==sha(item.fullText)||
     item.sourceTextLength!==item.fullText.length){
    return {valid:false,failures:['DOB_SCOPE_RECEIPT_FINGERPRINT_INVALID']};
  }
  if(record){
    try {
      if(stableStringify(capture(record))!==stableStringify(item)){
        return {valid:false,failures:['DOB_SCOPE_OFFICIAL_ROW_MISMATCH']};
      }
    }catch{
      return {valid:false,failures:['DOB_SCOPE_SOURCE_IDENTITY_INVALID']};
    }
  }
  return {valid:true,failures:[]};
}
module.exports={
  VERSION,MAX_DESCRIPTION_CHARS,SPECIFIC_TERMS,CONTEXT_TERMS,ACTION_TERMS,
  SEMANTIC_VERSION,sha,tags,normalizeForTerms,capture,validate,semanticScopeFingerprint
};
