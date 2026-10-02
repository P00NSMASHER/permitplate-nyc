"use strict";

const {requireAdapter,sourceUnavailable,normalizedEvidence}=require("../../packages/sources/contracts");
const {assessTreasuryRateChange}=require("./decision");

function validateTreasuryRateChangeInput(input){
  const security=String(input?.security??"").trim().replace(/\s+/g," ");
  if(security.length<2||security.length>100){
    const e=new Error("security length must be 2-100");
    e.code="INVALID_INPUT";
    throw e;
  }

  const raw=input?.toleranceBps;
  const toleranceBps=raw==null||String(raw).trim()===""?2:Number(raw);
  if(!Number.isFinite(toleranceBps)||toleranceBps<0||toleranceBps>1000){
    const e=new Error("toleranceBps must be between 0 and 1000");
    e.code="INVALID_INPUT";
    throw e;
  }
  return {security,toleranceBps};
}

function createTreasuryRateChangeService({treasury,now=()=>new Date().toISOString()}){
  requireAdapter("treasury",treasury,"history");

  return {async check(input){
    const normalized=validateTreasuryRateChangeInput(input);
    const sourceFailures=[];
    let evidence;
    try{
      evidence=normalizedEvidence(
        "treasury_fiscal_data",
        await treasury.history({security:normalized.security,points:2})
      );
    }catch(error){
      const detail=error?.code||error?.message||"history lookup failed";
      sourceFailures.push({source:"treasury_fiscal_data",detail});
      evidence=sourceUnavailable("treasury_fiscal_data",detail);
    }

    const decision=assessTreasuryRateChange(evidence,{
      toleranceBps:normalized.toleranceBps,
      checkedAt:now()
    });

    return {
      ...decision,
      input:normalized,
      sourceFailures,
      chargeable:sourceFailures.length===0,
      evidence
    };
  }};
}

module.exports={validateTreasuryRateChangeInput,createTreasuryRateChangeService};
