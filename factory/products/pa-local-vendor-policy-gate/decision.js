"use strict";
const {normalizeRegistrationKind}=require("../pa-entity-type-policy/decision");
const {normalizeCounty}=require("../pa-registered-county-policy/decision");
const {DAY_MS,validDate}=require("../pa-business-formation-age/decision");

function assessLocalVendorPolicy(evidence,policy,checkedAt=new Date().toISOString()){
  const entity=evidence?.entity??null;
  const allowedKinds=new Set(policy?.allowedKinds||[]);
  const allowedCounties=new Set((policy?.allowedCounties||[]).map(normalizeCounty).filter(Boolean));
  const minAgeDays=policy?.minAgeDays??365;

  if(evidence?.available!==true){
    return {decision:"human_review",agentAction:"pause_and_request_human_review",reasonCodes:["PA_REGISTRY_UNAVAILABLE"],matchedEntity:entity,checkedAt};
  }
  if(!entity){
    return {decision:"company_not_found",agentAction:"pause_and_request_human_review",reasonCodes:["PA_ENTITY_NOT_FOUND"],matchedEntity:null,checkedAt};
  }
  if(evidence.ambiguous===true||evidence.strongMatch!==true){
    return {decision:"human_review",agentAction:"pause_and_request_human_review",reasonCodes:["PA_REGISTRY_MATCH_UNCERTAIN"],matchedEntity:entity,checkedAt};
  }

  const kind=normalizeRegistrationKind(entity.registrationType);
  const county=normalizeCounty(entity.county);
  const created=validDate(entity.creationDate);
  const nowMs=Date.parse(checkedAt);
  const reasonCodes=[];

  if(!kind) reasonCodes.push("REGISTRATION_TYPE_UNRECOGNIZED");
  else if(!allowedKinds.has(kind)) reasonCodes.push("ENTITY_TYPE_NOT_ALLOWED");

  if(!county) reasonCodes.push("REGISTERED_COUNTY_MISSING");
  else if(!allowedCounties.has(county)) reasonCodes.push("REGISTERED_COUNTY_NOT_ALLOWED");

  let ageDays=null;
  if(created==null||!Number.isFinite(nowMs)||created>nowMs){
    reasonCodes.push("FORMATION_DATE_UNAVAILABLE");
  }else{
    ageDays=Math.floor((nowMs-created)/DAY_MS);
    if(ageDays<minAgeDays) reasonCodes.push("FORMATION_AGE_BELOW_THRESHOLD");
  }

  const proceed=reasonCodes.length===0;
  return {
    decision:proceed?"proceed":"human_review",
    agentAction:proceed?"continue_vendor_intake":"pause_and_request_human_review",
    reasonCodes,
    matchedEntity:entity,
    registrationKind:kind,
    registeredCounty:entity.county??null,
    normalizedCounty:county,
    creationDate:entity.creationDate??null,
    ageDays,
    policy:{
      allowedKinds:[...allowedKinds],
      allowedCounties:[...allowedCounties],
      minAgeDays
    },
    checkedAt
  };
}

module.exports={assessLocalVendorPolicy};
