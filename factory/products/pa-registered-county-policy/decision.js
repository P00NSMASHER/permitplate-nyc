"use strict";

function normalizeCounty(value){
  const text=String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  return text||null;
}

function assessCountyPolicy(evidence,allowedCounties,checkedAt=new Date().toISOString()){
  const allowed=new Set((Array.isArray(allowedCounties)?allowedCounties:[]).map(normalizeCounty).filter(Boolean));
  const entity=evidence?.entity??null;
  let decision="human_review";
  let reasonCode="PA_REGISTRY_EVIDENCE_INCOMPLETE";
  const county=entity?.county??null;
  const normalizedCounty=normalizeCounty(county);

  if(evidence?.available!==true){
    reasonCode="PA_REGISTRY_UNAVAILABLE";
  }else if(!entity){
    decision="company_not_found";
    reasonCode="PA_ENTITY_NOT_FOUND";
  }else if(evidence.ambiguous===true||evidence.strongMatch!==true){
    reasonCode="PA_REGISTRY_MATCH_UNCERTAIN";
  }else if(!normalizedCounty){
    reasonCode="REGISTERED_COUNTY_MISSING";
  }else if(allowed.has(normalizedCounty)){
    decision="policy_match";
    reasonCode="REGISTERED_COUNTY_ALLOWED";
  }else{
    decision="policy_mismatch";
    reasonCode="REGISTERED_COUNTY_NOT_ALLOWED";
  }

  return {
    decision,
    reasonCode,
    allowedCounties:[...allowed],
    registeredCounty:county,
    registeredCountyCode:entity?.countyCode??null,
    normalizedCounty,
    matchedEntity:entity,
    checkedAt
  };
}

module.exports={normalizeCounty,assessCountyPolicy};
