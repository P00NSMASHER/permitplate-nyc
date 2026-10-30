'use strict';

// Conservative, offline *text consistency* guard for selected real PA DLI
// municipal-election references. NOT a 2,562-municipality census; NOT proof
// that a parcel is physically within any municipality, or that an election,
// code official, fee or permit rule is current. No customer data or network.
const a=require('../verification/pa-official-ucc-permit-samples.json');
const b=require('./pa-real-official-evidence.json');

const VERSION='PermitPlate-PA-jurisdiction-identity-reference-v1.0.0';
const SOURCE='https://www.pa.gov/content/dam/copapwp-pagov/en/dli/documents/individuals/labor-management-relations/bois/documents/uccmun.htm';
const TYPES=['HOME RULE','TOWNSHIP','BOROUGH','CITY'];
function upper(value){
  return String(value||'').normalize('NFKC').toUpperCase()
    .replace(/[\u2018\u2019]/g,"'").replace(/\s+/g,' ').trim();
}
function makeRegistry(){
  if(a.strictlyPublicReferenceOnly!==true||a.sourceOfMunicipalTruth!==SOURCE||
     a.municipals?.length!==30||b.notGenuineCustomerEvidence!==true||
     b.offlineFixtureOnly!==true||b.municipalDecisions?.length!==9){
    throw Error('PA_SELECTED_OFFICIAL_REFERENCE_INTEGRITY_FAILED');
  }
  const records=new Map();
  const ingest=(o,county,name,type,election,recordId)=>{
    const key=[county,name,type].map(upper).join('|');
    if(!/^[A-Z -]+\|[A-Z '-]+\|(CITY|BOROUGH|TOWNSHIP|HOME RULE)$/.test(key)||
       !['OPT-IN','OPT-OUT'].includes(election)){
      throw Error('PA_SELECTED_OFFICIAL_REFERENCE_ROW_INVALID');
    }
    const record={county:upper(county),name:upper(name),type:upper(type),
      election,referenceId:recordId};
    if(records.has(key)){
      if(records.get(key).election!==election){
        throw Error('PA_SELECTED_OFFICIAL_REFERENCE_CONFLICT');
      }
    }else records.set(key,record);
  };
  for(const row of a.municipals)ingest(row,row.county,row.name,row.type,row.uccElection,row.id);
  for(const row of b.municipalDecisions)ingest(
    row,row.county,row.name,row.municipalityType,row.uccDecision,row.caseId);
  if(records.size!==32)throw Error('PA_SELECTED_REFERENCE_COVERAGE_CHANGED');
  return Object.freeze([...records.values()]);
}
const REFERENCES=makeRegistry();
function municipalityParts(input){
  if(typeof input!=='string'||input.length>150||/[\n\r<>]/.test(input)){
    return {valid:false,reason:'FORMAT_UNRECOGNIZED'};
  }
  const raw=upper(input),pattern=/^(.*?),\s*([A-Z '-]+)\s+COUNTY(?:,\s*(?:PA|PENNSYLVANIA))?$/;
  const m=pattern.exec(raw);
  if(!m){
    return {valid:false,reason:'COUNTY_NOT_EXPLICIT'};
  }
  const county=m[2].trim();
  let prefix=m[1].trim(),kind=null;
  const comma=/(.+),\s*(CITY|BOROUGH|TOWNSHIP|HOME RULE)$/.exec(prefix);
  if(comma){
    prefix=comma[1].trim();kind=comma[2];
  }else{
    const ofType=/^(CITY|BOROUGH|TOWNSHIP|HOME RULE) OF (.+)$/.exec(prefix);
    if(ofType){prefix=ofType[2].trim();kind=ofType[1]}
    else if(!REFERENCES.some(r=>r.name===prefix)){
      // Names such as FAYETTE CITY are official names, not a claim that their
      // legal municipality TYPE is CITY; preserve an exact official name first.
      const suffix=/(.+)\s+(CITY|BOROUGH|TOWNSHIP|HOME RULE)$/.exec(prefix);
      if(suffix){prefix=suffix[1].trim();kind=suffix[2]}
    }
  }
  if(!/^[A-Z '-]{2,80}$/.test(prefix)||!/^[A-Z '-]{2,60}$/.test(county)){
    return {valid:false,reason:'FORMAT_UNRECOGNIZED'};
  }
  return {valid:true,name:prefix,type:kind,county};
}
function assess(value){
  const parsed=municipalityParts(value);
  const core={
    version:VERSION,status:null,
    selectedReferenceRows:REFERENCES.length,
    sourceUrl:SOURCE,
    geographicBoundaryVerified:false,
    currentJurisdictionContactVerified:false,
    permitApplicabilityVerified:false,
    requiresIndependentHumanReview:true
  };
  if(!parsed.valid)return {...core,status:parsed.reason};
  const all=REFERENCES.filter(x=>x.name===parsed.name);
  if(!all.length)return {...core,status:'NAME_NOT_IN_SELECTED_REFERENCE'};
  const local=all.filter(x=>x.county===parsed.county);
  if(!local.length)return {...core,status:'KNOWN_NAME_COUNTY_NOT_CONFIRMED'};
  const filtered=parsed.type?local.filter(x=>x.type===parsed.type):local;
  if(!filtered.length)return {...core,status:'MUNICIPALITY_TYPE_CONFLICT'};
  if(filtered.length!==1)return {...core,status:'MUNICIPALITY_TYPE_AMBIGUOUS'};
  const match=filtered[0];
  return {...core,status:'SELECTED_REFERENCE_TEXT_MATCH',
    textMatched:{county:match.county,name:match.name,type:match.type,
      historicalElection:match.election,referenceId:match.referenceId}};
}
const HOLD_STATUSES=Object.freeze([
  'FORMAT_UNRECOGNIZED','COUNTY_NOT_EXPLICIT',
  'KNOWN_NAME_COUNTY_NOT_CONFIRMED','MUNICIPALITY_TYPE_CONFLICT',
  'MUNICIPALITY_TYPE_AMBIGUOUS'
]);
function requiresClarification(value){
  return HOLD_STATUSES.includes(assess(value).status);
}
module.exports={VERSION,SOURCE,REFERENCES,municipalityParts,assess,requiresClarification};
