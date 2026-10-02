"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateTreasuryRateChangeInput,createTreasuryRateChangeService}=require("./service");

test("input defaults tolerance to 2 bps",()=>{
  assert.deepEqual(validateTreasuryRateChangeInput({security:"Total Marketable"}),{security:"Total Marketable",toleranceBps:2});
});

test("service uses exactly two history points",async()=>{
  let args=null;
  const service=createTreasuryRateChangeService({
    treasury:{async history(input){args=input;return{
      available:true,found:true,ambiguous:false,
      points:[
        {recordDate:"2026-08-31",averageInterestRatePercent:3.475},
        {recordDate:"2026-07-31",averageInterestRatePercent:3.525}
      ]
    };}},
    now:()=>"2026-10-02T13:35:00.000Z"
  });
  const r=await service.check({security:"Total Marketable",toleranceBps:"2"});
  assert.deepEqual(args,{security:"Total Marketable",points:2});
  assert.equal(r.decision,"decreased");
  assert.equal(r.deltaBps,-5);
  assert.equal(r.chargeable,true);
});

test("completed ambiguous lookup is chargeable human review",async()=>{
  const service=createTreasuryRateChangeService({
    treasury:{async history(){return{available:true,found:true,ambiguous:true,points:[]};}}
  });
  const r=await service.check({security:"Treasury"});
  assert.equal(r.decision,"human_review");
  assert.equal(r.chargeable,true);
});

test("Treasury transport failure is non-chargeable",async()=>{
  const service=createTreasuryRateChangeService({
    treasury:{async history(){const e=new Error("timeout");e.code="SOURCE_HTTP_ERROR";throw e;}}
  });
  const r=await service.check({security:"Total Marketable"});
  assert.equal(r.decision,"human_review");
  assert.equal(r.chargeable,false);
  assert.equal(r.sourceFailures[0].source,"treasury_fiscal_data");
});

test("invalid tolerance is rejected before source work",async()=>{
  let calls=0;
  const service=createTreasuryRateChangeService({treasury:{async history(){calls++;return{};}}});
  await assert.rejects(()=>service.check({security:"Total Marketable",toleranceBps:-1}),e=>e.code==="INVALID_INPUT");
  assert.equal(calls,0);
});
