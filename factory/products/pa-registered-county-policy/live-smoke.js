"use strict";
const assert=require("node:assert/strict");
const {createCountyPolicyService}=require("./service");
const {createPaRegistryAdapter}=require("../../packages/sources/live-pa-identity");
async function main(){
  const service=createCountyPolicyService({registry:createPaRegistryAdapter()});
  const r=await service.check({company:"OpenAI OpCo",allowedCounties:"Dauphin,Schuylkill"});
  console.log(JSON.stringify({decision:r.decision,reasonCode:r.reasonCode,registeredCounty:r.registeredCounty,registeredCountyCode:r.registeredCountyCode,matchedEntity:r.matchedEntity,sourceFailures:r.sourceFailures},null,2));
  assert.equal(r.decision,"policy_match");assert.equal(r.registeredCounty,"Dauphin");assert.deepEqual(r.sourceFailures,[]);
}
main().catch(e=>{console.error(e);process.exit(1);});
