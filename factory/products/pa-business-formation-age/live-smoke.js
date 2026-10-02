"use strict";
const assert=require("node:assert/strict");
const {createPaRegistryAdapter}=require("../../packages/sources/live-pa-identity");
const {createFormationAgeService}=require("./service");
async function main(){
 const service=createFormationAgeService({registry:createPaRegistryAdapter()});
 const r=await service.check({company:"OpenAI OpCo",minAgeDays:30});
 console.log(JSON.stringify({decision:r.decision,reasonCodes:r.reasonCodes,creationDate:r.creationDate,ageDays:r.ageDays,minAgeDays:r.minAgeDays,matchedEntity:r.matchedEntity,source:r.evidence?.provenance?.source},null,2));
 assert.equal(r.chargeable,true);assert.equal(r.evidence.available,true);assert.equal(r.evidence.strongMatch,true);assert.equal(r.decision,"established_entity");assert.ok(r.ageDays>=30);
}
main().catch(e=>{console.error(e);process.exit(1);});
