"use strict";

const assert=require("node:assert/strict");
const {createOfacNameAdapter}=require("../../packages/sources/ofac-name-screen");
const {createOfacReviewService}=require("./service");

async function main(){
  const service=createOfacReviewService({
    ofac:createOfacNameAdapter()
  });

  const result=await service.check({
    name:"VLADIMIR PUTIN",
    minScore:90
  });

  console.log(JSON.stringify({
    decision:result.decision,
    reasonCodes:result.reasonCodes,
    candidateCount:result.candidateCount,
    candidates:result.candidates,
    minScore:result.minScore,
    source:result.evidence?.provenance?.source,
    limitations:result.limitations
  },null,2));

  assert.equal(result.chargeable,true);
  assert.equal(result.evidence.available,true);
  assert.equal(result.decision,"candidate_found");
  assert.ok(result.candidateCount>=1);
  assert.ok(result.candidates.some(c=>Number(c.score)>=90));
  assert.ok(result.limitations.some(x=>/not sanctions clearance/i.test(x)));
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
