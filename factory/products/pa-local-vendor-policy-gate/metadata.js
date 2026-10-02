"use strict";
const {requirements}=require("../../packages/x402/payment");
const {AMOUNT_ATOMIC,PRICE,RESOURCE_PATH,productPaymentDocument}=require("./paid-handler");
const OPERATION_ID="checkPennsylvaniaLocalVendorPolicy";
function catalogResource(base){base=base.replace(/\/$/,"");const d=productPaymentDocument(base);return{resource:base+RESOURCE_PATH,method:"GET",description:d.resource.description,price:PRICE,tags:d.resource.tags,accepts:[requirements(AMOUNT_ATOMIC)],extensions:d.extensions};}
function openApiPath(){return{get:{
  operationId:OPERATION_ID,
  summary:"Evaluate a Pennsylvania vendor against local procurement policy",
  description:"Resolve a Pennsylvania business to one strong registry entity and evaluate caller-supplied allowedKinds, allowedCounties, and minAgeDays in one deterministic gate. Returns proceed, human_review, or company_not_found. Proceed means only those caller-defined policy checks passed and is not legal/compliance approval or proof of good standing, ownership, authority, local operations, tax situs, fraud risk, sanctions status, or creditworthiness.",
  tags:["Pennsylvania Business Registry","Vendor Policy","Local Sourcing","Formation Age"],
  parameters:[
    {name:"company",in:"query",required:true,schema:{type:"string",minLength:2,maxLength:120},example:"OpenAI OpCo"},
    {name:"allowedKinds",in:"query",required:true,schema:{type:"string"},example:"llc,corporation"},
    {name:"allowedCounties",in:"query",required:true,schema:{type:"string"},example:"Dauphin,Schuylkill"},
    {name:"minAgeDays",in:"query",required:false,schema:{type:"integer",minimum:1,maximum:36500,default:365},example:30}
  ],
  "x-payment-info":{price:{mode:"fixed",currency:"USD",amount:"0.004000"},protocols:[{x402:{}}],network:"eip155:8453",payTo:"0x708f7b52b56eafd7fc1de65fc7752ed732914021"},
  responses:{200:{description:"Completed paid local-vendor policy result."},400:{description:"Invalid input; payment not settled."},402:{description:"Payment required."},502:{description:"PA registry unavailable; payment not settled."},503:{description:"Payment unresolved; retry same authorization."}}
}};}
function llmsText(base){return["# PA Local Vendor Policy Gate x402","","Endpoint: GET "+base.replace(/\/$/,"")+RESOURCE_PATH+"?company=OpenAI%20OpCo&allowedKinds=llc%2Ccorporation&allowedCounties=Dauphin%2CSchuylkill&minAgeDays=30","Price: $0.004 USDC on Base via x402.","Source: Pennsylvania Department of State via data.pa.gov.","Checks: legal-entity type policy, registered-county policy, minimum formation age.","Decisions: proceed, human_review, company_not_found.","Proceed only means the caller-defined policy checks passed; it is not legal/compliance approval or proof of good standing, ownership, authority, local operations, tax situs, fraud risk, sanctions status, or creditworthiness.","On HTTP 503 retry the same PAYMENT-SIGNATURE."].join("\n");}
module.exports={OPERATION_ID,catalogResource,openApiPath,llmsText};
