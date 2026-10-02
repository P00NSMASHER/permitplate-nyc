"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {catalogResource,openApiPath,llmsText}=require("./metadata");

test("Product 014 catalog has resource-level accepts",()=>{
  const r=catalogResource("https://example.test");
  assert.equal(r.resource,"https://example.test/api/treasury-average-rate-change");
  assert.equal(r.price,"$0.003");
  assert.equal(r.accepts[0].amount,"3000");
  assert.equal(r.accepts[0].network,"eip155:8453");
});

test("Product 014 OpenAPI documents tolerance and non-settlement failures",()=>{
  const p=openApiPath().get;
  assert.equal(p["x-payment-info"].price.amount,"0.003000");
  assert.deepEqual(p.parameters.map(x=>x.name),["security","toleranceBps"]);
  assert.ok(p.responses[502]);
  assert.ok(p.responses[503]);
});

test("llms text states two-point limitation and same-payment retry",()=>{
  const text=llmsText("https://example.test");
  assert.match(text,/two most recent distinct monthly points/i);
  assert.match(text,/not a live market yield/i);
  assert.match(text,/same PAYMENT-SIGNATURE/i);
});
