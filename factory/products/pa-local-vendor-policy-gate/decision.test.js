"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {assessLocalVendorPolicy}=require("./decision");
const evidence={available:true,strongMatch:true,ambiguous:false,entity:{registrationType:"Foreign Limited Liability Company",county:"Dauphin",creationDate:"2025-01-01"}};
const policy={allowedKinds:["llc"],allowedCounties:["dauphin"],minAgeDays:30};
test("all caller policy rules passing returns proceed",()=>{
  const r=assessLocalVendorPolicy(evidence,policy,"2026-10-02T00:00:00.000Z");
  assert.equal(r.decision,"proceed");assert.deepEqual(r.reasonCodes,[]);
});
test("type, county, and age failures accumulate",()=>{
  const r=assessLocalVendorPolicy({...evidence,entity:{registrationType:"Domestic Business Corporation",county:"Schuylkill",creationDate:"2026-09-20"}},policy,"2026-10-02T00:00:00.000Z");
  assert.equal(r.decision,"human_review");
  assert.ok(r.reasonCodes.includes("ENTITY_TYPE_NOT_ALLOWED"));
  assert.ok(r.reasonCodes.includes("REGISTERED_COUNTY_NOT_ALLOWED"));
  assert.ok(r.reasonCodes.includes("FORMATION_AGE_BELOW_THRESHOLD"));
});
test("no entity returns company_not_found",()=>assert.equal(assessLocalVendorPolicy({available:true,strongMatch:false,entity:null},policy).decision,"company_not_found"));
test("ambiguous identity requires review",()=>assert.equal(assessLocalVendorPolicy({...evidence,strongMatch:false,ambiguous:true},policy).decision,"human_review"));
