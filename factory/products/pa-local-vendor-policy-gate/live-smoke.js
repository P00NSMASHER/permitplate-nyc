"use strict";
const assert=require("node:assert/strict");
const {createLocalVendorPolicyService}=require("./service");
const {createPaRegistryAdapter}=require("../../packages/sources/live-pa-identity");
async function main(){
  const service=createLocalVendorPolicyService({registry:createPaRegistryAdapter()});
  const r=await service.check({
    company:"OpenAI OpCo",
    allowedKinds:"llc,corporation",
    allowedCounties:"Dauphin,Schuylkill",
    minAgeDays:"30"
  });
  console.log(JSON.stringify({
    decision:r.decision,
    agentAction:r.agentAction,
    reasonCodes:r.reasonCodes,
    registrationKind:r.registrationKind,
    registeredCounty:r.registeredCounty,
    creationDate:r.creationDate,
    ageDays:r.ageDays,
    policy:r.policy,
    matchedEntity:r.matchedEntity,
    sourceFailures:r.sourceFailures
  },null,2));
  assert.equal(r.decision,"proceed");
  assert.equal(r.registrationKind,"llc");
  assert.equal(r.normalizedCounty,"dauphin");
  assert.ok(r.ageDays>=30);
  assert.deepEqual(r.sourceFailures,[]);
}
main().catch(e=>{console.error(e);process.exit(1);});
