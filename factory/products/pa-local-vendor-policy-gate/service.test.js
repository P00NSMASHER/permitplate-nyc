"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createLocalVendorPolicyService}=require("./service");
test("service evaluates one registry result against all three policies",async()=>{
  const service=createLocalVendorPolicyService({
    registry:{async lookup({company}){return{available:true,strongMatch:true,ambiguous:false,entity:{businessName:company,filingNumber:"1",registrationType:"Foreign Limited Liability Company",county:"Dauphin",countyCode:"22",creationDate:"2025-09-29"}};}},
    now:()=>"2026-10-02T00:00:00.000Z"
  });
  const r=await service.check({company:"OpenAI OpCo",allowedKinds:"llc,corporation",allowedCounties:"Dauphin,Schuylkill",minAgeDays:"30"});
  assert.equal(r.decision,"proceed");assert.equal(r.registrationKind,"llc");assert.equal(r.normalizedCounty,"dauphin");assert.equal(r.chargeable,true);
});
test("completed policy failure remains chargeable",async()=>{
  const service=createLocalVendorPolicyService({
    registry:{async lookup(){return{available:true,strongMatch:true,ambiguous:false,entity:{businessName:"Example",registrationType:"Domestic Business Corporation",county:"Dauphin",creationDate:"2026-09-29"}};}},
    now:()=>"2026-10-02T00:00:00.000Z"
  });
  const r=await service.check({company:"Example",allowedKinds:"llc",allowedCounties:"Dauphin",minAgeDays:"30"});
  assert.equal(r.decision,"human_review");assert.equal(r.chargeable,true);
});
test("registry outage is non-chargeable",async()=>{
  const service=createLocalVendorPolicyService({registry:{async lookup(){const e=new Error("timeout");e.code="UPSTREAM_TIMEOUT";throw e;}}});
  const r=await service.check({company:"Example",allowedKinds:"llc",allowedCounties:"Dauphin",minAgeDays:"30"});
  assert.equal(r.chargeable,false);assert.equal(r.decision,"human_review");
});
