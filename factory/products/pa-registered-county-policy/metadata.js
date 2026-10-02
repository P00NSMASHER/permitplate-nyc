"use strict";
const {requirements}=require("../../packages/x402/payment");
const {AMOUNT_ATOMIC,PRICE,RESOURCE_PATH,productPaymentDocument}=require("./paid-handler");
const OPERATION_ID="checkPennsylvaniaRegisteredCountyPolicy";
function catalogResource(base){base=base.replace(/\/$/,"");const d=productPaymentDocument(base);return{resource:base+RESOURCE_PATH,method:"GET",description:d.resource.description,price:PRICE,tags:d.resource.tags,accepts:[requirements(AMOUNT_ATOMIC)],extensions:d.extensions};}
function openApiPath(){return{get:{
  operationId:OPERATION_ID,
  summary:"Check a Pennsylvania registered county against caller policy",
  description:"Resolve a Pennsylvania business to one strong registry entity and compare its source-published registered county with caller-supplied allowedCounties. Returns policy_match, policy_mismatch, company_not_found, or human_review. This does not prove physical operations, headquarters location, service area, residency, local ownership, tax situs, good standing, authority, or legal compliance.",
  tags:["Pennsylvania Business Registry","Registered County","Local Sourcing","Procurement Policy"],
  parameters:[
    {name:"company",in:"query",required:true,schema:{type:"string",minLength:2,maxLength:120},example:"OpenAI OpCo"},
    {name:"allowedCounties",in:"query",required:true,schema:{type:"string"},example:"Dauphin,Schuylkill"}
  ],
  "x-payment-info":{price:{mode:"fixed",currency:"USD",amount:"0.002000"},protocols:[{x402:{}}],network:"eip155:8453",payTo:"0x708f7b52b56eafd7fc1de65fc7752ed732914021"},
  responses:{200:{description:"Completed paid county-policy result."},400:{description:"Invalid input; payment not settled."},402:{description:"Payment required."},502:{description:"PA registry unavailable; payment not settled."},503:{description:"Payment unresolved; retry same authorization."}}
}};}
function llmsText(base){return["# PA Registered County Policy x402","","Endpoint: GET "+base.replace(/\/$/,"")+RESOURCE_PATH+"?company=OpenAI%20OpCo&allowedCounties=Dauphin%2CSchuylkill","Price: $0.002 USDC on Base via x402.","Source: Pennsylvania Department of State via data.pa.gov.","Decisions: policy_match, policy_mismatch, company_not_found, human_review.","This evaluates only the registry county against the caller policy; it does not prove physical operations, headquarters location, service area, residency, local ownership, tax situs, good standing, authority, or legal compliance.","On HTTP 503 retry the same PAYMENT-SIGNATURE."].join("\n");}
module.exports={OPERATION_ID,catalogResource,openApiPath,llmsText};
