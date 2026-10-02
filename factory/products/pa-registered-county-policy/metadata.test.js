"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {catalogResource,openApiPath,llmsText}=require("./metadata");
test("catalog has resource-level accepts",()=>{const r=catalogResource("https://example.test");assert.equal(r.price,"$0.002");assert.equal(r.accepts[0].amount,"2000");});
test("OpenAPI exposes company and allowedCounties",()=>{const p=openApiPath().get;assert.deepEqual(p.parameters.map(x=>x.name),["company","allowedCounties"]);assert.equal(p["x-payment-info"].price.amount,"0.002000");assert.ok(p.responses[502]);assert.ok(p.responses[503]);});
test("agent text states narrow claim boundary",()=>{const t=llmsText("https://example.test");assert.match(t,/registry county against the caller policy/i);assert.match(t,/same PAYMENT-SIGNATURE/i);});
