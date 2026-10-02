"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {parseAllowedCounties,createCountyPolicyService}=require("./service");
test("county parser dedupes names",()=>assert.deepEqual(parseAllowedCounties("Dauphin, Schuylkill,dauphin"),["dauphin","schuylkill"]));
test("service returns policy_match on live-shaped evidence",async()=>{
  const service=createCountyPolicyService({registry:{async lookup({company}){return{available:true,strongMatch:true,ambiguous:false,entity:{businessName:company,filingNumber:"1",registrationType:"LLC",county:"Dauphin",countyCode:"22"}};}},now:()=>"2026-10-02T15:30:00.000Z"});
  const r=await service.check({company:"OpenAI OpCo",allowedCounties:"Dauphin,Schuylkill"});
  assert.equal(r.decision,"policy_match");assert.equal(r.registeredCounty,"Dauphin");assert.equal(r.chargeable,true);
});
test("completed county mismatch is chargeable",async()=>{
  const service=createCountyPolicyService({registry:{async lookup(){return{available:true,strongMatch:true,ambiguous:false,entity:{businessName:"Example",county:"Dauphin"}};}}});
  const r=await service.check({company:"Example",allowedCounties:"Schuylkill"});
  assert.equal(r.decision,"policy_mismatch");assert.equal(r.chargeable,true);
});
test("registry outage is non-chargeable",async()=>{
  const service=createCountyPolicyService({registry:{async lookup(){const e=new Error("timeout");e.code="UPSTREAM_TIMEOUT";throw e;}}});
  const r=await service.check({company:"Example",allowedCounties:"Dauphin"});
  assert.equal(r.decision,"human_review");assert.equal(r.chargeable,false);
});
