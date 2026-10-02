"use strict";
const {requireAdapter,sourceUnavailable,normalizedEvidence}=require("../../packages/sources/contracts");
const {normalizeCounty,assessCountyPolicy}=require("./decision");

function validateCompany(value){
  const company=String(value??"").trim().replace(/\s+/g," ");
  if(company.length<2||company.length>120){const e=new Error("company length must be 2-120");e.code="INVALID_INPUT";throw e;}
  return company;
}

function parseAllowedCounties(value){
  const raw=String(value??"").trim();
  if(!raw){const e=new Error("allowedCounties is required");e.code="INVALID_INPUT";throw e;}
  const counties=[...new Set(raw.split(",").map(normalizeCounty).filter(Boolean))];
  if(counties.length<1||counties.length>67){const e=new Error("allowedCounties must contain 1-67 county names");e.code="INVALID_INPUT";throw e;}
  for(const county of counties){
    if(county.length<3||county.length>40){const e=new Error("invalid county name: "+county);e.code="INVALID_INPUT";throw e;}
  }
  return counties;
}

function validateCountyPolicyInput(input){
  return {company:validateCompany(input?.company),allowedCounties:parseAllowedCounties(input?.allowedCounties)};
}

function createCountyPolicyService({registry,now=()=>new Date().toISOString()}){
  requireAdapter("registry",registry,"lookup");
  return {async check(input){
    const normalized=validateCountyPolicyInput(input);
    const sourceFailures=[];
    let evidence;
    try{
      evidence=normalizedEvidence("pa_registry",await registry.lookup({company:normalized.company}));
    }catch(error){
      const detail=error?.code||error?.message||"lookup failed";
      sourceFailures.push({source:"pa_registry",detail});
      evidence=sourceUnavailable("pa_registry",detail);
    }
    const result=assessCountyPolicy(evidence,normalized.allowedCounties,now());
    return {...result,input:normalized,sourceFailures,chargeable:sourceFailures.length===0,evidence};
  }};
}

module.exports={parseAllowedCounties,validateCountyPolicyInput,createCountyPolicyService};
