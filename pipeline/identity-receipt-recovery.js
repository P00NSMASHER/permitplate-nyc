'use strict';

// Strict compatibility for a known legacy serialization defect: optional
// undefined proposal keys were fingerprinted in memory but omitted in JSON.
// No existing receipt is accepted without its ORIGINAL hash verification.
const identity=require('./identity-bridge-review');
const {hash}=require('./independent-source-history');

const VERSION='PermitPlate-identity-receipt-recovery-v1.0.0';
const LEGACY_KEYS=Object.freeze({
  CAMIS_TO_EARLY_SOURCE:Object.freeze(['sourceRowFingerprint','dohmhRowFingerprint']),
  DOB_TO_SLA_PREMISE_REVIEW:Object.freeze(['sourceRowFingerprint','counterpartyRowFingerprint'])
});
function normalizeReceipt(raw){
  const asIs=identity.validate(raw);
  if(asIs.valid)return {
    ready:true,legacy:false,receipt:raw,version:VERSION,failures:[]
  };
  // Never recast prior evidence once persistent history has been written.
  if(!raw||raw.version!==identity.VERSION||
     raw.status!=='REVIEW_ONLY'||raw.identityHistoryVersion!=null||
     raw.customerDeliveryAllowed!==false||
     raw.automaticIdentityLinkAllowed!==false||
     raw.automaticMerges!==0||raw.externalSendCalls!==0||
     !Array.isArray(raw.proposals)||!raw.proposals.length||
     !Array.isArray(LEGACY_KEYS[raw.proposals[0].kind])){
    return {ready:false,legacy:false,failures:['IDENTITY_LEGACY_NOT_ELIGIBLE']};
  }
  const missingKeysTotal=raw.proposals.reduce((total,p)=>
    total+(LEGACY_KEYS[p.kind]||[]).filter(
      key=>!Object.prototype.hasOwnProperty.call(p,key)).length,0);
  if(!missingKeysTotal||
     raw.proposals.some(p=>!Object.prototype.hasOwnProperty.call(LEGACY_KEYS,p.kind))){
    return {ready:false,legacy:false,failures:['IDENTITY_LEGACY_SHAPE_INVALID']};
  }
  // Restore ONLY optional own properties actually present as undefined
  // before historical JSON serialization. Verify original hashes.
  const restored={
    ...raw,
    proposals:raw.proposals.map(p=>{
      const result={...p};
      for(const key of LEGACY_KEYS[p.kind]){
        if(!Object.prototype.hasOwnProperty.call(result,key))result[key]=undefined;
      }
      return result;
    })
  };
  const verified=identity.validate(restored);
  if(!verified.valid)return {
    ready:false,legacy:false,failures:['IDENTITY_LEGACY_ORIGINAL_HASH_INVALID']
  };
  // Current JSON-safe creator preserves all actual fields and proposal IDs.
  const normalized={
    ...raw,
    proposals:raw.proposals.map(p=>identity.createProposal(p))
  };
  delete normalized.artifactFingerprint;
  normalized.artifactFingerprint=hash(normalized);
  const proof=identity.validate(normalized);
  if(!proof.valid)return {
    ready:false,legacy:false,failures:['IDENTITY_LEGACY_NORMALIZATION_FAILED']
  };
  return {ready:true,legacy:true,receipt:normalized,version:VERSION,
    failures:[],recoveredProposalCount:normalized.proposals.length};
}
module.exports={VERSION,LEGACY_KEYS,normalizeReceipt};
