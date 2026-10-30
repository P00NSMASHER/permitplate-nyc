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
  // NYC Geosupport explicitly uses "million BINs" (borough digit followed
  // by six zeros) for missing/unknown building IDs. These are not real
  // premises and must never generate an official building ID conflict.
  // Source: NYC Department of City Planning Geosupport User Programming Guide
  // (NYC Geosupport error 22: rest of BIN digits all zero is invalid).
  // https://www.nyc.gov/assets/planning/download/pdf/data-maps/open-data/upg.pdf
  if(!/^[1-5]\d{6}$/.test(s)||s.slice(1)==='000000')return null;
  return s;
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
  const rawDohmhBin=String(dohmh.property?.bin||'').trim();
  const rawDobBin=String(dob.property?.bin||'').trim();
  const leftBin=bin(rawDohmhBin),rightBin=bin(rawDobBin);
  const dohmhMillionPlaceholder=/^[1-5]000000$/.test(rawDohmhBin);
  const dobMillionPlaceholder=/^[1-5]000000$/.test(rawDobBin);
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
    rawDohmhBin,rawDobBin,
    dohmhMillionBinPlaceholder:dohmhMillionPlaceholder,
    dobMillionBinPlaceholder:dobMillionPlaceholder,
    dohmhBbl:leftBbl,
    dobDerivedBbl:rightBbl,
    binComparison,bblComparison,
    assessment,
    manualConflictHold:conflict,
    noAutomaticIdentityLink:true,
    independentlyVerifiedOperator:false,
    customerDeliveryAllowed:false,
    caveat:'A borough million BIN is a missing-building placeholder, not a building-ID conflict. Official non-placeholder identifiers refer to premises, not operating company or vendor contract.'
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
