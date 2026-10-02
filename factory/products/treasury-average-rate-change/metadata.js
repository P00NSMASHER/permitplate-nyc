"use strict";

const {requirements}=require("../../packages/x402/payment");
const {
  AMOUNT_ATOMIC,
  PRICE,
  RESOURCE_PATH,
  productPaymentDocument
}=require("./paid-handler");

const OPERATION_ID="checkTreasuryAverageRateChange";

function catalogResource(base){
  base=base.replace(/\/$/,"");
  const d=productPaymentDocument(base);
  return {
    resource:base+RESOURCE_PATH,
    method:"GET",
    description:d.resource.description,
    price:PRICE,
    tags:d.resource.tags,
    accepts:[requirements(AMOUNT_ATOMIC)],
    extensions:d.extensions
  };
}

function openApiPath(){
  return {get:{
    operationId:OPERATION_ID,
    summary:"Classify the latest monthly Treasury average-rate change",
    description:"Compare the two most recent distinct monthly weighted-average rates for one official U.S. Treasury security category. Returns increased, decreased, within_tolerance, or human_review. deltaBps is computed as the latest rate minus the previous monthly rate, in basis points. These are average rates on outstanding Treasury securities, not live market yields, forecasts, or investment recommendations.",
    tags:["Treasury","Interest Rates","Rate Change","Macro"],
    parameters:[
      {name:"security",in:"query",required:true,schema:{type:"string",minLength:2,maxLength:100},example:"Total Marketable"},
      {name:"toleranceBps",in:"query",required:false,schema:{type:"number",minimum:0,maximum:1000,default:2},example:2}
    ],
    "x-payment-info":{
      price:{mode:"fixed",currency:"USD",amount:"0.003000"},
      protocols:[{x402:{}}],
      network:"eip155:8453",
      payTo:"0x708f7b52b56eafd7fc1de65fc7752ed732914021"
    },
    responses:{
      200:{description:"Completed paid two-month Treasury rate-change classification."},
      400:{description:"Invalid input; payment not settled."},
      402:{description:"Payment required."},
      502:{description:"Treasury Fiscal Data unavailable; payment not settled."},
      503:{description:"Payment unresolved; retry same authorization."}
    }
  }};
}

function llmsText(base){
  return [
    "# Treasury Average Rate Change x402",
    "",
    "Endpoint: GET "+base.replace(/\/$/,"")+RESOURCE_PATH+"?security=Total%20Marketable&toleranceBps=2",
    "Price: $0.003 USDC on Base via x402.",
    "Source: U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities.",
    "Uses exactly the two most recent distinct monthly points for the selected category.",
    "Decisions: increased, decreased, within_tolerance, human_review.",
    "deltaBps = (latest monthly average rate - previous monthly average rate) * 100.",
    "This is not a live market yield, forecast, long-term trend determination, or investment advice.",
    "On HTTP 503 retry the same PAYMENT-SIGNATURE."
  ].join("\n");
}

module.exports={OPERATION_ID,catalogResource,openApiPath,llmsText};
