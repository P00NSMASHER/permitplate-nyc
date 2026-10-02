"use strict";

function finite(value){return typeof value==="number"&&Number.isFinite(value);}

function assessTreasuryRateChange(evidence,{toleranceBps=2,checkedAt=new Date().toISOString()}={}){
  const checks={};
  const reasonCodes=[];

  if(evidence?.available!==true){
    checks.source={status:"review",reason:"TREASURY_EVIDENCE_UNAVAILABLE"};
    reasonCodes.push("TREASURY_EVIDENCE_UNAVAILABLE");
  }else if(evidence.found!==true){
    checks.source={status:"review",reason:"SECURITY_NOT_FOUND"};
    reasonCodes.push("SECURITY_NOT_FOUND");
  }else if(evidence.ambiguous===true){
    checks.source={status:"review",reason:"SECURITY_AMBIGUOUS"};
    reasonCodes.push("SECURITY_AMBIGUOUS");
  }else if(!Array.isArray(evidence.points)||evidence.points.length<2){
    checks.source={status:"review",reason:"INSUFFICIENT_HISTORY"};
    reasonCodes.push("INSUFFICIENT_HISTORY");
  }

  let latest=null;
  let previous=null;
  let deltaBps=null;
  if(reasonCodes.length===0){
    latest=evidence.points[0]??null;
    previous=evidence.points[1]??null;
    const latestRate=latest?.averageInterestRatePercent;
    const previousRate=previous?.averageInterestRatePercent;
    if(!finite(latestRate)||!finite(previousRate)){
      checks.source={status:"review",reason:"RATE_VALUE_UNAVAILABLE"};
      reasonCodes.push("RATE_VALUE_UNAVAILABLE");
    }else{
      deltaBps=Number(((latestRate-previousRate)*100).toFixed(3));
      checks.source={status:"pass",reason:"TWO_MONTH_HISTORY_COMPLETE"};
    }
  }

  let decision="human_review";
  if(reasonCodes.length===0){
    if(Math.abs(deltaBps)<=toleranceBps)decision="within_tolerance";
    else if(deltaBps>0)decision="increased";
    else decision="decreased";
  }

  return {
    decision,
    reasonCodes,
    checks,
    latest,
    previous,
    deltaBps,
    toleranceBps,
    checkedAt,
    policy:{
      historyPoints:2,
      withinToleranceInclusive:true,
      automaticReject:false
    }
  };
}

module.exports={assessTreasuryRateChange};
