"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessTreasuryRateChange}=require("./decision");

function evidence(latest,previous){
  return {
    available:true,found:true,ambiguous:false,
    points:[
      {recordDate:"2026-08-31",securityDescription:"Total Marketable",averageInterestRatePercent:latest},
      {recordDate:"2026-07-31",securityDescription:"Total Marketable",averageInterestRatePercent:previous}
    ]
  };
}

test("increase beyond tolerance returns increased",()=>{
  const r=assessTreasuryRateChange(evidence(3.60,3.50),{toleranceBps:5});
  assert.equal(r.decision,"increased");
  assert.equal(r.deltaBps,10);
});

test("decrease beyond tolerance returns decreased",()=>{
  const r=assessTreasuryRateChange(evidence(3.475,3.525),{toleranceBps:2});
  assert.equal(r.decision,"decreased");
  assert.equal(r.deltaBps,-5);
});

test("absolute change at tolerance is within_tolerance",()=>{
  const r=assessTreasuryRateChange(evidence(3.52,3.50),{toleranceBps:2});
  assert.equal(r.decision,"within_tolerance");
  assert.equal(r.deltaBps,2);
});

test("ambiguous security fails closed",()=>{
  const r=assessTreasuryRateChange({available:true,found:true,ambiguous:true,points:[]},{toleranceBps:2});
  assert.equal(r.decision,"human_review");
  assert.ok(r.reasonCodes.includes("SECURITY_AMBIGUOUS"));
});

test("fewer than two months fails closed",()=>{
  const r=assessTreasuryRateChange({available:true,found:true,ambiguous:false,points:[{averageInterestRatePercent:3.5}]},{toleranceBps:2});
  assert.equal(r.decision,"human_review");
  assert.ok(r.reasonCodes.includes("INSUFFICIENT_HISTORY"));
});

test("null rate fails closed",()=>{
  const r=assessTreasuryRateChange(evidence(null,3.5),{toleranceBps:2});
  assert.equal(r.decision,"human_review");
  assert.ok(r.reasonCodes.includes("RATE_VALUE_UNAVAILABLE"));
});
