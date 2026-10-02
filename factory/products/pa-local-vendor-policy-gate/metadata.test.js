"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {catalogResource,openApiPath,llmsText}=require("./metadata");
test("catalog has 4000 atomic resource-level accepts",()=>{const r=catalogResource("https://example.test");assert.equal(r.price,"$0.004");assert.equal(r.accepts[0].amount,"4000");});
test("OpenAPI exposes all policy dimensions",()=>{const p=openApiPath().get;assert.deepEqual(p.parameters.map(x=>x.name),["company","allowedKinds","allowedCounties","minAgeDays"]);assert.equal(p["x-payment-info"].price.amount,"0.004000");assert.ok(p.responses[502]);assert.ok(p.responses[503]);});
test("agent text states proceed boundary",()=>{const t=llmsText("https://example.test");assert.match(t,/caller-defined policy checks passed/i);assert.match(t,/same PAYMENT-SIGNATURE/i);});
