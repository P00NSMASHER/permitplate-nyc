"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {normalizeCounty,assessCountyPolicy}=require("./decision");
test("county normalization ignores case and punctuation",()=>{
  assert.equal(normalizeCounty("  Schuylkill County "), "schuylkill county");
});
test("allowed county returns policy_match",()=>{
  const r=assessCountyPolicy({available:true,strongMatch:true,ambiguous:false,entity:{county:"Dauphin",countyCode:"22"}},["dauphin","schuylkill"]);
  assert.equal(r.decision,"policy_match");assert.equal(r.reasonCode,"REGISTERED_COUNTY_ALLOWED");
});
test("nonallowed county returns policy_mismatch",()=>{
  const r=assessCountyPolicy({available:true,strongMatch:true,ambiguous:false,entity:{county:"Dauphin"}},["schuylkill"]);
  assert.equal(r.decision,"policy_mismatch");
});
test("missing entity returns company_not_found",()=>{
  assert.equal(assessCountyPolicy({available:true,strongMatch:false,entity:null},["dauphin"]).decision,"company_not_found");
});
test("missing county requires human review",()=>{
  assert.equal(assessCountyPolicy({available:true,strongMatch:true,ambiguous:false,entity:{county:null}},["dauphin"]).decision,"human_review");
});
