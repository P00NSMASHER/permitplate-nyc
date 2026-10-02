"use strict";

const assert=require("node:assert/strict");
const {createTreasuryAverageRatesAdapter}=require("../../packages/sources/treasury-average-rates");
const {createTreasuryRateChangeService}=require("./service");

async function main(){
  const service=createTreasuryRateChangeService({
    treasury:createTreasuryAverageRatesAdapter()
  });
  const result=await service.check({
    security:"Total Marketable",
    toleranceBps:2
  });

  console.log(JSON.stringify({
    decision:result.decision,
    deltaBps:result.deltaBps,
    toleranceBps:result.toleranceBps,
    latest:result.latest,
    previous:result.previous,
    reasonCodes:result.reasonCodes,
    source:result.evidence?.provenance
  },null,2));

  assert.ok(["increased","decreased","within_tolerance"].includes(result.decision));
  assert.deepEqual(result.reasonCodes,[]);
  assert.ok(Number.isFinite(result.deltaBps));
  assert.ok(result.latest?.recordDate);
  assert.ok(result.previous?.recordDate);
  assert.notEqual(result.latest.recordDate,result.previous.recordDate);
  assert.ok(Number.isFinite(result.latest.averageInterestRatePercent));
  assert.ok(Number.isFinite(result.previous.averageInterestRatePercent));
}

main().catch(error=>{console.error(error);process.exit(1);});
