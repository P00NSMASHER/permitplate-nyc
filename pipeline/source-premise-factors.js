'use strict';

// Source-bound property checks are NOT operator-identity verification.
// BIN/BBL agreement can corroborate a physical site, never a buyer, tenant,
// franchisee, equipment contract, or future opening date.
const {sha256,stableStringify}=require('./source-adapters');
const VERSION='PermitPlate-premise-identity-factors-v1.0.0';
const BCU=Object.freeze({
  MANHATTAN:'1',BRONX:'2',BROOKLYN:'3',QUEENS:'4', 'STATEN ISLAND':'5'
});
function bin(value){
  const s=String(value==null?'':value).trim();
  return /^\d{7}$/.test(s)&&!/^[0]+$/.test(s)?s:null;
}
function bbl(value){
  const s=String(value==null?'':value).trim();
  return /^[1-5]\d{9}$/.test(s)?s:null;
}
function dobBbl(record){
  const property=record?.property||{};
  const borough=String(property.borough||'').trim().toUpperCase();
  const code=BCU[borough];
  const block=String(property.block||'').trim(),lot=String(property.lot||'').trim();
  if(!code||! /^\d{1,5}$/.test(block)||!/^\d{1,4}$/.test(lot)||
     Number(block)<=0||Number(lot)<=0)return null;
  return code+block.padStart(5,'0')+lot.padStart(4,'0');
}
function compare(a,b){
  return a&&b?(a===b?'MATCH':'CONFLICT'):'NOT_COMPARABLE';
}
function verifyPair(dohmh,dob){
  if(!dohmh||dohmh.sourceSystem!=='DOHMH'||
     !dob||dob.sourceSystem!=='DOB_NOW'||
     !dohmh.sourceObservationId||!dob.sourceObservationId){
    throw Error('PREMISE_SOURCE_PROVENANCE_REQUIRED');
  }
  const leftBin=bin(dohmh.property?.bin),rightBin=bin(dob.property?.bin);
  const leftBbl=bbl(dohmh.property?.bbl),rightBbl=dobBbl(dob);
  const binComparison=compare(leftBin,rightBin);
  const bblComparison=compare(leftBbl,rightBbl);
  const conflict=[binComparison,bblComparison].includes('CONFLICT');
  const matched=[binComparison,bblComparison].includes('MATCH');
  const assessment=conflict?'OFFICIAL_PROPERTY_IDENTIFIER_CONFLICT':
    matched?'MATCHED_PREMISE_IDENTIFIER_REVIEW':
    'ADDRESS_ONLY_IDENTITY_UNRESOLVED';
  const core={
    version:VERSION,
    dohmhSourceRecordId:dohmh.sourceRecordId,
    dobSourceRecordId:dob.sourceRecordId,
    dohmhObservationId:dohmh.sourceObservationId,
    dobObservationId:dob.sourceObservationId,
    dohmhSourceFactHash:dohmh.rawFactFingerprint,
    dobSourceFactHash:dob.rawFactFingerprint,
    dohmhBin:leftBin,
    dobBin:rightBin,
    dohmhBbl:leftBbl,
    dobDerivedBbl:rightBbl,
    binComparison,bblComparison,
    assessment,
    manualConflictHold:conflict,
    noAutomaticIdentityLink:true,
    independentlyVerifiedOperator:false,
    customerDeliveryAllowed:false,
    caveat:'Official building identifiers refer to premises, not operating company or vendor contract.'
  };
  return {...core,fingerprint:sha256(stableStringify(core))};
}
function verify(output,dohmh,dob){
  try{
    const expected=verifyPair(dohmh,dob);
    return {valid:stableStringify(output)===stableStringify(expected)};
  }catch{
    return {valid:false};
  }
}
module.exports={VERSION,BCU,bin,bbl,dobBbl,compare,verifyPair,verify};
